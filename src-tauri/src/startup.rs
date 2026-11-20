use tauri::Manager;

#[tauri::command]
pub fn finish_startup(app: tauri::AppHandle) -> Result<(), String> {
    // Idempotent: a later readiness signal must not restore a hidden window.
    if let Some(splash) = app.get_webview_window("splashscreen") {
        if let Some(main) = app.get_webview_window("main") {
            main.show().map_err(|e| e.to_string())?;
            let _ = main.set_focus();
        }
        splash.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn install_deadline(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(20));
        // Expose the main window and its retry control even if startup stalls.
        let _ = finish_startup(app);
    });
}
