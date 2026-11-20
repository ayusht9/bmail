use std::sync::Mutex;

const ICON_SIZE: usize = 64;

#[derive(Default)]
pub struct TaskbarIconState(Mutex<isize>);

fn compose_icon(base: &[u8], width: u32, height: u32, count: u32) -> Result<Vec<u8>, String> {
    let (width, height) = (width as usize, height as usize);
    if width == 0 || height == 0 || base.len() != width * height * 4 {
        return Err("The taskbar icon has invalid dimensions.".into());
    }
    let mut pixels = vec![0; ICON_SIZE * ICON_SIZE * 4];
    // Bilinear sampling preserves the envelope's antialiased edges at taskbar sizes.
    for y in 0..ICON_SIZE {
        for x in 0..ICON_SIZE {
            let source_x = ((x as f32 + 0.5) * width as f32 / ICON_SIZE as f32 - 0.5).max(0.0);
            let source_y = ((y as f32 + 0.5) * height as f32 / ICON_SIZE as f32 - 0.5).max(0.0);
            let left = (source_x as usize).min(width - 1);
            let top = (source_y as usize).min(height - 1);
            let right = (left + 1).min(width - 1);
            let bottom = (top + 1).min(height - 1);
            let dx = source_x - left as f32;
            let dy = source_y - top as f32;
            for channel in 0..4 {
                let upper = base[(top * width + left) * 4 + channel] as f32 * (1.0 - dx)
                    + base[(top * width + right) * 4 + channel] as f32 * dx;
                let lower = base[(bottom * width + left) * 4 + channel] as f32 * (1.0 - dx)
                    + base[(bottom * width + right) * 4 + channel] as f32 * dx;
                pixels[(y * ICON_SIZE + x) * 4 + channel] = (upper * (1.0 - dy) + lower * dy).round() as u8;
            }
        }
    }
    if count == 0 { return Ok(pixels); }
    let badge = crate::notifications::badge_pixels(count);
    for y in 0..32 {
        for x in 0..32 {
            let source = (y * 32 + x) * 4;
            let destination = (y * ICON_SIZE + x + ICON_SIZE - 32) * 4;
            let foreground = badge[source + 3] as f32 / 255.0;
            let background = pixels[destination + 3] as f32 / 255.0;
            let alpha = foreground + background * (1.0 - foreground);
            if alpha == 0.0 { continue; }
            for channel in 0..3 {
                pixels[destination + channel] = ((badge[source + channel] as f32 * foreground
                    + pixels[destination + channel] as f32 * background * (1.0 - foreground)) / alpha).round() as u8;
            }
            pixels[destination + 3] = (alpha * 255.0).round() as u8;
        }
    }
    Ok(pixels)
}

#[cfg(target_os = "windows")]
mod native {
    use std::ffi::c_void;

    #[link(name = "user32")]
    unsafe extern "system" {
        pub fn CreateIcon(instance: *mut c_void, width: i32, height: i32, planes: u8, bits: u8, mask: *const u8, pixels: *const u8) -> *mut c_void;
        pub fn SendMessageW(window: *mut c_void, message: u32, wparam: usize, lparam: isize) -> isize;
        pub fn DestroyIcon(icon: *mut c_void) -> i32;
    }
}

#[cfg(target_os = "windows")]
impl Drop for TaskbarIconState {
    fn drop(&mut self) {
        if let Ok(icon) = self.0.get_mut() {
            if *icon != 0 {
                // SAFETY: this state owns only handles created by CreateIcon below.
                unsafe { native::DestroyIcon(*icon as *mut _); }
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub fn apply(app: &tauri::AppHandle, window: &tauri::WebviewWindow, count: u32) -> Result<(), String> {
    use tauri::Manager;
    let base = app.default_window_icon().ok_or("The default taskbar icon is unavailable")?;
    let mut pixels = compose_icon(base.rgba(), base.width(), base.height(), count)?;
    for pixel in pixels.chunks_exact_mut(4) { pixel.swap(0, 2); } // Win32 uses BGRA.
    let mask = vec![0u8; ICON_SIZE * ICON_SIZE / 8];
    let window_handle = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    // SAFETY: mask and BGRA buffers match the specified 64x64, 32-bit dimensions;
    // CreateIcon copies their contents, so these buffers can be dropped afterward.
    let icon = unsafe { native::CreateIcon(std::ptr::null_mut(), ICON_SIZE as i32, ICON_SIZE as i32, 1, 32, mask.as_ptr(), pixels.as_ptr()) } as isize;
    if icon == 0 { return Err(format!("Could not create taskbar icon: {}", std::io::Error::last_os_error())); }
    let app = app.clone();
    let result = window.run_on_main_thread(move || {
        // SAFETY: the HWND belongs to the live Tauri window. WM_SETICON with
        // ICON_BIG updates the taskbar/Alt-Tab icon without altering the small icon.
        unsafe { native::SendMessageW(window_handle as *mut _, 0x0080, 1, icon); }
        if let Ok(mut previous) = app.state::<TaskbarIconState>().0.lock() {
            let old = std::mem::replace(&mut *previous, icon);
            // WM_SETICON does not own or free the caller's HICON.
            if old != 0 { unsafe { native::DestroyIcon(old as *mut _); } }
        }
    });
    if let Err(error) = result {
        // The icon was never handed to the UI thread, so release it here.
        unsafe { native::DestroyIcon(icon as *mut _); }
        return Err(error.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn badges_change_only_the_upper_right_and_zero_restores_the_original() {
        let base = [16, 61, 67, 255].repeat(ICON_SIZE * ICON_SIZE);
        let plain = compose_icon(&base, 64, 64, 0).unwrap();
        assert_eq!(plain, base);
        for count in [1, 12, 99, 100, u32::MAX] {
            let badged = compose_icon(&base, 64, 64, count).unwrap();
            assert_ne!(badged, plain);
            for y in 0..64 {
                for x in 0..64 {
                    let offset = (y * 64 + x) * 4;
                    if x < 32 || y >= 32 { assert_eq!(&badged[offset..offset + 4], &plain[offset..offset + 4]); }
                }
            }
        }
        assert!(compose_icon(&[], 0, 0, 1).is_err());
    }
}
