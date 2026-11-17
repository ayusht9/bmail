use std::sync::Mutex;
use tauri::Manager;

#[derive(Default)]
pub struct MailBadgeState(pub Mutex<(String, u32)>);

fn badge_label(count: u32) -> String {
    if count > 99 { "99+".into() } else { count.to_string() }
}

// A tiny font keeps taskbar rendering independent of installed system fonts.
fn glyph(character: char) -> [u8; 5] {
    match character {
        '0' => [7, 5, 5, 5, 7], '1' => [2, 6, 2, 2, 7],
        '2' => [7, 1, 7, 4, 7], '3' => [7, 1, 7, 1, 7],
        '4' => [5, 5, 7, 1, 1], '5' => [7, 4, 7, 1, 7],
        '6' => [7, 4, 7, 5, 7], '7' => [7, 1, 1, 1, 1],
        '8' => [7, 5, 7, 5, 7], '9' => [7, 5, 7, 1, 7],
        '+' => [0, 2, 7, 2, 0], _ => [0; 5],
    }
}

fn badge_pixels(count: u32) -> Vec<u8> {
    let mut pixels = vec![0; 32 * 32 * 4];
    for y in 0..32 {
        for x in 0..32 {
            let distance = ((x as f32 - 15.5).powi(2) + (y as f32 - 15.5).powi(2)).sqrt();
            let alpha = ((16.0 - distance).clamp(0.0, 1.0) * 255.0) as u8;
            let offset = (y * 32 + x) * 4;
            pixels[offset..offset + 4].copy_from_slice(&[179, 38, 30, alpha]);
        }
    }
    let label = badge_label(count);
    let scale = match label.len() { 1 => 4, 2 => 3, _ => 2 };
    let left = (32 - (label.len() * 4 - 1) * scale) / 2;
    let top = (32 - 5 * scale) / 2;
    for (index, character) in label.chars().enumerate() {
        for (row, bits) in glyph(character).iter().enumerate() {
            for column in 0..3 {
                if bits & (1 << (2 - column)) == 0 { continue; }
                for dy in 0..scale {
                    for dx in 0..scale {
                        let x = left + (index * 4 + column) * scale + dx;
                        let y = top + row * scale + dy;
                        let offset = (y * 32 + x) * 4;
                        pixels[offset..offset + 4].copy_from_slice(&[255; 4]);
                    }
                }
            }
        }
    }
    pixels
}

pub fn apply(app: &tauri::AppHandle, account: &str, count: u32) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "windows")]
        window.set_overlay_icon(if count == 0 { None } else {
            Some(tauri::image::Image::new_owned(badge_pixels(count), 32, 32))
        }).map_err(|e| e.to_string())?;
        window.set_title(&if count == 0 { "Bmail".into() } else {
            format!("Bmail ({count} new emails)")
        }).map_err(|e| e.to_string())?;
    }
    *app.state::<MailBadgeState>().0.lock().map_err(|_| "Mail count is unavailable")? = (account.to_owned(), count);
    Ok(())
}

#[tauri::command]
pub fn set_mail_badge(app: tauri::AppHandle, account: String, count: u32) -> Result<(), String> {
    let root = crate::data_root(&app)?;
    let config = crate::read_json(&root.join("backup-config.json"));
    let active = config.as_ref().and_then(|value| value.get("user")).and_then(|value| value.as_str()).unwrap_or("");
    // A delayed reply from the previous account must not overwrite this badge.
    if active != account { return Ok(()); }
    apply(&app, &account, count)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn taskbar_labels_fit_and_icons_have_transparent_corners() {
        assert_eq!(badge_label(9), "9");
        assert_eq!(badge_label(99), "99");
        assert_eq!(badge_label(u32::MAX), "99+");
        for count in [1, 12, 99, 100, u32::MAX] {
            let pixels = badge_pixels(count);
            assert_eq!(pixels.len(), 32 * 32 * 4);
            assert_eq!(pixels[3], 0);
            assert!(pixels.chunks_exact(4).any(|pixel| pixel == [255; 4]));
        }
        assert_ne!(badge_pixels(1), badge_pixels(2));
    }
}
