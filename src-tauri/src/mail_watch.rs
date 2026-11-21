use std::{path::PathBuf, process::{Child, Stdio}, sync::Mutex, time::{Duration, Instant}};
use serde_json::Value;
use tauri::Manager;

#[derive(Default)]
pub struct MailWatcher(Mutex<Watcher>);
#[derive(Default)]
struct Watcher { child: Option<Child>, root: PathBuf, started: Option<Instant> }
impl Watcher {
    fn stop(&mut self) {
        if let Some(mut child) = self.child.take() { let _ = child.kill(); let _ = child.wait(); }
    }
}
impl Drop for Watcher { fn drop(&mut self) { self.stop(); } }

#[tauri::command]
pub fn watch_mail(app: tauri::AppHandle, enabled: bool) -> Result<Option<Value>, String> {
    let root = super::data_root(&app)?;
    let engine = super::engine_root(&app)?;
    let state = app.state::<MailWatcher>();
    let mut watcher = state.0.lock().map_err(|_| "Mail watcher is unavailable")?;
    if watcher.root != root || !enabled {
        watcher.stop(); watcher.root = root.clone(); watcher.started = None;
    }
    if enabled && !super::active_backup(&super::backup_root(&root)) {
        let running = watcher.child.as_mut().is_some_and(|child| matches!(child.try_wait(), Ok(None)));
        if !running && watcher.started.is_none_or(|at| at.elapsed() >= Duration::from_secs(30)) {
            watcher.stop(); watcher.started = Some(Instant::now());
            watcher.child = Some(super::hidden_command("powershell.exe").current_dir(&root)
                .env("MAIL_VAULT_DATA_DIR", &root).env("BMAIL_WATCH_APP", std::process::id().to_string())
                .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(engine.join("Run-Backup.ps1")).args(["-Mode", "Watch"])
                .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
                .spawn().map_err(|e| e.to_string())?);
        }
    }
    Ok(super::read_json(&super::backup_root(&root).join("new-mail-status.json")))
}
