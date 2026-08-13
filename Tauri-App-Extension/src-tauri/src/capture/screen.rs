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

/// Same technique every macOS lock-detection tool uses:
/// `CGSessionCopyCurrentDictionary()` returns the current console session's
/// attributes, keyed (among other things) by `CGSSessionScreenIsLocked` -
/// present and true only while the lock screen is up. Declared by hand
/// rather than pulling in a crate for it, since it's three C functions and
/// one framework link.
///
/// UNVERIFIED, same caveat as `get_foreground_window_macos` in window.rs:
/// there is no C toolchain available in this environment (`cargo check
/// --target aarch64-apple-darwin` fails building Tauri's own
/// `objc2-exception-helper` with "failed to find tool 'cc'"), so this has
/// not been type-checked, built, or run on real macOS hardware. Treat as a
/// first draft to validate there before shipping.
#[cfg(target_os = "macos")]
mod macos_lock {
    use std::os::raw::{c_char, c_void};

    type CFAllocatorRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type CFStringRef = *const c_void;
    type CFBooleanRef = *const c_void;
    type CFStringEncoding = u32;
    type CFIndex = isize;
    type Boolean = u8;
    const K_CF_STRING_ENCODING_UTF8: CFStringEncoding = 0x0800_0100;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGSessionCopyCurrentDictionary() -> CFDictionaryRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(
            alloc: CFAllocatorRef,
            c_str: *const c_char,
            encoding: CFStringEncoding,
        ) -> CFStringRef;
        fn CFDictionaryGetValue(dict: CFDictionaryRef, key: *const c_void) -> *const c_void;
        fn CFBooleanGetValue(boolean: CFBooleanRef) -> Boolean;
        fn CFGetTypeID(cf: *const c_void) -> CFIndex;
        fn CFBooleanGetTypeID() -> CFIndex;
        fn CFRelease(cf: *const c_void);
    }

    pub fn is_session_locked() -> bool {
        unsafe {
            let dict = CGSessionCopyCurrentDictionary();
            // No session dictionary at all (headless, SSH, no active GUI
            // session) means there's no lock screen to hide a capture from -
            // treated as unlocked, not locked.
            if dict.is_null() {
                return false;
            }
            let key = CFStringCreateWithCString(
                std::ptr::null(),
                b"CGSSessionScreenIsLocked\0".as_ptr() as *const c_char,
                K_CF_STRING_ENCODING_UTF8,
            );
            let locked = if key.is_null() {
                false
            } else {
                let value = CFDictionaryGetValue(dict, key);
                // Confirm it's actually a CFBoolean before reinterpreting the
                // pointer as one - a missing key returns null (handled
                // above), but a type mismatch would otherwise read garbage.
                let is_locked = !value.is_null()
                    && CFGetTypeID(value) == CFBooleanGetTypeID()
                    && CFBooleanGetValue(value) != 0;
                CFRelease(key);
                is_locked
            };
            CFRelease(dict);
            locked
        }
    }
}

#[cfg(target_os = "macos")]
fn is_session_locked() -> bool {
    macos_lock::is_session_locked()
}

#[cfg(not(any(windows, target_os = "macos")))]
fn is_session_locked() -> bool {
    false
}
