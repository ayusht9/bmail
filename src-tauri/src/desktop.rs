use serde::{Deserialize, Serialize};
use std::{fs, path::Path, sync::Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DesktopPreferences {
    pub close_to_tray: bool,
}

impl Default for DesktopPreferences {
    fn default() -> Self { Self { close_to_tray: true } }
}

pub struct DesktopState(pub Mutex<DesktopPreferences>);

fn read_preferences(base: &Path) -> DesktopPreferences {
    crate::read_json(&base.join("desktop-settings.json"))
        .and_then(|value| serde_json::from_value(value).ok()).unwrap_or_default()
}

fn write_preferences(base: &Path, preferences: &DesktopPreferences) -> Result<(), String> {
    let pending = base.join("desktop-settings.json.pending");
    fs::write(&pending, serde_json::to_vec_pretty(preferences).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Could not save desktop preferences: {e}"))?;
    fs::rename(pending, base.join("desktop-settings.json"))
        .map_err(|e| format!("Could not save desktop preferences: {e}"))
}

#[tauri::command]
pub fn get_desktop_preferences(state: tauri::State<DesktopState>) -> Result<DesktopPreferences, String> {
    state.0.lock().map(|value| value.clone()).map_err(|_| "Desktop preferences are unavailable".into())
}

#[tauri::command]
pub fn save_desktop_preferences(app: tauri::AppHandle, preferences: DesktopPreferences) -> Result<DesktopPreferences, String> {
    let state = app.state::<DesktopState>();
    let mut saved = state.0.lock().map_err(|_| "Desktop preferences are unavailable")?;
    write_preferences(&crate::base_root(&app)?, &preferences)?;
    *saved = preferences.clone();
    Ok(preferences)
}

pub fn restore(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        // Windows may discard an overlay when its taskbar button is recreated.
        let current = app.state::<crate::notifications::MailBadgeState>().0.lock().ok().map(|value| value.clone());
        if let Some((account, count)) = current { let _ = crate::notifications::apply(app, &account, count); }
    }
}

pub fn initialize(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let preferences = read_preferences(&crate::base_root(app).map_err(std::io::Error::other)?);
    app.manage(DesktopState(Mutex::new(preferences)));
    let open = MenuItem::with_id(app, "open-bmail", "Open Bmail", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit-bmail", "Quit Bmail", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &separator, &quit])?;
    let icon = app.default_window_icon().ok_or("Bmail's tray icon is missing")?.clone();
    TrayIconBuilder::with_id("bmail")
        .icon(icon)
        .tooltip("Bmail")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open-bmail" => restore(app),
            "quit-bmail" => app.exit(0),
            _ => {},
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) {
                restore(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != "main" { return; }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let app = window.app_handle();
        let close_to_tray = app.state::<DesktopState>().0.lock().map(|value| value.close_to_tray).unwrap_or(false);
        // Never hide the only window if no working tray can restore it.
        if close_to_tray && app.tray_by_id("bmail").is_some() && window.hide().is_ok() {
            api.prevent_close();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desktop_preferences_survive_restart_without_changing_accounts() {
        let base = std::env::temp_dir().join(format!("bmail-desktop-settings-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        fs::write(base.join("app-settings.json"), br#"{"activeAccount":"fixture@example.com"}"#).unwrap();
        assert!(read_preferences(&base).close_to_tray);
        let preferences = DesktopPreferences { close_to_tray: false };
        write_preferences(&base, &preferences).unwrap();
        assert_eq!(read_preferences(&base), preferences);
        assert_eq!(crate::read_json(&base.join("app-settings.json")).unwrap()["activeAccount"], "fixture@example.com");
        fs::write(base.join("desktop-settings.json"), b"{broken").unwrap();
        assert!(read_preferences(&base).close_to_tray);
        fs::remove_dir_all(base).unwrap();
    }
}
