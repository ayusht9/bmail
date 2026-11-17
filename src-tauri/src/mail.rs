use serde_json::{Value, json};

#[tauri::command]
pub async fn get_mail_page(app: tauri::AppHandle, folder: Option<String>, page: Option<u32>, page_size: Option<u32>, sort_column: Option<String>, sort_direction: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_with_node(&app, json!({"folder": folder, "page": page.unwrap_or(1), "pageSize": page_size.unwrap_or(50),
            "sortColumn": sort_column.unwrap_or_else(|| "sentAt".into()), "sortDirection": sort_direction.unwrap_or_else(|| "desc".into()), "paginated": true}), true)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_saved_mail(app: tauri::AppHandle, folder: Option<String>) -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = read_with_node(&app, json!({"folder": folder}), true)?;
        serde_json::from_value(result).map_err(|_| "Could not load saved mail.".into())
    }).await.map_err(|e| e.to_string())?
}

fn read_with_node(app: &tauri::AppHandle, request: Value, list: bool) -> Result<Value, String> {
    use std::{io::Write, process::Stdio};
    let root = super::data_root(app)?;
    let engine = super::engine_root(app)?;
    let mut command = super::hidden_command(engine.join("node.exe"));
    command.arg(engine.join("read-mail.cjs"));
    if list { command.arg("--list"); }
    let mut child = command.env("MAIL_VAULT_DATA_DIR", root)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|e| format!("Could not open saved email: {e}"))?;
    child.stdin.take().ok_or("Email reader input is unavailable")?.write_all(request.to_string().as_bytes()).map_err(|e| e.to_string())?;
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned()); }
    serde_json::from_slice(&output.stdout).map_err(|_| "Could not read the email content.".into())
}

#[tauri::command]
pub async fn get_saved_message(app: tauri::AppHandle, file: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || read_with_node(&app, json!({"file": file}), false)).await.map_err(|e| e.to_string())?
}
