use serde_json::{Value, json};
use std::{io::{BufRead, BufReader, Write}, path::Path, process::{Child, ChildStdin, ChildStdout, Stdio}, sync::Mutex};
use tauri::Manager;

/// A long-lived `read-mail.cjs --serve` process. Reusing it avoids starting
/// Node.js for every page, sort, or opened message and keeps the parsed mailbox
/// in memory between requests. The worker exits by itself when idle.
struct Worker { child: Child, input: ChildStdin, output: BufReader<ChildStdout>, next_id: u64 }

impl Drop for Worker {
    fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); }
}

#[derive(Default)]
pub struct MailReader(Mutex<Option<Worker>>);

fn spawn_worker(engine: &Path) -> Result<Worker, String> {
    let mut child = super::hidden_command(engine.join("node.exe")).arg(engine.join("read-mail.cjs")).arg("--serve")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|e| format!("Could not open saved email: {e}"))?;
    let input = child.stdin.take().ok_or("Email reader input is unavailable")?;
    let output = BufReader::new(child.stdout.take().ok_or("Email reader output is unavailable")?);
    Ok(Worker { child, input, output, next_id: 0 })
}

/// Ok(Err(..)) is a reader error to show the user; Err(..) means the worker
/// itself failed and should be replaced.
fn exchange(worker: &mut Worker, data: &Path, request: &Value) -> Result<Result<Value, String>, ()> {
    worker.next_id += 1;
    let id = worker.next_id;
    let mut line = json!({"id": id, "data": data, "request": request}).to_string();
    line.push('\n');
    worker.input.write_all(line.as_bytes()).and_then(|_| worker.input.flush()).map_err(|_| ())?;
    let mut response = String::new();
    if worker.output.read_line(&mut response).map_err(|_| ())? == 0 { return Err(()); }
    let response: Value = serde_json::from_str(&response).map_err(|_| ())?;
    if response.get("id").and_then(Value::as_u64) != Some(id) { return Err(()); }
    Ok(if response.get("ok").and_then(Value::as_bool) == Some(true) { Ok(response.get("result").cloned().unwrap_or(Value::Null)) }
        else { Err(response.get("error").and_then(Value::as_str).unwrap_or("Could not read saved mail.").to_owned()) })
}

fn read_mail(app: &tauri::AppHandle, request: Value) -> Result<Value, String> {
    let data = super::data_root(app)?;
    let engine = super::engine_root(app)?;
    let reader = app.state::<MailReader>();
    let mut slot = reader.0.lock().map_err(|_| "The email reader is unavailable")?;
    // One retry covers a worker that exited after its idle timeout.
    for _ in 0..2 {
        if slot.as_mut().is_none_or(|worker| !matches!(worker.child.try_wait(), Ok(None))) { *slot = Some(spawn_worker(&engine)?); }
        if let Ok(result) = exchange(slot.as_mut().expect("worker was just started"), &data, &request) { return result; }
        *slot = None;
    }
    drop(slot);
    read_once(&engine, &data, request)
}

/// Fallback used only if the persistent worker cannot answer.
fn read_once(engine: &Path, data: &Path, request: Value) -> Result<Value, String> {
    let list = request.get("kind").and_then(Value::as_str) != Some("message");
    let mut command = super::hidden_command(engine.join("node.exe"));
    command.arg(engine.join("read-mail.cjs"));
    if list { command.arg("--list"); }
    let mut child = command.env("MAIL_VAULT_DATA_DIR", data)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|e| format!("Could not open saved email: {e}"))?;
    let mut request = request;
    if request.get("kind").and_then(Value::as_str) == Some("page") { request["paginated"] = json!(true); }
    child.stdin.take().ok_or("Email reader input is unavailable")?.write_all(request.to_string().as_bytes()).map_err(|e| e.to_string())?;
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned()); }
    serde_json::from_slice(&output.stdout).map_err(|_| "Could not read the email content.".into())
}

#[tauri::command]
pub async fn get_mail_page(app: tauri::AppHandle, folder: Option<String>, page: Option<u32>, page_size: Option<u32>, sort_column: Option<String>, sort_direction: Option<String>, query: Option<String>, filters: Option<Value>, include_senders: Option<bool>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_mail(&app, json!({"kind": "page", "folder": folder, "query": query, "filters": filters, "includeSenders": include_senders.unwrap_or(false), "page": page.unwrap_or(1), "pageSize": page_size.unwrap_or(50),
            "sortColumn": sort_column.unwrap_or_else(|| "sentAt".into()), "sortDirection": sort_direction.unwrap_or_else(|| "desc".into())}))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_saved_mail(app: tauri::AppHandle, folder: Option<String>) -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = read_mail(&app, json!({"kind": "list", "folder": folder}))?;
        serde_json::from_value(result).map_err(|_| "Could not load saved mail.".into())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_saved_message(app: tauri::AppHandle, file: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || read_mail(&app, json!({"kind": "message", "file": file}))).await.map_err(|e| e.to_string())?
}
