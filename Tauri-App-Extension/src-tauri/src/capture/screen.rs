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

/// Picks the monitor under the cursor so multi-monitor setups capture whatever
/// screen the user is actually looking at, instead of always the first monitor
/// `xcap::Monitor::all()` happens to enumerate. Falls back to that first monitor
/// if the cursor position is unavailable or doesn't resolve to one.
fn active_monitor() -> Option<xcap::Monitor> {
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
