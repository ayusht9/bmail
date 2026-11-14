use serde::{Deserialize, Serialize};
use std::io::Write;
use serde_json::Value;
use std::{fs, path::{Path, PathBuf}, process::Command};
use tauri::Manager;
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
}

fn data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&root).map_err(|e| format!("Could not create app data directory: {e}"))?;
    Ok(root)
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
    Ok(root)
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
fn get_dashboard(app: tauri::AppHandle) -> Result<Dashboard, String> {
    let root = data_root(&app)?;
    let config = read_json(&root.join("backup-config.json")).unwrap_or(Value::Null);
    let user = config.get("user").and_then(Value::as_str).unwrap_or("Set up your mailbox").to_owned();
    let backup_dir = config.get("backupDirectory").and_then(Value::as_str).unwrap_or("backups");
    let backup_root = root.join(backup_dir);
    let manifest = read_json(&backup_root.join("manifest.json"));
    let folders = manifest.as_ref().and_then(|m| m.get("folders")).and_then(Value::as_object);
    let total_messages = folders.map(|items| items.values().filter_map(|folder| folder.get("messages")?.as_object()).map(|m| m.len() as u64).sum()).unwrap_or(0);
    Ok(Dashboard {
        host: config.get("host").and_then(Value::as_str).unwrap_or("imap.gmail.com").to_owned(),
        port: config.get("port").and_then(Value::as_u64).and_then(|p| u16::try_from(p).ok()).unwrap_or(993),
        credential_ready: root.join(".private/zoho-credential.xml").is_file(),
        schedule_installed: schedule_exists(&user),
        has_manifest: manifest.is_some(), total_messages,
        folder_count: folders.map_or(0, |value| value.len()),
        last_run: read_json(&backup_root.join("last-run.json")),
        latest_log: latest_log(&root), user,
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
            return Err("Mailbox setup failed. Check your email, server and port. Existing profiles must keep the same mailbox settings.".into());
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
async fn run_action(app: tauri::AppHandle, action: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = data_root(&app)?;
        let engine = engine_root(&app)?;
        let (program, output) = match action.as_str() {
            "backup" => ("Backup", powershell(&engine, &root, "Run-Backup.ps1")?),
            "schedule" => ("Schedule", powershell(&engine, &root, "Install-BackupSchedule.ps1")?),
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
        .invoke_handler(tauri::generate_handler![get_dashboard, configure_mailbox, run_action, open_google_help, open_directory])
        .run(tauri::generate_context!())
        .expect("error while running Mail Vault");
}
