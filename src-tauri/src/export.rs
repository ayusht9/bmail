use std::{fs, path::{Path, PathBuf}, process::Stdio, io::Write};
use serde_json::{Value, json};

fn export_files(root: &Path, manifest: &Value, folder: Option<&str>, file: Option<&str>) -> Result<Vec<PathBuf>, String> {
    if folder.is_some() == file.is_some() { return Err("Choose an email or folder to download.".into()); }
    let base = fs::canonicalize(root).map_err(|_| "Backup folder is unavailable.")?;
    let mut files = Vec::new();
    if let Some(folders) = manifest["folders"].as_object() {
        for entry in folders.values() {
            if folder.is_some_and(|name| entry["name"].as_str() != Some(name)) { continue; }
            if let Some(records) = entry["messages"].as_object() {
                for record in records.values() {
                    if record["complete"].as_bool() == Some(false) { continue; }
                    let Some(relative) = record["file"].as_str() else { continue; };
                    if file.is_some_and(|name| name != relative) { continue; }
                    let source = fs::canonicalize(root.join(relative)).map_err(|_| "A saved email is missing. Run a backup to restore it.")?;
                    if !source.starts_with(&base) || !source.is_file() || source.extension().is_none_or(|ext| !ext.eq_ignore_ascii_case("eml")) {
                        return Err("The saved email path is invalid.".into());
                    }
                    if !files.contains(&source) { files.push(source); }
                }
            }
        }
    }
    if files.is_empty() { return Err("No saved emails are available to download.".into()); }
    Ok(files)
}

#[tauri::command]
pub async fn export_mail(app: tauri::AppHandle, folder: Option<String>, file: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = super::backup_root(&super::data_root(&app)?);
        let manifest = super::read_json(&root.join("manifest.json")).ok_or("No saved emails are available.")?;
        let files = export_files(&root, &manifest, folder.as_deref(), file.as_deref())?;
        let name = folder.as_deref().unwrap_or("email").chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).take(100).collect::<String>();
        let input = json!({"files": files, "zip": folder.is_some(), "name": name});
        let mut child = super::hidden_command("powershell.exe")
            .args(["-NoProfile", "-STA", "-NonInteractive", "-Command", include_str!("export.ps1")])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().map_err(|e| format!("Could not open the save dialog: {e}"))?;
        child.stdin.take().ok_or("Save dialog input is unavailable.")?.write_all(input.to_string().as_bytes()).map_err(|e| e.to_string())?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() { return Err("Could not export the emails. Check the destination permissions and available disk space.".into()); }
        Ok(if String::from_utf8_lossy(&output.stdout).trim() == "saved" { "Download saved.".into() } else { String::new() })
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exports_only_complete_manifest_emails_and_rejects_paths_outside_backup() {
        let root = std::env::temp_dir().join(format!("bmail-export-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("saved.eml"), b"Subject: Test\r\n\r\nHello").unwrap();
        let mut manifest = json!({"folders": {"one": {"name": "INBOX", "messages": {
            "1": {"file": "saved.eml"}, "2": {"file": "missing.eml", "complete": false}
        }}}});
        assert_eq!(export_files(&root, &manifest, Some("INBOX"), None).unwrap().len(), 1);
        assert_eq!(export_files(&root, &manifest, None, Some("saved.eml")).unwrap().len(), 1);
        assert!(export_files(&root, &manifest, Some("Other"), None).is_err());
        assert!(export_files(&root, &manifest, None, Some("missing.eml")).is_err());
        assert!(export_files(&root, &manifest, Some("INBOX"), Some("saved.eml")).is_err());
        let outside = root.with_extension("eml");
        fs::write(&outside, b"private").unwrap();
        manifest["folders"]["one"]["messages"]["1"]["file"] = json!(outside);
        assert!(export_files(&root, &manifest, Some("INBOX"), None).is_err());
        fs::remove_file(outside).unwrap();
        fs::remove_file(root.join("saved.eml")).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
