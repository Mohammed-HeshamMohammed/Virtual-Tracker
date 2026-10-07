use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::{ColorType, ImageEncoder};

use crate::constants::{JPEG_QUALITY, MAX_SCREENSHOT_WIDTH};

/// How much a blurred screenshot is softened. The old 2.5 left text readable at a glance, so
/// the floor is now 8: ordinary text is unreadable but the layout is still recognisable, which
/// is the point - what someone was doing, not what they were reading. A member may choose
/// stronger, never weaker.
pub fn blur_sigma(strength: &str) -> f32 {
    match strength {
        "strong" => 16.0,
        "maximum" => 28.0,
        _ => 8.0,
    }
}

/// Why no screenshot was produced. A locked screen is someone stepping away - nothing
/// is wrong - while a failure is a real fault that will repeat until something changes,
/// and only that kind is worth telling the member about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScreenSkip {
    Locked,
    Failed,
    /// The member limited capture to one screen and they are working on another (or the
    /// chosen one is not connected). Their choice, so not a fault and not counted as one.
    OtherScreen,
}

/// One connected screen, for the member to choose between.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenInfo {
    /// What the choice is saved under: the screen's own name.
    pub id: String,
    pub label: String,
    pub primary: bool,
}

/// What to capture, given the member's choice. Kept free of the capture library so the rules
/// can be tested.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScreenChoice {
    Capture(String),
    Skip,
}

/// `target` is "auto" or a screen name; `active` is the screen the member is working on, when
/// known; `available` is every connected screen.
pub fn choose_screen(target: &str, active: Option<&str>, available: &[String]) -> ScreenChoice {
    if target == crate::prefs::CAPTURE_SCREEN_AUTO {
        return match active.map(str::to_string).or_else(|| available.first().cloned()) {
            Some(name) => ScreenChoice::Capture(name),
            None => ScreenChoice::Skip,
        };
    }
    if !available.iter().any(|name| name == target) {
        return ScreenChoice::Skip;
    }
    match active {
        Some(active) if active != target => ScreenChoice::Skip,
        _ => ScreenChoice::Capture(target.to_string()),
    }
}

pub struct ScreenCapture {
    /// "auto" or one screen's name.
    target: parking_lot::Mutex<String>,
    sigma: parking_lot::Mutex<f32>,
}

impl ScreenCapture {
    pub fn new() -> Self {
        Self {
            target: parking_lot::Mutex::new(crate::prefs::CAPTURE_SCREEN_AUTO.to_string()),
            sigma: parking_lot::Mutex::new(blur_sigma("standard")),
        }
    }

    pub fn set_target(&self, target: &str) {
        let target = target.trim();
        *self.target.lock() = if target.is_empty() { crate::prefs::CAPTURE_SCREEN_AUTO.to_string() } else { target.to_string() };
    }

    pub fn set_blur_strength(&self, strength: &str) {
        *self.sigma.lock() = blur_sigma(strength);
    }

    /// `blur` obscures the image for a personal messaging app/site
    /// (capture/sensitive_apps.rs) - the screenshot is still taken and uploaded, so time
    pub fn capture_jpeg_data_url(&self, blur: bool) -> Result<String, ScreenSkip> {
        if is_session_locked() {
            log::info!("Screenshot skipped: session is locked");
            return Err(ScreenSkip::Locked);
        }
        let target = self.target.lock().clone();
        let monitor = match pick_monitor(&target) {
            Pick::Monitor(monitor) => monitor,
            Pick::OtherScreen => {
                log::info!("Screenshot skipped: the member limited capture to another screen");
                return Err(ScreenSkip::OtherScreen);
            }
            Pick::None => {
                log::warn!("Screenshot skipped: no monitors detected");
                return Err(ScreenSkip::Failed);
            }
        };
        let image = match monitor.capture_image() {
            Ok(img) => img,
            Err(err) => {
                log::warn!("Screenshot skipped: capture_image failed: {err}");
                return Err(ScreenSkip::Failed);
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

        if blur {
            rgba = image::imageops::blur(&rgba, *self.sigma.lock());
        }

        // JPEG has no alpha channel — the encoder rejects Rgba8 outright ("does not support
        // the color type Rgba8"), which silently killed every screenshot.
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
                return Err(ScreenSkip::Failed);
            }
        }
        let encoded = base64::engine::general_purpose::STANDARD.encode(&jpeg);
        Ok(format!("data:image/jpeg;base64,{encoded}"))
    }
}

enum Pick {
    Monitor(xcap::Monitor),
    OtherScreen,
    None,
}

fn monitor_key(monitor: &xcap::Monitor) -> String {
    let name = monitor.name();
    if name.trim().is_empty() { format!("screen-{}", monitor.id()) } else { name.to_string() }
}

/// The screen to capture under the member's choice.
fn pick_monitor(target: &str) -> Pick {
    let Ok(monitors) = xcap::Monitor::all() else {
        return Pick::None;
    };
    let available: Vec<String> = monitors.iter().map(monitor_key).collect();
    let active = active_monitor().map(|m| monitor_key(&m));
    match choose_screen(target, active.as_deref(), &available) {
        ScreenChoice::Capture(name) => monitors
            .into_iter()
            .find(|m| monitor_key(m) == name)
            .map(Pick::Monitor)
            .unwrap_or(Pick::None),
        ScreenChoice::Skip if available.is_empty() => Pick::None,
        ScreenChoice::Skip => Pick::OtherScreen,
    }
}

/// Every connected screen, labelled the way the member knows them.
pub fn list_screens() -> Vec<ScreenInfo> {
    let Ok(monitors) = xcap::Monitor::all() else {
        return Vec::new();
    };
    monitors
        .iter()
        .enumerate()
        .map(|(index, monitor)| {
            let primary = monitor.is_primary();
            ScreenInfo {
                id: monitor_key(monitor),
                label: format!(
                    "Screen {}{} - {}x{}",
                    index + 1,
                    if primary { " (main)" } else { "" },
                    monitor.width(),
                    monitor.height()
                ),
                primary,
            }
        })
        .collect()
}

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
    // Not guessed: when nothing says where the member is working, "unknown" lets "auto" fall
    // back to the first screen and a chosen screen simply be captured.
    None
}

/// Center point of the current foreground window's bounds, reusing
/// `capture::window::get_foreground_window`'s HWND rather than a second, separate
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

/// Whether the interactive desktop is currently the secure/locked one (Winlogon's
/// lock-screen desktop) rather than the normal "Default" desktop a regular user session
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

/// Same technique every macOS lock-detection tool uses: `CGSessionCopyCurrentDictionary()`
/// returns the current console session's attributes, keyed (among other things) by
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
            // No session dictionary at all (headless, SSH, no active GUI session) means
            // there's no lock screen to hide a capture from - treated as unlocked, not
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
                // Confirm it's actually a CFBoolean before reinterpreting the pointer as
                // one - a missing key returns null (handled above), but a type mismatch
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

#[cfg(test)]
mod screen_choice_tests {
    use super::*;

    fn screens(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    #[test]
    fn auto_captures_the_screen_being_worked_on_and_falls_back_to_the_first() {
        let all = screens(&["A", "B"]);
        assert_eq!(choose_screen("auto", Some("B"), &all), ScreenChoice::Capture("B".into()));
        assert_eq!(choose_screen("auto", None, &all), ScreenChoice::Capture("A".into()));
        assert_eq!(choose_screen("auto", None, &[]), ScreenChoice::Skip);
    }

    #[test]
    fn a_chosen_screen_is_captured_only_while_the_member_is_working_on_it() {
        let all = screens(&["A", "B"]);
        assert_eq!(choose_screen("A", Some("A"), &all), ScreenChoice::Capture("A".into()));
        assert_eq!(choose_screen("A", Some("B"), &all), ScreenChoice::Skip, "working on the other screen");
        assert_eq!(choose_screen("A", None, &all), ScreenChoice::Capture("A".into()), "unknown is not a reason to skip");
    }

    #[test]
    fn a_chosen_screen_that_is_not_connected_captures_nothing() {
        let all = screens(&["A"]);
        assert_eq!(choose_screen("B", Some("A"), &all), ScreenChoice::Skip);
        assert_eq!(choose_screen("B", None, &all), ScreenChoice::Skip);
    }

    #[test]
    fn blur_strength_has_a_floor_the_member_can_only_raise() {
        assert_eq!(blur_sigma("standard"), 8.0);
        assert_eq!(blur_sigma("strong"), 16.0);
        assert_eq!(blur_sigma("maximum"), 28.0);
        assert_eq!(blur_sigma("none"), 8.0, "an unknown value never weakens it");
        assert_eq!(blur_sigma(""), 8.0);
    }
}
