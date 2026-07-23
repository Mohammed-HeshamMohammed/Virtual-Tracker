use std::path::PathBuf;
use std::sync::Arc;

use rand::Rng;

use crate::capture::activity::ActivityMeter;
use crate::capture::screen::ScreenCapture;
use crate::capture::window::{read_browser_url, ForegroundWindow};
use crate::constants::{
    APP_LOG_INTERVAL_SEC, MAX_APP_NAME_LEN, MAX_PAGE_TITLE_LEN, MAX_URL_LEN,
    SCREENSHOT_MAX_DELAY_SEC, SCREENSHOT_MIN_DELAY_SEC,
};
use crate::types::ActivityEvent;
use crate::util::truncate;

pub struct EventBuilder {
    screen: ScreenCapture,
    activity: Arc<ActivityMeter>,
    url_script_path: PathBuf,
    macos_url_script_path: PathBuf,
}

impl EventBuilder {
    pub fn new(
        activity: Arc<ActivityMeter>,
        url_script_path: PathBuf,
        macos_url_script_path: PathBuf,
    ) -> Self {
        Self {
            screen: ScreenCapture::new(),
            activity,
            url_script_path,
            macos_url_script_path,
        }
    }

    pub fn random_screenshot_delay_sec(&self) -> u64 {
        let mut rng = rand::thread_rng();
        let span = SCREENSHOT_MAX_DELAY_SEC - SCREENSHOT_MIN_DELAY_SEC;
        SCREENSHOT_MIN_DELAY_SEC + rng.gen_range(0..=span)
    }

    pub fn screenshot(&self, window: &ForegroundWindow) -> Option<ActivityEvent> {
        let image_data = self.screen.capture_jpeg_data_url()?;
        Some(ActivityEvent::Screenshot {
            image_data,
            app_name: truncate(&window.app_name, MAX_APP_NAME_LEN),
            page_title: truncate(&window.title, MAX_PAGE_TITLE_LEN),
            activity_level: self.activity.score(),
        })
    }

    pub fn app_slice(&self, window: &ForegroundWindow) -> ActivityEvent {
        ActivityEvent::App {
            app_name: truncate(&window.app_name, MAX_APP_NAME_LEN),
            page_title: truncate(&window.title, MAX_PAGE_TITLE_LEN),
            duration_seconds: APP_LOG_INTERVAL_SEC,
        }
    }

    pub fn url_slice(&self, window: &ForegroundWindow) -> Option<ActivityEvent> {
        let url = read_browser_url(
            &self.url_script_path,
            &self.macos_url_script_path,
            window,
        )?;
        Some(ActivityEvent::Url {
            url: truncate(&url, MAX_URL_LEN),
            page_title: truncate(&window.title, MAX_PAGE_TITLE_LEN),
            duration_seconds: APP_LOG_INTERVAL_SEC,
        })
    }
}
