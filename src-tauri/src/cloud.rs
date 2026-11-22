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
    ["drive", "dropbox", "icloud"].iter().any(|provider| std::fs::read_to_string(root.join(format!(".private/{provider}.lock"))).ok()
        .and_then(|value| value.parse::<u64>().ok()).is_some_and(super::process_running))
}

pub fn dropbox_status(root: &Path) -> Value {
    let saved = super::read_json(&root.join("cloud-dropbox.json")).unwrap_or(json!({}));
    let mut public = json!({"configured": option_env!("BMAIL_DROPBOX_APP_KEY").is_some() || saved["configured"] == true});
    for key in ["connected", "automatic", "stage", "dropboxAccount", "folderName", "lastSyncedAt", "completedFiles", "totalFiles", "uploadedBytes", "totalBytes", "skippedFiles", "errorCode", "updatedAt"] {
        if let Some(value) = saved.get(key).filter(|v| v.is_string() || v.is_boolean() || v.is_number()) { public[key] = value.clone(); }
    }
    if matches!(saved["stage"].as_str(), Some("connecting" | "uploading")) && !saved["pid"].as_u64().is_some_and(super::process_running) {
        public["stage"] = json!("interrupted"); public["errorCode"] = json!("failed");
    }
    public
}

pub fn icloud_status(root: &Path) -> Value {
    let saved = super::read_json(&root.join("cloud-icloud.json")).unwrap_or(json!({}));
    let mut public = json!({});
    for key in ["connected", "automatic", "stage", "folderName", "lastCopiedAt", "completedFiles", "totalFiles", "copiedBytes", "totalBytes", "skippedFiles", "errorCode", "updatedAt"] {
        if let Some(value) = saved.get(key).filter(|v| v.is_string() || v.is_boolean() || v.is_number()) { public[key] = value.clone(); }
    }
    if saved["stage"] == "copying" && !saved["pid"].as_u64().is_some_and(super::process_running) {
        public["stage"] = json!("interrupted"); public["errorCode"] = json!("failed");
    }
    public
}

#[tauri::command]
pub async fn cloud_icloud(app: tauri::AppHandle, action: String, value: Option<bool>) -> Result<Value, String> {
    if !["status", "setup", "automatic", "sync", "disconnect"].contains(&action.as_str()) { return Err("Unknown iCloud Drive action.".into()); }
    let root = super::data_root(&app)?;
    if action == "status" { return Ok(icloud_status(&root)); }
    if super::read_json(&root.join("backup-config.json")).and_then(|v| v["user"].as_str().map(str::to_owned)).is_none() {
        return Err("Set up a mailbox before choosing an iCloud Drive folder.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let engine = super::engine_root(&app)?;
        let mut request = json!({"action": action, "value": value});
        if action == "setup" {
            let output = super::hidden_command("powershell.exe")
                .args(["-NoProfile", "-STA", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(engine.join("Select-ICloudFolder.ps1")).output().map_err(|_| "Could not open the iCloud Drive folder picker.".to_owned())?;
            if !output.status.success() { return Err("Could not open the iCloud Drive folder picker.".to_owned()); }
            let selected: Value = serde_json::from_slice(&output.stdout).map_err(|_| "Could not read the selected iCloud Drive folder.".to_owned())?;
            if selected["folder"].is_null() { return Ok(icloud_status(&root)); }
            request["value"] = selected["folder"].clone();
        }
        let mut child = super::hidden_command(engine.join("node.exe"))
            .arg(engine.join("cloud-icloud.cjs")).current_dir(&root).env("MAIL_VAULT_DATA_DIR", &root)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
            .map_err(|_| "Could not start the iCloud Drive folder copy.".to_owned())?;
        child.stdin.take().ok_or("Cloud backup input is unavailable.")?.write_all(request.to_string().as_bytes())
            .map_err(|_| "Could not start the iCloud Drive folder copy.".to_owned())?;
        let output = child.wait_with_output().map_err(|_| "The iCloud Drive folder copy did not finish.".to_owned())?;
        serde_json::from_slice(&output.stdout).map_err(|_| "Could not read iCloud Drive copy status.".to_owned())
    }).await.map_err(|_| "The iCloud Drive folder copy did not finish.".to_owned())?
}

#[tauri::command]
pub async fn cloud_dropbox(app: tauri::AppHandle, action: String, value: Option<bool>) -> Result<Value, String> {
    if !["status", "connect", "automatic", "sync", "disconnect"].contains(&action.as_str()) { return Err("Unknown Dropbox action.".into()); }
    let root = super::data_root(&app)?;
    if action == "status" { return Ok(dropbox_status(&root)); }
    if super::read_json(&root.join("backup-config.json")).and_then(|v| v["user"].as_str().map(str::to_owned)).is_none() { return Err("Set up a mailbox before connecting Dropbox.".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let engine = super::engine_root(&app)?;
        let mut child = super::hidden_command(engine.join("node.exe"))
            .arg(engine.join("cloud-dropbox.cjs")).current_dir(&root).env("MAIL_VAULT_DATA_DIR", &root)
            .env("BMAIL_DROPBOX_APP_KEY", option_env!("BMAIL_DROPBOX_APP_KEY").unwrap_or(""))
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
            .map_err(|_| "Could not start Dropbox backup. Reinstall Bmail and retry.".to_owned())?;
        child.stdin.take().ok_or("Cloud backup input is unavailable.")?.write_all(json!({"action": action, "value": value}).to_string().as_bytes()).map_err(|_| "Could not start Dropbox backup.".to_owned())?;
        let output = child.wait_with_output().map_err(|_| "Dropbox backup did not finish.".to_owned())?;
        serde_json::from_slice(&output.stdout).map_err(|_| "Could not read Dropbox backup status.".to_owned())
    }).await.map_err(|_| "Dropbox backup did not finish.".to_owned())?
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn icloud_status_exposes_local_copy_state_without_upload_or_credential_claims() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("bmail-icloud-status-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("cloud-icloud.json"), json!({
            "connected": true, "automatic": true, "stage": "copied", "lastCopiedAt": "2026-11-22T00:00:00Z",
            "lastSyncedAt": "unverified", "password": "fixture-secret", "destination": "private-setting", "pid": 0
        }).to_string()).unwrap();
        let status = icloud_status(&root);
        assert_eq!(status["stage"], "copied");
        assert_eq!(status["automatic"], true);
        assert!(status.get("lastCopiedAt").is_some());
        for field in ["lastSyncedAt", "password", "destination", "pid"] { assert!(status.get(field).is_none()); }
        std::fs::remove_dir_all(root).unwrap();
    }
}
