use serde::{Deserialize, Serialize};
use std::io::Write;
use serde_json::Value;
use std::{fs, path::{Path, PathBuf}, process::Command};
use tauri::Manager;
mod profile;
mod cache;
use std::sync::Mutex;

#[derive(Default)]
struct BackupProcess(Mutex<Option<std::process::Child>>);

fn process_running(pid: u64) -> bool {
    hidden_command("tasklist.exe").args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .output().is_ok_and(|o| String::from_utf8_lossy(&o.stdout).contains(&format!("\"{pid}\"")))
}

fn backup_root(root: &Path) -> PathBuf {
    let config = read_json(&root.join("backup-config.json")).unwrap_or(Value::Null);
    root.join(config.get("backupDirectory").and_then(Value::as_str).unwrap_or("backups"))
}
#[cfg(windows)]
use std::os::windows::process::CommandExt;

fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogSummary { name: String, tail: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Dashboard {
    user: String,
    host: String,
    port: u16,
    credential_ready: bool,
    schedule_installed: bool,
    schedule: Option<Value>,
    has_manifest: bool,
    total_messages: u64,
    folder_count: usize,
    local_stats: Value,
    mailbox_status: Option<Value>,
    last_run: Option<Value>,
    history: Value,
    history_error: Option<String>,
    latest_log: Option<LogSummary>,
    progress: Option<Value>,
    backup_running: bool,
    launch_error: Option<String>,
    backup_options: Value,
    mailboxes: Option<Value>,
    control_request: Option<Value>,
    accounts: Vec<String>,
    data_directory: String,
    migration_notice: Option<String>,
}

fn data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = base_root(app)?;
    let settings = read_json(&base.join("app-settings.json")).unwrap_or(Value::Null);
    let root = settings.get("activeAccount").and_then(Value::as_str).map(|email| profile::account_folder(&base, email)).unwrap_or(base);
    fs::create_dir_all(&root).map_err(|e| format!("Could not create app data directory: {e}"))?;
    // Windows resource paths may use the verbatim \\?\ prefix, which PowerShell
    // providers reject even though Rust and Win32 can open those same files.
    Ok(dunce::simplified(&root).to_path_buf())
}

fn base_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(dunce::simplified(&root).to_path_buf())
}

fn account_list(base: &Path) -> Vec<String> {
    let mut accounts: Vec<_> = fs::read_dir(base.join("accounts")).into_iter().flatten().filter_map(Result::ok)
        .filter_map(|entry| read_json(&entry.path().join("backup-config.json")))
        .filter_map(|config| config.get("user").and_then(Value::as_str).map(str::to_owned)).collect();
    accounts.sort();
    accounts
}

fn select_account(base: &Path, email: &str) -> Result<(), String> {
    let temporary = base.join("app-settings.json.pending");
    fs::write(&temporary, serde_json::to_vec(&serde_json::json!({"activeAccount": email})).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&temporary, base.join("app-settings.json")).map_err(|e| e.to_string())
}

fn initialize_profiles(app: &tauri::AppHandle) -> Result<(), String> {
    let base = base_root(app)?;
    if app.config().identifier == "com.bmail.desktop" {
        let legacy = app.path().local_data_dir().map_err(|e| e.to_string())?.join("in.co.integramicro.mail-vault");
        if let Some(config) = read_json(&legacy.join("backup-config.json")) {
            if let Some(email) = config.get("user").and_then(Value::as_str) {
                let destination = profile::account_folder(&base, email);
                if !destination.join("backup-config.json").exists() {
                    if active_backup(&backup_root(&legacy)) { return Err("An older backup is still running. Stop it before opening Bmail.".into()); }
                    let backup_directory = config.get("backupDirectory").and_then(Value::as_str).unwrap_or("backups");
                    let relative = if Path::new(backup_directory).is_absolute() { None } else { Some(Path::new(backup_directory)) };
                    let scheduled = schedule_exists(email);
                    profile::migrate(&legacy, &destination, relative).map_err(|e| format!("Could not migrate your existing mail: {e}"))?;
                    select_account(&base, email)?;
                    if scheduled {
                        let output = powershell(&engine_root(app)?, &destination, "Install-BackupSchedule.ps1");
                        if !output.is_ok_and(|o| o.status.success()) {
                            fs::write(base.join("migration-notice.txt"), "Your mail was migrated. Use Update schedule in Bmail to point the existing weekly task to its new account folder.").map_err(|e| e.to_string())?;
                        }
                    }
                }
            }
        }
    }
    if read_json(&base.join("app-settings.json")).is_none() {
        if let Some(email) = account_list(&base).first() { select_account(&base, email)?; }
    }
    Ok(())
}

fn engine_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/engine")
    } else {
        app.path().resource_dir().map_err(|e| e.to_string())?.join("engine")
    };
    if !root.join("node.exe").is_file() || !root.join("backup.cjs").is_file() {
        return Err("Bundled backup runtime is missing. Rebuild or reinstall Bmail.".into());
    }
    Ok(dunce::simplified(&root).to_path_buf())
}

fn read_json(path: &Path) -> Option<Value> {
    fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(text.trim_start_matches('\u{feff}')).ok())
}

fn active_backup(root: &Path) -> bool {
    if read_json(&root.join(".backup.lock")).and_then(|v| v.get("pid").and_then(Value::as_u64)).is_some_and(process_running) { return true; }
    let progress_path = root.join("progress.json");
    let recent = fs::metadata(&progress_path).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_secs() < 20);
    let progress = read_json(&progress_path).unwrap_or(Value::Null);
    recent && matches!(progress.get("state").and_then(Value::as_str), Some("running" | "paused" | "stopping" | "retrying"))
        && progress.get("pid").and_then(Value::as_u64).is_some_and(process_running)
}

fn latest_log(root: &Path, cache: &mut cache::Cache, force: bool) -> Option<LogSummary> {
    let mut files: Vec<_> = fs::read_dir(root.join("logs")).ok()?.filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext.eq_ignore_ascii_case("log"))).collect();
    files.sort_by_key(|entry| entry.metadata().and_then(|m| m.modified()).ok());
    let entry = files.pop()?;
    let tail = cache.log_tail(&entry.path(), force)?;
    Some(LogSummary { name: entry.file_name().to_string_lossy().into_owned(), tail })
}

fn schedule_exists(user: &str) -> bool {
    // Match the per-user task name used by Install-BackupSchedule.ps1.
    let sid = hidden_command("whoami.exe").args(["/user", "/fo", "csv", "/nh"]).output().ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|text| text.trim().split(',').next_back().map(|v| v.trim_matches('"').to_owned()));
    let Some(sid) = sid else { return false; };
    ["Bmail Backup", "Mail Vault Backup", "Zoho Mail Backup"].iter().any(|prefix| {
        hidden_command("schtasks.exe").args(["/Query", "/TN", &format!("{prefix} - {sid} - {user}")])
            .output().is_ok_and(|output| output.status.success())
    })
}

fn local_statistics(manifest: Option<&Value>) -> Value {
    let mut bytes = 0_u64;
    let mut messages = 0_u64;
    let mut folders = Vec::new();
    let mut recent: Vec<Value> = Vec::new();
    if let Some(items) = manifest.and_then(|m| m.get("folders")).and_then(Value::as_object) {
        for folder in items.values() {
            let name = folder.get("name").and_then(Value::as_str).unwrap_or("Unknown");
            let mut count = 0_u64;
            let mut size = 0_u64;
            if let Some(records) = folder.get("messages").and_then(Value::as_object) {
                for record in records.values().filter(|r| r.get("complete").and_then(Value::as_bool) != Some(false)) {
                    count += 1;
                    size += record.get("bytes").and_then(Value::as_u64).unwrap_or(0);
                    if let Some(saved_at) = record.get("backedUpAt").and_then(Value::as_str) {
                        if recent.len() == 10 && recent.last().and_then(|item| item["backedUpAt"].as_str()).is_some_and(|oldest| saved_at <= oldest) { continue; }
                        recent.push(serde_json::json!({"folder": name, "subject": record.get("subject"), "sender": record.get("sender"), "backedUpAt": record.get("backedUpAt")}));
                        recent.sort_by(|a, b| b["backedUpAt"].as_str().cmp(&a["backedUpAt"].as_str()));
                        recent.truncate(10);
                    }
                }
            }
            bytes += size;
            messages += count;
            folders.push(serde_json::json!({"name": name, "messages": count, "bytes": size}));
        }
    }
    recent.sort_by(|a, b| b["backedUpAt"].as_str().cmp(&a["backedUpAt"].as_str()));
    recent.truncate(10);
    serde_json::json!({"messages": messages, "bytes": bytes, "folders": folders, "recent": recent})
}

#[tauri::command]
async fn get_dashboard(app: tauri::AppHandle, force: Option<bool>) -> Result<Dashboard, String> {
    tauri::async_runtime::spawn_blocking(move || read_dashboard(&app, force.unwrap_or(false)))
        .await.map_err(|e| format!("Could not load dashboard: {e}"))?
}

fn read_dashboard(app: &tauri::AppHandle, force: bool) -> Result<Dashboard, String> {
    let process = app.state::<BackupProcess>();
    let root = data_root(app)?;
    let config = read_json(&root.join("backup-config.json")).unwrap_or(Value::Null);
    let user = config.get("user").and_then(Value::as_str).unwrap_or("Set up your mailbox").to_owned();
    let backup_dir = config.get("backupDirectory").and_then(Value::as_str).unwrap_or("backups");
    let backup_root = root.join(backup_dir);
    let mut child = process.0.lock().map_err(|_| "Backup process state is unavailable")?;
    let mut launch_error = None;
    let launching = if let Some(active) = child.as_mut() {
        match active.try_wait().map_err(|e| e.to_string())? {
            None => true,
            Some(status) => {
                if !status.success() { launch_error = Some("Backup exited with an error. Check the latest log.".into()); }
                *child = None;
                false
            }
        }
    } else { false };
    drop(child);
    let lock_running = !launching && active_backup(&backup_root);
    let cache_state = app.state::<cache::DashboardCache>();
    let mut cache = cache_state.0.lock().map_err(|_| "Dashboard cache is unavailable")?;
    let summary = cache.manifest(&root, &backup_root.join("manifest.json"), force, |manifest| {
        let folders = manifest.get("folders").and_then(Value::as_object);
        let total_messages = folders.map(|items| items.values().filter_map(|folder| folder.get("messages")?.as_object()).map(|m| m.len() as u64).sum()).unwrap_or(0);
        cache::ManifestSummary { total_messages, folder_count: folders.map_or(0, |value| value.len()), local_stats: local_statistics(Some(manifest)) }
    });
    let progress = cache.json(&backup_root.join("progress.json"), force);
    let history_path = backup_root.join("history.json");
    let history = cache.json(&history_path, force).filter(Value::is_array);
    let history_error = if history_path.exists() && history.is_none() { Some("Backup history could not be read. The existing file was kept.".to_owned()) } else { None };
    Ok(Dashboard {
        host: config.get("host").and_then(Value::as_str).unwrap_or("imap.gmail.com").to_owned(),
        port: config.get("port").and_then(Value::as_u64).and_then(|p| u16::try_from(p).ok()).unwrap_or(993),
        credential_ready: config.get("user").and_then(Value::as_str).is_some() && root.join(".private/zoho-credential.xml").is_file(),
        schedule_installed: cache.schedule(&root, force, || schedule_exists(&user)),
        schedule: cache.json(&root.join("backup-schedule-status.json"), force),
        has_manifest: summary.is_some(),
        total_messages: summary.as_ref().map_or(0, |summary| summary.total_messages),
        folder_count: summary.as_ref().map_or(0, |summary| summary.folder_count),
        local_stats: summary.map_or_else(|| local_statistics(None), |summary| summary.local_stats),
        mailbox_status: cache.project(&backup_root.join("mailbox-status.json"), force, |mut status| {
            if let Some(folders) = status.get_mut("folders").and_then(Value::as_array_mut) {
                for folder in folders { if let Some(folder) = folder.as_object_mut() { folder.remove("uids"); } }
            }
            status
        }),
        last_run: cache.json(&backup_root.join("last-run.json"), force),
        history: history.unwrap_or_else(|| serde_json::json!([])), history_error,
        latest_log: latest_log(&root, &mut cache, force), user,
        progress, backup_running: launching || lock_running, launch_error,
        backup_options: config.get("backupOptions").cloned().unwrap_or_else(|| serde_json::json!({"folders": [], "dateFrom": null, "dateTo": null, "maxMessages": null})),
        mailboxes: cache.json(&backup_root.join("mailboxes.json"), force),
        control_request: cache.json(&backup_root.join("control.json"), force),
        accounts: account_list(&base_root(&app)?),
        data_directory: root.to_string_lossy().into_owned(),
        migration_notice: fs::read_to_string(base_root(&app)?.join("migration-notice.txt")).ok(),
    })
}

#[derive(Deserialize, Serialize)]
struct MailboxSettings {
    user: String,
    host: String,
    port: u16,
    password: String,
}

#[tauri::command]
async fn configure_mailbox(app: tauri::AppHandle, settings: MailboxSettings, process: tauri::State<'_, BackupProcess>) -> Result<String, String> {
    {
        let guard = process.0.lock().map_err(|_| "Backup process state is unavailable")?;
        if guard.as_ref().is_some_and(|child| process_running(child.id() as u64)) || active_backup(&backup_root(&data_root(&app)?)) {
            return Err("Stop or finish the current backup before changing accounts or credentials.".into());
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let base = base_root(&app)?;
        let root = profile::account_folder(&base, &settings.user);
        if settings.user.trim().is_empty() || root.file_name().is_some_and(|n| n.to_string_lossy().len() > 240) { return Err("Enter a valid email address for this account.".into()); }
        fs::create_dir_all(&root).map_err(|_| "Could not create the account folder.".to_owned())?;
        let engine = engine_root(&app)?;
        let mut child = hidden_command("powershell.exe").current_dir(&root)
            .env("MAIL_VAULT_DATA_DIR", &root)
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(engine.join("Save-Mailbox.ps1"))
            .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped()).spawn()
            .map_err(|_| "Could not start secure mailbox setup".to_owned())?;
        let payload = serde_json::to_vec(&settings).map_err(|_| "Could not prepare mailbox setup".to_owned())?;
        let write_result = child.stdin.take().ok_or("Mailbox setup input is unavailable")?
            .write_all(&payload);
        let output = child.wait_with_output().map_err(|_| "Mailbox setup was interrupted".to_owned())?;
        if !output.status.success() || write_result.is_err() {
            let status = serde_json::from_slice::<Value>(&output.stdout).unwrap_or(Value::Null);
            let message = match status.get("errorCode").and_then(Value::as_str).unwrap_or("") {
                "INVALID_EMAIL" => "Enter your complete email address.",
                "INVALID_HOST" => "Enter a valid IMAP server hostname.",
                "INVALID_PORT" => "Enter a TLS port between 1 and 65535.",
                "GMAIL_REQUIRES_993" => "Gmail requires TLS port 993. Port 25 cannot receive Gmail backups.",
                "PASSWORD_REQUIRED" => "Enter your application-specific password. Spaces between Google app-password groups are accepted.",
                "MAILBOX_IDENTITY_MISMATCH" => "This profile already belongs to another mailbox. Keep its saved email and server to update the password.",
                "DATA_DIRECTORY_UNAVAILABLE" => "Windows could not write to your Bmail data folder. Check its permissions and try again.",
                "CREDENTIAL_DIRECTORY_UNAVAILABLE" => "Windows could not secure your credential folder. Check its permissions and try again.",
                "PASSWORD_ENCRYPTION_FAILED" => "Windows could not encrypt the app password for your account. Try again while signed in as the account that installed Bmail.",
                "CREDENTIAL_SAVE_FAILED" => "Windows could not save your encrypted app password. Check folder permissions and available disk space.",
                "CONFIG_UNREADABLE" => "Your saved mailbox configuration could not be read. Keep your backups and repair the configuration before trying again.",
                "CONFIG_SAVE_FAILED" => "Windows could not save your mailbox settings. Check folder permissions and available disk space.",
                _ => "Secure mailbox setup could not run. Reinstall the latest Bmail build and check that Windows permits PowerShell to run.",
            };
            return Err(message.into());
        }
        select_account(&base, &settings.user)?;
        Ok("Mailbox saved. You can start your first backup.".into())
    }).await.map_err(|_| "Mailbox setup was interrupted".to_owned())?
}

#[tauri::command]
fn switch_account(app: tauri::AppHandle, email: String, process: tauri::State<BackupProcess>) -> Result<(), String> {
    let guard = process.0.lock().map_err(|_| "Backup process state is unavailable")?;
    if guard.as_ref().is_some_and(|child| process_running(child.id() as u64)) || active_backup(&backup_root(&data_root(&app)?)) {
        return Err("Stop or finish the current backup before switching accounts.".into());
    }
    let base = base_root(&app)?;
    if !account_list(&base).contains(&email) { return Err("That account has not been added to Bmail.".into()); }
    select_account(&base, &email)
}

fn powershell(engine: &Path, data: &Path, script: &str) -> Result<std::process::Output, String> {
    hidden_command("powershell.exe").current_dir(data).env("MAIL_VAULT_DATA_DIR", data).args([
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"
    ]).arg(engine.join(script)).output().map_err(|e| format!("Could not start PowerShell: {e}"))
}

#[tauri::command]
fn start_backup(app: tauri::AppHandle, process: tauri::State<BackupProcess>) -> Result<String, String> {
    let root = data_root(&app)?;
    let engine = engine_root(&app)?;
    let mut child = process.0.lock().map_err(|_| "Backup process state is unavailable")?;
    if let Some(active) = child.as_mut() {
        if active.try_wait().map_err(|e| e.to_string())?.is_none() { return Err("A backup is already running.".into()); }
    }
    if active_backup(&backup_root(&root)) {
        return Err("A backup or verification is already running.".into());
    }
    *child = Some(hidden_command("powershell.exe").current_dir(&root).env("MAIL_VAULT_DATA_DIR", &root)
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(engine.join("Run-Backup.ps1")).stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn()
        .map_err(|e| format!("Could not start backup: {e}"))?);
    Ok("Backup started. Progress will appear here.".into())
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupOptions {
    folders: Vec<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    max_messages: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    advanced: Option<AdvancedOptions>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdvancedOptions {
    excluded_folders: Vec<String>, last_days: Option<u32>, unread_only: bool, flagged_only: bool,
    sender: String, subject: String, min_size_k_b: Option<u64>, max_size_m_b: Option<u64>,
    order: String, retry_attempts: u32, retry_delay_seconds: u32, connection_timeout_seconds: u32,
    socket_timeout_seconds: u32, verify_after_backup: bool, check_mailbox_after_backup: bool,
    #[serde(default)] notify_on_success: bool,
    #[serde(default)] notify_on_failure: bool,
    #[serde(default)] notify_on_stopped: bool,
}

fn valid_date(value: &str) -> bool {
    let parts: Vec<_> = value.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 { return false; }
    let (Ok(y), Ok(m), Ok(d)) = (parts[0].parse::<u32>(), parts[1].parse::<usize>(), parts[2].parse::<u32>()) else { return false; };
    let days = [31, if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    y >= 1 && (1..=12).contains(&m) && d >= 1 && d <= days[m - 1]
}

#[tauri::command]
async fn manage_schedule(app: tauri::AppHandle, action: String, schedule: Option<Value>) -> Result<Value, String> {
    if !["read", "save", "remove"].contains(&action.as_str()) { return Err("Unknown schedule action.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let root = data_root(&app)?;
        if action != "read" {
            let process = app.state::<BackupProcess>();
            let mut child = process.0.lock().map_err(|_| "Backup process state is unavailable")?;
            if child.as_mut().is_some_and(|child| child.try_wait().map_or(true, |status| status.is_none())) || active_backup(&backup_root(&root)) {
                return Err("Finish the current backup before changing its schedule.".into());
            }
        }
        let engine = engine_root(&app)?;
        let mut child = hidden_command("powershell.exe").current_dir(&root).env("MAIL_VAULT_DATA_DIR", &root)
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]).arg(engine.join("Manage-BackupSchedule.ps1"))
            .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
            .spawn().map_err(|e| format!("Could not start Windows scheduler: {e}"))?;
        let payload = serde_json::to_vec(&serde_json::json!({"action": action, "schedule": schedule})).map_err(|e| e.to_string())?;
        let written = child.stdin.take().ok_or("Schedule input is unavailable")?.write_all(&payload);
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() || written.is_err() {
            let error = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            return Err(if error.is_empty() { "Windows could not update the schedule. Check Task Scheduler permissions.".into() } else { error });
        }
        let result = serde_json::from_slice::<Value>(&output.stdout).map_err(|e| format!("Could not read schedule status: {e}"))?;
        let cache = app.state::<cache::DashboardCache>();
        if let Ok(mut cache) = cache.0.lock() { cache.invalidate_schedule(&root); };
        Ok(result)
    }).await.map_err(|e| format!("Schedule operation was interrupted: {e}"))?
}

#[tauri::command]
async fn test_notification(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = engine_root(&app)?;
        let mut child = hidden_command("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File"]).arg(engine.join("Notify-Backup.ps1"))
            .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
            .spawn().map_err(|e| e.to_string())?;
        child.stdin.take().ok_or("Notification input is unavailable")?.write_all(br#"{"title":"Bmail notification test","message":"Desktop alerts are enabled. Windows notification settings control their display.","failed":false}"#).map_err(|e| e.to_string())?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned()); }
        Ok("Test notification sent. Windows settings may suppress its display.".into())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn save_backup_options(app: tauri::AppHandle, options: BackupOptions, process: tauri::State<BackupProcess>) -> Result<String, String> {
    let root = data_root(&app)?;
    let _guard = process.0.lock().map_err(|_| "Backup process state is unavailable")?;
    if _guard.as_ref().is_some_and(|child| process_running(child.id() as u64)) ||
        active_backup(&backup_root(&root)) {
        return Err("Stop or finish the current backup before changing its selection.".into());
    }
    if options.folders.len() > 1000 || options.folders.iter().any(|f| f.trim().is_empty() || f.len() > 4096) { return Err("Choose valid mailbox folders.".into()); }
    if options.date_from.iter().chain(options.date_to.iter()).any(|v| !valid_date(v)) { return Err("Choose valid backup dates.".into()); }
    if let (Some(from), Some(to)) = (&options.date_from, &options.date_to) { if from > to { return Err("The start date must be before the end date.".into()); } }
    if options.max_messages.is_some_and(|n| n == 0 || n > 1000000) { return Err("Choose a limit from 1 to 1,000,000 new messages.".into()); }
    if let Some(a) = &options.advanced {
        if a.excluded_folders.len() > 1000 || a.excluded_folders.iter().any(|f| f.trim().is_empty() || f.len() > 1024)
            || a.last_days.is_some_and(|n| n == 0 || n > 36500) || a.last_days.is_some() && (options.date_from.is_some() || options.date_to.is_some())
            || !["newest", "oldest"].contains(&a.order.as_str()) || !(1..=10).contains(&a.retry_attempts)
            || !(1..=3600).contains(&a.retry_delay_seconds) || !(5..=120).contains(&a.connection_timeout_seconds)
            || !(30..=1800).contains(&a.socket_timeout_seconds) || a.min_size_k_b.is_some_and(|n| n == 0 || n > 1048576)
            || a.max_size_m_b.is_some_and(|n| n == 0 || n > 1024)
            || a.sender.len() > 500 || a.subject.len() > 500 || a.sender.chars().chain(a.subject.chars()).any(|c| matches!(c, '\r' | '\n' | '\0')) {
            return Err("Choose valid advanced backup options. Rolling dates cannot be combined with fixed dates.".into());
        }
        if let (Some(min), Some(max)) = (a.min_size_k_b, a.max_size_m_b) { if min > max * 1024 { return Err("Minimum message size must not exceed maximum size.".into()); } }
    }
    let config_path = root.join("backup-config.json");
    let mut config = read_json(&config_path).ok_or("Set up your mailbox first.")?;
    config["backupOptions"] = serde_json::to_value(options).map_err(|e| e.to_string())?;
    let temporary = root.join("backup-config.json.pending");
    fs::write(&temporary, serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&temporary, &config_path).map_err(|e| e.to_string())?;
    Ok("Backup options saved. Manual folders updated; filters and limits apply to all runs.".into())
}

#[tauri::command]
fn control_backup(app: tauri::AppHandle, command: String, run_id: String, process: tauri::State<BackupProcess>) -> Result<String, String> {
    if !["pause", "resume", "stop", "cancel"].contains(&command.as_str()) { return Err("Unknown backup control.".into()); }
    let _guard = process.0.lock().map_err(|_| "Backup process state is unavailable")?;
    let root = backup_root(&data_root(&app)?);
    let progress = read_json(&root.join("progress.json")).ok_or("This run does not support controls. Update Bmail before starting the next run.")?;
    if progress.get("runId").and_then(Value::as_str) != Some(run_id.as_str()) ||
        !matches!(progress.get("state").and_then(Value::as_str), Some("running" | "paused" | "stopping" | "retrying")) || !active_backup(&root) {
        return Err("That backup is no longer active. Refresh to see its latest state.".into());
    }
    let previous = read_json(&root.join("control.json")).unwrap_or(Value::Null);
    if previous.get("runId").and_then(Value::as_str) == Some(run_id.as_str()) {
        let requested = previous.get("command").and_then(Value::as_str).unwrap_or("");
        if requested == "cancel" || requested == "stop" && command != "cancel" { return Err("This backup is already stopping. Completed emails will be kept.".into()); }
    }
    let temporary = root.join("control.json.pending");
    fs::write(&temporary, serde_json::to_vec(&serde_json::json!({"runId": run_id, "command": command})).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&temporary, root.join("control.json")).map_err(|e| e.to_string())?;
    Ok(match command.as_str() {
        "pause" => "Pause requested. Waiting for the current chunk to finish.",
        "resume" => "Resuming your backup.",
        "stop" => "Stop requested. Finishing the current email, then stopping.",
        _ => "Cancelling the current download. Completed emails will be kept.",
    }.into())
}

#[tauri::command]
async fn run_action(app: tauri::AppHandle, action: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = data_root(&app)?;
        let engine = engine_root(&app)?;
        if ["backup", "verify", "folders", "stats"].contains(&action.as_str()) && active_backup(&backup_root(&root)) {
            return Err("A backup is already active. Pause, stop, or wait for it to finish first.".into());
        }
        let (program, output) = match action.as_str() {
            "backup" => ("Backup", powershell(&engine, &root, "Run-Backup.ps1")?),
            "schedule" => ("Schedule", powershell(&engine, &root, "Install-BackupSchedule.ps1")?),
            "folders" | "stats" => ("Mailbox check", {
                if active_backup(&backup_root(&root)) {
                    return Err("Wait for the current backup to finish before reloading folders.".into());
                }
                hidden_command("powershell.exe").current_dir(&root).env("MAIL_VAULT_DATA_DIR", &root)
                    .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
                    .arg(engine.join("Run-Backup.ps1")).args(["-Mode", if action == "stats" { "Stats" } else { "Folders" }]).output().map_err(|e| e.to_string())?
            }),
            "verify" => ("Verification", hidden_command(engine.join("node.exe")).current_dir(&root)
                .env("MAIL_VAULT_DATA_DIR", &root).arg(engine.join("backup.cjs")).arg("--verify")
                .output().map_err(|e| format!("Could not start Node.js: {e}"))?),
            _ => return Err("Unknown action".into()),
        };
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if output.status.success() {
            if action == "schedule" {
                let cache = app.state::<cache::DashboardCache>();
                if let Ok(mut cache) = cache.0.lock() { cache.invalidate_schedule(&root); };
            }
            Ok(if stdout.is_empty() { format!("{program} completed") } else { stdout })
        }
        else { Err(if stderr.is_empty() {
            // PowerShell's launcher writes diagnostics to stdout. Preserve those
            // details so a failed check explains what the user can fix.
            if stdout.is_empty() { format!("{program} failed. Check the latest log.") } else { stdout }
        } else { stderr }) }
    }).await.map_err(|e| format!("Operation was interrupted: {e}"))?
}

#[tauri::command]
fn open_google_help() -> Result<(), String> {
    Command::new("explorer.exe").arg("https://support.google.com/accounts/answer/185833")
        .spawn().map(|_| ()).map_err(|e| format!("Could not open Google help: {e}"))
}

#[tauri::command]
fn open_directory(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    let root = data_root(&app)?;
    let config = read_json(&root.join("backup-config.json")).unwrap_or(Value::Null);
    let target = match kind.as_str() {
        "backups" => root.join(config.get("backupDirectory").and_then(Value::as_str).unwrap_or("backups")),
        "logs" => root.join("logs"), _ => return Err("Unknown folder".into())
    };
    fs::create_dir_all(&target).map_err(|e| format!("Could not create folder: {e}"))?;
    Command::new("explorer.exe").arg(&target).spawn().map(|_| ()).map_err(|e| format!("Could not open folder: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BackupProcess::default())
        .manage(cache::DashboardCache::default())
        .setup(|app| { initialize_profiles(app.handle()).map_err(std::io::Error::other)?; Ok(()) })
        .invoke_handler(tauri::generate_handler![get_dashboard, configure_mailbox, switch_account, start_backup, save_backup_options, control_backup, run_action, open_google_help, open_directory, manage_schedule, test_notification])
        .run(tauri::generate_context!())
        .expect("error while running Bmail");
}

#[cfg(test)]
mod dashboard_tests {
    use super::*;

    #[test]
    fn advanced_options_deserialize_the_ui_field_names() {
        let value = serde_json::json!({
            "excludedFolders": [], "lastDays": 30, "unreadOnly": true, "flaggedOnly": false,
            "sender": "", "subject": "", "minSizeKB": 10, "maxSizeMB": 5, "order": "oldest",
            "retryAttempts": 3, "retryDelaySeconds": 30, "connectionTimeoutSeconds": 30, "socketTimeoutSeconds": 300,
            "verifyAfterBackup": true, "checkMailboxAfterBackup": true, "notifyOnSuccess": true, "notifyOnFailure": false, "notifyOnStopped": false
        });
        let options: AdvancedOptions = serde_json::from_value(value).unwrap();
        assert_eq!(options.min_size_k_b, Some(10)); assert_eq!(options.max_size_m_b, Some(5));
        assert!(options.notify_on_success);
    }

    #[test]
    fn summary_counts_all_complete_records_but_only_retains_the_latest_ten() {
        let mut messages = serde_json::Map::new();
        for index in 1..=30 {
            messages.insert(index.to_string(), serde_json::json!({
                "bytes": 10, "complete": true, "subject": format!("Message {index}"),
                "backedUpAt": format!("2026-11-{index:02}T00:00:00Z")
            }));
        }
        messages.insert("partial".into(), serde_json::json!({"bytes": 100, "complete": false}));
        let manifest = serde_json::json!({"folders": {"inbox": {"name": "INBOX", "messages": messages}}});
        let summary = local_statistics(Some(&manifest));
        assert_eq!(summary["messages"], 30);
        assert_eq!(summary["bytes"], 300);
        let recent = summary["recent"].as_array().unwrap();
        assert_eq!(recent.len(), 10);
        assert_eq!(recent[0]["subject"], "Message 30");
        assert_eq!(recent[9]["subject"], "Message 21");
    }
}
