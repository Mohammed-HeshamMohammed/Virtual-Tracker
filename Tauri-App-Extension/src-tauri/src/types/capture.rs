//! What the agent observes and uploads: activity signal, events, screenshots
//! and the per-app breakdown built from them.

use serde::{Deserialize, Serialize};

#[allow(unused_imports)]
use super::*;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySignal {
    pub keystroke_count: u64,
    pub distinct_key_count: u32,
    pub mouse_distance_px: u64,
    pub injected_event_count: u64,
    pub active_seconds_in_window: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ActivityEvent {
    #[serde(rename = "screenshot")]
    Screenshot {
        #[serde(rename = "imageData")]
        image_data: String,
        #[serde(rename = "appName")]
        app_name: String,
        #[serde(rename = "pageTitle")]
        page_title: String,
        #[serde(rename = "activityLevel")]
        activity_level: u32,
        /// Site open at capture time, when the focused window was a browser and a recent
        /// reading exists.
        #[serde(skip_serializing_if = "Option::is_none")]
        url: Option<String>,
        #[serde(flatten)]
        signal: ActivitySignal,
    },
    #[serde(rename = "app")]
    App {
        #[serde(rename = "appName")]
        app_name: String,
        #[serde(rename = "pageTitle")]
        page_title: String,
        #[serde(rename = "durationSeconds")]
        duration_seconds: u64,
        /// A `data:image/png;base64,…` icon for this app, sent at most once per distinct
        /// app per agent run.
        #[serde(rename = "appIcon", skip_serializing_if = "Option::is_none")]
        app_icon: Option<String>,
        #[serde(flatten)]
        signal: ActivitySignal,
    },
    #[serde(rename = "url")]
    Url {
        url: String,
        #[serde(rename = "pageTitle")]
        page_title: String,
        #[serde(rename = "durationSeconds")]
        duration_seconds: u64,
    },
}

/// One captured screenshot, without its bytes - the image is fetched one at a time via
/// get_screenshot_image.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotRef {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub captured_at: Option<String>,
}

/// One app's share of this week's tracked time on a single project - the task-less
/// counterpart to a task's progress bar: "what have I actually been doing here" instead of
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAppTime {
    #[serde(default)]
    pub app_name: String,
    #[serde(default)]
    pub total_seconds: u64,
}

/// The week's top apps together with what they were drawn from.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAppBreakdown {
    #[serde(default)]
    pub apps: Vec<ProjectAppTime>,
    /// Every app in the week, not just the ones listed.
    #[serde(default)]
    pub total_seconds: u64,
    /// How many distinct apps that total covers.
    #[serde(default)]
    pub app_count: u32,
    /// The sum of `apps` alone, so the gap is stated rather than inferred.
    #[serde(default)]
    pub shown_seconds: u64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    pub blocked: bool,
    pub reason: String,
    pub break_until_ms: i64,
}
