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
        let monitors = xcap::Monitor::all().ok()?;
        let monitor = monitors.into_iter().next()?;
        let image = monitor.capture_image().ok()?;

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

        let mut jpeg = Vec::new();
        {
            let encoder = JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY);
            encoder
                .write_image(
                    rgba.as_raw(),
                    rgba.width(),
                    rgba.height(),
                    ColorType::Rgba8.into(),
                )
                .ok()?;
        }
        let encoded = base64::engine::general_purpose::STANDARD.encode(&jpeg);
        Some(format!("data:image/jpeg;base64,{encoded}"))
    }
}
