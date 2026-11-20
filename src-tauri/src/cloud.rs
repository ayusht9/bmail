use serde_json::{Value, json};
use std::{io::Write, path::Path, process::Stdio};

pub fn status(root: &Path) -> Value {
    let saved = super::read_json(&root.join("cloud-drive.json")).unwrap_or(json!({}));
    let mut public = json!({});
    for key in ["configured", "connected", "automatic", "stage", "driveAccount", "folderName", "folderId", "lastSyncedAt", "completedFiles", "totalFiles", "uploadedBytes", "totalBytes", "skippedFiles", "errorCode", "updatedAt"] {
        if let Some(value) = saved.get(key).filter(|v| v.is_string() || v.is_boolean() || v.is_number()) { public[key] = value.clone(); }
    }
    if matches!(saved["stage"].as_str(), Some("connecting" | "uploading")) && !saved["pid"].as_u64().is_some_and(super::process_running) {
        public["stage"] = json!("interrupted"); public["errorCode"] = json!("failed");
    }
    public
}

pub fn running(root: &Path) -> bool {
    std::fs::read_to_string(root.join(".private/drive.lock")).ok()
        .and_then(|value| value.parse::<u64>().ok()).is_some_and(super::process_running)
}

#[tauri::command]
pub async fn cloud_drive(app: tauri::AppHandle, action: String, value: Option<bool>) -> Result<Value, String> {
    if action == "guide" {
        super::hidden_command("rundll32.exe").args(["url.dll,FileProtocolHandler", "https://developers.google.com/identity/protocols/oauth2/native-app#prerequisites"]).spawn().map_err(|_| "Could not open the Google Drive setup guide.".to_owned())?;
        return Ok(json!({}));
    }
    if !["status", "setup", "connect", "automatic", "sync", "disconnect"].contains(&action.as_str()) { return Err("Unknown cloud backup action.".into()); }
    let root = super::data_root(&app)?;
    if action == "status" { return Ok(status(&root)); }
    if super::read_json(&root.join("backup-config.json")).and_then(|v| v["user"].as_str().map(str::to_owned)).is_none() {
        return Err("Set up a mailbox before connecting Google Drive.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let engine = super::engine_root(&app)?;
        let mut child = super::hidden_command(engine.join("node.exe"))
            .arg(engine.join("cloud-drive.cjs")).current_dir(&root).env("MAIL_VAULT_DATA_DIR", &root)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
            .map_err(|_| "Could not start Google Drive backup. Reinstall Bmail and retry.".to_owned())?;
        child.stdin.take().ok_or("Cloud backup input is unavailable.")?.write_all(json!({"action": action, "value": value}).to_string().as_bytes()).map_err(|_| "Could not start Google Drive backup.".to_owned())?;
        let output = child.wait_with_output().map_err(|_| "Google Drive backup did not finish.".to_owned())?;
        // The worker returns only a public status, including safe error codes.
        serde_json::from_slice(&output.stdout).map_err(|_| "Could not read Google Drive backup status.".to_owned())
    }).await.map_err(|_| "Google Drive backup did not finish.".to_owned())?
}
