use serde_json::{Value, json};

fn folder_messages(manifest: &Value, selected: Option<&str>) -> Vec<Value> {
    let mut messages = Vec::new();
    if let Some(folders) = manifest["folders"].as_object() {
        for folder in folders.values() {
            let name = folder["name"].as_str().unwrap_or("Unknown");
            if selected.is_some_and(|selected| selected != name) { continue; }
            if let Some(records) = folder["messages"].as_object() {
                for record in records.values().filter(|record| record["complete"].as_bool() != Some(false)) {
                    messages.push(json!({"folder": name, "file": record["file"], "subject": record["subject"], "sender": record["sender"], "backedUpAt": record["backedUpAt"]}));
                }
            }
        }
    }
    messages
}

#[tauri::command]
pub async fn get_saved_mail(app: tauri::AppHandle, folder: Option<String>) -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = super::backup_root(&super::data_root(&app)?).join("manifest.json");
        if !path.exists() { return Ok(Vec::new()); }
        let manifest = super::read_json(&path).ok_or("Could not read saved mail. Refresh to try again.")?;
        Ok(folder_messages(&manifest, folder.as_deref().filter(|name| !name.is_empty())))
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lists_every_complete_email_in_selected_folder_across_uid_generations() {
        let records: serde_json::Map<String, Value> = (1..=35).map(|uid| (uid.to_string(), json!({"subject": format!("Mail {uid}"), "file": format!("{uid}.eml")}))).collect();
        let manifest = json!({"folders": {
            "inbox-old": {"name": "INBOX", "messages": records},
            "inbox-new": {"name": "INBOX", "messages": {"1": {"file": "new.eml"}, "2": {"complete": false}}},
            "sent": {"name": "Sent", "messages": {"1": {"file": "sent.eml"}}}
        }});
        assert_eq!(folder_messages(&manifest, Some("INBOX")).len(), 36);
        assert_eq!(folder_messages(&manifest, Some("Sent")).len(), 1);
        assert_eq!(folder_messages(&manifest, None).len(), 37);
        assert!(folder_messages(&manifest, Some("Empty")).is_empty());
    }
}


#[tauri::command]
pub async fn get_saved_message(app: tauri::AppHandle, file: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::{io::Write, process::Stdio};
        let root = super::data_root(&app)?;
        let engine = super::engine_root(&app)?;
        let mut child = super::hidden_command(engine.join("node.exe"))
            .arg(engine.join("read-mail.cjs")).env("MAIL_VAULT_DATA_DIR", root)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().map_err(|e| format!("Could not open saved email: {e}"))?;
        child.stdin.take().ok_or("Email reader input is unavailable")?.write_all(json!({"file": file}).to_string().as_bytes()).map_err(|e| e.to_string())?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned()); }
        serde_json::from_slice(&output.stdout).map_err(|_| "Could not read the email content.".into())
    }).await.map_err(|e| e.to_string())?
}
