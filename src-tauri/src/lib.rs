use serde::{Deserialize, Serialize};
use std::io::Write;
use serde_json::Value;
use std::{fs, path::{Path, PathBuf}, process::Command};
use tauri::Manager;
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
    has_manifest: bool,
    total_messages: u64,
    folder_count: usize,
    last_run: Option<Value>,
    latest_log: Option<LogSummary>,
    progress: Option<Value>,
    backup_running: bool,
    launch_error: Option<String>,
    backup_options: Value,
    mailboxes: Option<Value>,
}

fn data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&root).map_err(|e| format!("Could not create app data directory: {e}"))?;
    // Windows resource paths may use the verbatim \\?\ prefix, which PowerShell
    // providers reject even though Rust and Win32 can open those same files.
    Ok(dunce::simplified(&root).to_path_buf())
}

fn engine_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/engine")
    } else {
        app.path().resource_dir().map_err(|e| e.to_string())?.join("engine")
    };
    if !root.join("node.exe").is_file() || !root.join("backup.cjs").is_file() {
        return Err("Bundled backup runtime is missing. Rebuild or reinstall Mail Vault.".into());
    }
    Ok(dunce::simplified(&root).to_path_buf())
}

fn read_json(path: &Path) -> Option<Value> {
    fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(text.trim_start_matches('\u{feff}')).ok())
}

fn latest_log(root: &Path) -> Option<LogSummary> {
    let mut files: Vec<_> = fs::read_dir(root.join("logs")).ok()?.filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext.eq_ignore_ascii_case("log"))).collect();
    files.sort_by_key(|entry| entry.metadata().and_then(|m| m.modified()).ok());
    let entry = files.pop()?;
    let text = fs::read_to_string(entry.path()).ok()?;
    let tail = text.lines().rev().take(120).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
    Some(LogSummary { name: entry.file_name().to_string_lossy().into_owned(), tail })
}

fn schedule_exists(user: &str) -> bool {
    // Match the per-user task name used by Install-BackupSchedule.ps1.
    let sid = hidden_command("whoami.exe").args(["/user", "/fo", "csv", "/nh"]).output().ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|text| text.trim().split(',').next_back().map(|v| v.trim_matches('"').to_owned()));
    let Some(sid) = sid else { return false; };
    ["Mail Vault Backup", "Zoho Mail Backup"].iter().any(|prefix| {
        hidden_command("schtasks.exe").args(["/Query", "/TN", &format!("{prefix} - {sid} - {user}")])
            .output().is_ok_and(|output| output.status.success())
    })
}

#[tauri::command]
fn get_dashboard(app: tauri::AppHandle, process: tauri::State<BackupProcess>) -> Result<Dashboard, String> {
    let root = data_root(&app)?;
    let config = read_json(&root.join("backup-config.json")).unwrap_or(Value::Null);
    let user = config.get("user").and_then(Value::as_str).unwrap_or("Set up your mailbox").to_owned();
    let backup_dir = config.get("backupDirectory").and_then(Value::as_str).unwrap_or("backups");
    let backup_root = root.join(backup_dir);
    let manifest = read_json(&backup_root.join("manifest.json"));
    let folders = manifest.as_ref().and_then(|m| m.get("folders")).and_then(Value::as_object);
    let total_messages = folders.map(|items| items.values().filter_map(|folder| folder.get("messages")?.as_object()).map(|m| m.len() as u64).sum()).unwrap_or(0);
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
    let lock_running = read_json(&backup_root.join(".backup.lock")).and_then(|v| v.get("pid").and_then(Value::as_u64)).is_some_and(process_running);
    let progress = read_json(&backup_root.join("progress.json"));
    Ok(Dashboard {
        host: config.get("host").and_then(Value::as_str).unwrap_or("imap.gmail.com").to_owned(),
        port: config.get("port").and_then(Value::as_u64).and_then(|p| u16::try_from(p).ok()).unwrap_or(993),
        credential_ready: config.get("user").and_then(Value::as_str).is_some() && root.join(".private/zoho-credential.xml").is_file(),
        schedule_installed: schedule_exists(&user),
        has_manifest: manifest.is_some(), total_messages,
        folder_count: folders.map_or(0, |value| value.len()),
        last_run: read_json(&backup_root.join("last-run.json")),
        latest_log: latest_log(&root), user,
        progress, backup_running: launching || lock_running, launch_error,
        backup_options: config.get("backupOptions").cloned().unwrap_or_else(|| serde_json::json!({"folders": [], "dateFrom": null, "dateTo": null, "maxMessages": null})),
        mailboxes: read_json(&backup_root.join("mailboxes.json")),
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
async fn configure_mailbox(app: tauri::AppHandle, settings: MailboxSettings) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = data_root(&app)?;
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
                "DATA_DIRECTORY_UNAVAILABLE" => "Windows could not write to your Mail Vault data folder. Check its permissions and try again.",
                "CREDENTIAL_DIRECTORY_UNAVAILABLE" => "Windows could not secure your credential folder. Check its permissions and try again.",
                "PASSWORD_ENCRYPTION_FAILED" => "Windows could not encrypt the app password for your account. Try again while signed in as the account that installed Mail Vault.",
                "CREDENTIAL_SAVE_FAILED" => "Windows could not save your encrypted app password. Check folder permissions and available disk space.",
                "CONFIG_UNREADABLE" => "Your saved mailbox configuration could not be read. Keep your backups and repair the configuration before trying again.",
                "CONFIG_SAVE_FAILED" => "Windows could not save your mailbox settings. Check folder permissions and available disk space.",
                _ => "Secure mailbox setup could not run. Reinstall the latest Mail Vault build and check that Windows permits PowerShell to run.",
            };
            return Err(message.into());
        }
        Ok("Mailbox saved. You can start your first backup.".into())
    }).await.map_err(|_| "Mailbox setup was interrupted".to_owned())?
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
    if read_json(&backup_root(&root).join(".backup.lock")).and_then(|v| v.get("pid").and_then(Value::as_u64)).is_some_and(process_running) {
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
}

fn valid_date(value: &str) -> bool {
    let parts: Vec<_> = value.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 { return false; }
    let (Ok(y), Ok(m), Ok(d)) = (parts[0].parse::<u32>(), parts[1].parse::<usize>(), parts[2].parse::<u32>()) else { return false; };
    let days = [31, if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    y >= 1 && (1..=12).contains(&m) && d >= 1 && d <= days[m - 1]
}

#[tauri::command]
fn save_backup_options(app: tauri::AppHandle, options: BackupOptions, process: tauri::State<BackupProcess>) -> Result<String, String> {
    let root = data_root(&app)?;
    let _guard = process.0.lock().map_err(|_| "Backup process state is unavailable")?;
    if _guard.as_ref().is_some_and(|child| process_running(child.id() as u64)) ||
        read_json(&backup_root(&root).join(".backup.lock")).and_then(|v| v.get("pid").and_then(Value::as_u64)).is_some_and(process_running) {
        return Err("Stop or finish the current backup before changing its selection.".into());
    }
    if options.folders.len() > 1000 || options.folders.iter().any(|f| f.trim().is_empty() || f.len() > 4096) { return Err("Choose valid mailbox folders.".into()); }
    if options.date_from.iter().chain(options.date_to.iter()).any(|v| !valid_date(v)) { return Err("Choose valid backup dates.".into()); }
    if let (Some(from), Some(to)) = (&options.date_from, &options.date_to) { if from > to { return Err("The start date must be before the end date.".into()); } }
    if options.max_messages.is_some_and(|n| n == 0 || n > 1000000) { return Err("Choose a limit from 1 to 1,000,000 new messages.".into()); }
    let config_path = root.join("backup-config.json");
    let mut config = read_json(&config_path).ok_or("Set up your mailbox first.")?;
    config["backupOptions"] = serde_json::to_value(options).map_err(|e| e.to_string())?;
    let temporary = root.join("backup-config.json.pending");
    fs::write(&temporary, serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&temporary, &config_path).map_err(|e| e.to_string())?;
    Ok("Backup selection saved. It will apply to manual and scheduled runs.".into())
}

#[tauri::command]
async fn run_action(app: tauri::AppHandle, action: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = data_root(&app)?;
        let engine = engine_root(&app)?;
        let (program, output) = match action.as_str() {
            "backup" => ("Backup", powershell(&engine, &root, "Run-Backup.ps1")?),
            "schedule" => ("Schedule", powershell(&engine, &root, "Install-BackupSchedule.ps1")?),
            "folders" => ("Folder discovery", {
                if read_json(&backup_root(&root).join(".backup.lock")).and_then(|v| v.get("pid").and_then(Value::as_u64)).is_some_and(process_running) {
                    return Err("Wait for the current backup to finish before reloading folders.".into());
                }
                hidden_command("powershell.exe").current_dir(&root).env("MAIL_VAULT_DATA_DIR", &root)
                    .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
                    .arg(engine.join("Run-Backup.ps1")).args(["-Mode", "Folders"]).output().map_err(|e| e.to_string())?
            }),
            "verify" => ("Verification", hidden_command(engine.join("node.exe")).current_dir(&root)
                .env("MAIL_VAULT_DATA_DIR", &root).arg(engine.join("backup.cjs")).arg("--verify")
                .output().map_err(|e| format!("Could not start Node.js: {e}"))?),
            _ => return Err("Unknown action".into()),
        };
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if output.status.success() { Ok(if stdout.is_empty() { format!("{program} completed") } else { stdout }) }
        else { Err(if stderr.is_empty() { format!("{program} failed. Check the latest log.") } else { stderr }) }
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
        .invoke_handler(tauri::generate_handler![get_dashboard, configure_mailbox, start_backup, save_backup_options, run_action, open_google_help, open_directory])
        .run(tauri::generate_context!())
        .expect("error while running Mail Vault");
}
