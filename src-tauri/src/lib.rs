use serde::Serialize;
use serde_json::Value;
use std::{fs, path::{Path, PathBuf}, process::Command};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogSummary { name: String, tail: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Dashboard {
    user: String,
    credential_ready: bool,
    schedule_installed: bool,
    has_manifest: bool,
    total_messages: u64,
    folder_count: usize,
    last_run: Option<Value>,
    latest_log: Option<LogSummary>,
}

fn project_root() -> Result<PathBuf, String> {
    let manifest_root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(Path::to_path_buf);
    let current = std::env::current_dir().ok();
    current.into_iter().chain(manifest_root).find(|path| path.join("backup.cjs").is_file())
        .ok_or_else(|| "Could not locate backup.cjs. Keep Mail Vault in the email-backup folder.".into())
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
    Command::new("schtasks.exe").args(["/Query", "/TN", &format!("Zoho Mail Backup - {user}")])
        .output().is_ok_and(|output| output.status.success())
}

#[tauri::command]
fn get_dashboard() -> Result<Dashboard, String> {
    let root = project_root()?;
    let config = read_json(&root.join("backup-config.json")).ok_or("backup-config.json is missing or invalid")?;
    let user = config.get("user").and_then(Value::as_str).unwrap_or("Unknown account").to_owned();
    let backup_dir = config.get("backupDirectory").and_then(Value::as_str).unwrap_or("backups");
    let backup_root = root.join(backup_dir);
    let manifest = read_json(&backup_root.join("manifest.json"));
    let folders = manifest.as_ref().and_then(|m| m.get("folders")).and_then(Value::as_object);
    let total_messages = folders.map(|items| items.values().filter_map(|folder| folder.get("messages")?.as_object()).map(|m| m.len() as u64).sum()).unwrap_or(0);
    Ok(Dashboard {
        credential_ready: root.join(".private/zoho-credential.xml").is_file(),
        schedule_installed: schedule_exists(&user),
        has_manifest: manifest.is_some(), total_messages,
        folder_count: folders.map_or(0, |value| value.len()),
        last_run: read_json(&backup_root.join("last-run.json")),
        latest_log: latest_log(&root), user,
    })
}

fn powershell(root: &Path, script: &str) -> Result<std::process::Output, String> {
    Command::new("powershell.exe").current_dir(root).args([
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"
    ]).arg(root.join(script)).output().map_err(|e| format!("Could not start PowerShell: {e}"))
}

#[tauri::command]
async fn run_action(action: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = project_root()?;
        let (program, output) = match action.as_str() {
            "backup" => ("Backup", powershell(&root, "Run-Backup.ps1")?),
            "schedule" => ("Schedule", powershell(&root, "Install-BackupSchedule.ps1")?),
            "verify" => ("Verification", Command::new("node").current_dir(&root).args(["backup.cjs", "--verify"])
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
fn open_directory(kind: String) -> Result<(), String> {
    let root = project_root()?;
    let target = match kind.as_str() { "backups" => root.join("backups"), "logs" => root.join("logs"), _ => return Err("Unknown folder".into()) };
    fs::create_dir_all(&target).map_err(|e| format!("Could not create folder: {e}"))?;
    Command::new("explorer.exe").arg(&target).spawn().map(|_| ()).map_err(|e| format!("Could not open folder: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_dashboard, run_action, open_directory])
        .run(tauri::generate_context!())
        .expect("error while running Mail Vault");
}
