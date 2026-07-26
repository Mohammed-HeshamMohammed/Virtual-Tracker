//! Shared timing and API limits (aligned with the former Python agent + web tracker).

/// Always matches Cargo.toml's `version` at compile time — no separate string to drift.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const AGENT_NAME: &str = "tauri";

/// Production dashboard frontend.
pub const PROD_WEB_URL: &str = "https://app.myvirtualtracker.com";
/// Production dashboard / activity API.
pub const PROD_API_URL: &str = "https://appapi.myvirtualtracker.com";

pub const SESSION_POLL_SEC: u64 = 5;
pub const APP_LOG_INTERVAL_SEC: u64 = 15;
/// How often the tracker flushes its accumulated active/idle seconds back to
/// the backend session so "hours worked" reflects reality within this window
/// instead of only updating on start/stop.
pub const SESSION_SYNC_INTERVAL_SEC: u64 = 20;
/// Kept comfortably under 20s even with SESSION_POLL_SEC tick jitter.
pub const FIRST_SCREENSHOT_DELAY_SEC: u64 = 5;

pub const SCREENSHOT_MIN_DELAY_SEC: u64 = 90;
pub const SCREENSHOT_MAX_DELAY_SEC: u64 = 210;

pub const ACTIVITY_WINDOW_MS: u64 = 60_000;
pub const ACTIVITY_SATURATION_EVENTS: u64 = 120;
pub const ACTIVITY_MIN_SCORE: u32 = 5;
/// No mouse/keyboard input for this long counts a tick as idle rather than
/// active time.
pub const IDLE_THRESHOLD_SEC: u64 = 60;

pub const TOKEN_REFRESH_BUFFER_MS: i64 = 120_000;
pub const MIN_TOKEN_LENGTH: usize = 20;

pub const HTTP_TIMEOUT_SEC: u64 = 15;
pub const EVENT_POST_TIMEOUT_SEC: u64 = 30;
pub const URL_SCRIPT_TIMEOUT_SEC: u64 = 8;

pub const MAX_SCREENSHOT_WIDTH: u32 = 1280;
pub const JPEG_QUALITY: u8 = 72;
pub const MAX_APP_NAME_LEN: usize = 200;
pub const MAX_PAGE_TITLE_LEN: usize = 300;
pub const MAX_URL_LEN: usize = 2000;

pub const EVENT_SOURCE: &str = "agent";
pub const REGISTER_SOURCE: &str = "tauri";

pub const HEALTH_PATH: &str = "/health";
pub const RESUME_LINK_PATH: &str = "/link/resume";
pub const CREDENTIALS_LINK_PATH: &str = "/link/credentials";
