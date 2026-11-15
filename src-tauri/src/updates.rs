use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{ipc::Channel, Manager};
use tauri_plugin_updater::UpdaterExt;

#[derive(Default)]
pub struct UpdateState(AtomicBool);

pub fn ensure_idle(app: &tauri::AppHandle) -> Result<(), String> {
    if app.state::<UpdateState>().0.load(Ordering::SeqCst) {
        Err("An application update is in progress. Please wait.".into())
    } else { Ok(()) }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    configured: bool,
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
}

#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let config = app.config().plugins.0.get("updater").cloned().unwrap_or_default();
    let configured = config["pubkey"].as_str().is_some_and(|key| !key.is_empty())
        && config["endpoints"].as_array().is_some_and(|urls| !urls.is_empty());
    let mut info = UpdateInfo { configured, current_version: app.package_info().version.to_string(), version: None, notes: None };
    if configured {
        let update = app.updater_builder().timeout(std::time::Duration::from_secs(30)).build()
            .map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
        if let Some(update) = update { info.version = Some(update.version); info.notes = update.body; }
    }
    Ok(info)
}

fn ensure_no_backups(app: &tauri::AppHandle) -> Result<(), String> {
    let process = app.state::<super::BackupProcess>();
    let mut child = process.0.lock().map_err(|_| "Backup state is unavailable")?;
    if let Some(child) = child.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Err("Stop or finish the backup before installing an update.".into());
        }
    }
    let base = super::base_root(app)?;
    let mut roots = vec![base.clone()];
    roots.extend(super::account_list(&base).iter().map(|email| super::profile::account_folder(&base, email)));
    if roots.iter().any(|root| super::active_backup(&super::backup_root(root))) {
        return Err("Stop or finish all account backups before installing an update.".into());
    }
    Ok(())
}

struct InstallGuard<'a>(&'a AtomicBool);
impl Drop for InstallGuard<'_> {
    fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress { downloaded: u64, total: Option<u64>, installing: bool }

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, version: String, on_progress: Channel<DownloadProgress>) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    state.0.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "An update is already in progress")?;
    let _guard = InstallGuard(&state.0);
    ensure_no_backups(&app)?;
    let update = app.updater_builder().timeout(std::time::Duration::from_secs(120)).build()
        .map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?
        .ok_or("This update is no longer available. Check for updates again.")?;
    if update.version != version { return Err("The available version changed. Check for updates again.".into()); }
    let mut downloaded = 0;
    let mut last_report = std::time::Instant::now();
    let bytes = update.download(|chunk, total| {
        downloaded += chunk as u64;
        if last_report.elapsed() >= std::time::Duration::from_millis(200) {
            let _ = on_progress.send(DownloadProgress { downloaded, total, installing: false });
            last_report = std::time::Instant::now();
        }
    }, || {}).await.map_err(|e| e.to_string())?;
    // Download verifies the signature. Check again because scheduled backups can
    // start independently of the dashboard during a long download.
    ensure_no_backups(&app)?;
    let _ = on_progress.send(DownloadProgress { downloaded, total: Some(downloaded), installing: true });
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart();
}
