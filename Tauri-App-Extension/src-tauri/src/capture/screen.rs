use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::{ColorType, ImageEncoder};

use crate::constants::{JPEG_QUALITY, MAX_SCREENSHOT_WIDTH};

pub struct ScreenCapture;

impl ScreenCapture {
    pub fn new() -> Self {
        Self
    }

    pub fn capture_jpeg_data_url(&self) -> Option<String> {
        if is_session_locked() {
            log::info!("Screenshot skipped: session is locked");
            return None;
        }
        let Some(monitor) = active_monitor() else {
            log::warn!("Screenshot skipped: no monitors detected");
            return None;
        };
        let image = match monitor.capture_image() {
            Ok(img) => img,
            Err(err) => {
                log::warn!("Screenshot skipped: capture_image failed: {err}");
                return None;
            }
        };

        let mut rgba = image;
        let width = rgba.width();
        let height = rgba.height();
        if width > MAX_SCREENSHOT_WIDTH {
            let scale = MAX_SCREENSHOT_WIDTH as f32 / width as f32;
            let new_h = (height as f32 * scale).round() as u32;
            rgba = image::imageops::resize(
                &rgba,
                MAX_SCREENSHOT_WIDTH,
                new_h,
                image::imageops::FilterType::Lanczos3,
            );
        }

        // JPEG has no alpha channel — the encoder rejects Rgba8 outright ("does not
        // support the color type Rgba8"), which silently killed every screenshot.
        let rgb = image::DynamicImage::ImageRgba8(rgba).into_rgb8();

        let mut jpeg = Vec::new();
        {
            let encoder = JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY);
            if let Err(err) = encoder.write_image(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                ColorType::Rgb8.into(),
            ) {
                log::warn!("Screenshot skipped: JPEG encode failed: {err}");
                return None;
            }
        }
        let encoded = base64::engine::general_purpose::STANDARD.encode(&jpeg);
        Some(format!("data:image/jpeg;base64,{encoded}"))
    }
}

/// Picks the monitor showing the actual foreground/focused window - the same
/// window capture/window.rs logs as the active app - so a screenshot always
/// matches what was recorded as active. Multi-monitor setups where the mouse
/// is parked on a different screen than the focused window used to disagree
/// on which monitor got captured. Falls back to the cursor position, then to
/// the first enumerated monitor, if the foreground window is unavailable or
/// doesn't resolve to one.
fn active_monitor() -> Option<xcap::Monitor> {
    if let Some((x, y)) = foreground_window_center() {
        if let Ok(monitor) = xcap::Monitor::from_point(x, y) {
            return Some(monitor);
        }
    }
    if let Some((x, y)) = cursor_position() {
        if let Ok(monitor) = xcap::Monitor::from_point(x, y) {
            return Some(monitor);
        }
    }
    match xcap::Monitor::all() {
        Ok(monitors) => monitors.into_iter().next(),
        Err(err) => {
            log::warn!("Screenshot: could not enumerate monitors: {err}");
            None
        }
    }
}

/// Center point of the current foreground window's bounds, reusing
/// `capture::window::get_foreground_window`'s HWND rather than a second,
/// separate foreground-window lookup.
#[cfg(windows)]
fn foreground_window_center() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let window = crate::capture::window::get_foreground_window();
    if window.hwnd == 0 {
        return None;
    }
    let hwnd = HWND(window.hwnd as *mut std::ffi::c_void);
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.ok()?;
    Some(((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2))
}

#[cfg(not(windows))]
fn foreground_window_center() -> Option<(i32, i32)> {
    None
}

#[cfg(windows)]
fn cursor_position() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point) }.ok()?;
    Some((point.x, point.y))
}

#[cfg(not(windows))]
fn cursor_position() -> Option<(i32, i32)> {
    None
}

/// Whether the interactive desktop is currently the secure/locked one
/// (Winlogon's lock-screen desktop) rather than the normal "Default" desktop
/// a regular user session captures. `OpenInputDesktop` with
/// `DESKTOP_SWITCHDESKTOP` access fails when the calling process's session
/// can't reach the current input desktop - the standard cheap signal for
/// "the workstation is locked" - so capture is skipped rather than uploading
/// a screenshot with no tracking value.
#[cfg(windows)]
fn is_session_locked() -> bool {
    use windows::Win32::System::StationsAndDesktops::{
        CloseDesktop, OpenInputDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_SWITCHDESKTOP,
    };
    unsafe {
        match OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_SWITCHDESKTOP) {
            Ok(hdesk) => {
                let _ = CloseDesktop(hdesk);
                false
            }
            Err(_) => true,
        }
    }
}

#[cfg(not(windows))]
fn is_session_locked() -> bool {
    false
}
