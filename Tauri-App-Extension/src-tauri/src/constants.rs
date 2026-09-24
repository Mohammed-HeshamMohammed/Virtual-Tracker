//! Shared timing and API limits (aligned with the former Python agent + web tracker).

/// Always matches Cargo.toml's `version` at compile time — no separate string to drift.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const AGENT_NAME: &str = "tauri";

/// Production dashboard frontend.
pub const PROD_WEB_URL: &str = "https://app.myvirtualtracker.com";
/// Production dashboard / activity API.
pub const PROD_API_URL: &str = "https://appapi.myvirtualtracker.com";
pub const PROD_AUTH_URL: &str = "https://auth.myvirtualtracker.com";

pub const SESSION_POLL_SEC: u64 = 5;
pub const APP_LOG_INTERVAL_SEC: u64 = 15;

/// How stale a cached browser URL may be before a screenshot stops carrying it.
pub const URL_CACHE_MAX_AGE_SEC: u64 = APP_LOG_INTERVAL_SEC * 2;

/// How stale a cached URL may be and still veto a screenshot's clarity.
pub const URL_BLUR_GRACE_SEC: u64 = APP_LOG_INTERVAL_SEC * 8;

/// How often the tracker flushes its accumulated active/idle seconds back to the backend
/// session so "hours worked" reflects reality within this window instead of only updating
pub const SESSION_SYNC_INTERVAL_SEC: u64 = 20;
/// Kept comfortably under 20s even with SESSION_POLL_SEC tick jitter.
pub const FIRST_SCREENSHOT_DELAY_SEC: u64 = 5;
/// MAC-3/CQ-4: how often the tracker re-fetches the server-delivered app-name/display-name
/// map (CLS-1's activity_categories).
pub const DISPLAY_NAME_REFRESH_INTERVAL_SEC: u64 = 30 * 60;
/// ACT-3: how often the tracker re-fetches server-tunable activity scoring calibration.
pub const ACTIVITY_SCORING_REFRESH_INTERVAL_SEC: u64 = 30 * 60;

pub const SCREENSHOT_MIN_DELAY_SEC: u64 = 90;
pub const SCREENSHOT_MAX_DELAY_SEC: u64 = 210;

pub const ACTIVITY_WINDOW_MS: u64 = 60_000;
/// ACT-2: this is now a *weighted-points* saturation, not a raw event count - see
/// KEYBOARD_INPUT_WEIGHT etc below.
pub const ACTIVITY_SATURATION_EVENTS: u64 = 120;
pub const ACTIVITY_MIN_SCORE: u32 = 5;

// ─── ACT-2: score keystroke *work*, not keystroke *count* ────────────────── "Weight
// keyboard > mouse-click > mouse-move.
pub const KEYBOARD_INPUT_WEIGHT: u64 = 3;
pub const MOUSE_CLICK_WEIGHT: u64 = 2;
pub const MOUSE_MOVE_WEIGHT: u64 = 1;
/// "200 presses of the same key...
pub const MIN_DISTINCT_KEY_RATIO: f64 = 0.15;
/// How many recent keydown timestamps are kept to judge cadence variance.
pub const CADENCE_SAMPLE_SIZE: usize = 30;
/// Below this many samples, cadence is too small a sample to judge - no penalty either way.
pub const CADENCE_MIN_SAMPLES: usize = 10;
/// "...or perfectly even 100ms spacing is a macro." A standard deviation of inter-keystroke
/// intervals below this, with enough samples, reads as mechanical rather than
pub const CADENCE_MACHINE_STDDEV_MS: f64 = 15.0;
/// Multiplier applied to keyboard's weighted contribution when cadence looks mechanical
pub const CADENCE_MACHINE_PENALTY: f64 = 0.3;
/// No mouse/keyboard input for this long counts a tick as idle rather than active time.
pub const IDLE_THRESHOLD_SEC: u64 = 60;

pub const TOKEN_REFRESH_BUFFER_MS: i64 = 120_000;

/// Consecutive failed connection checks (polled every 5s, see App.tsx) before the agent
/// shows its recovery screen.
pub const CONNECTION_FAILURE_GRACE: u32 = 5;
pub const MIN_TOKEN_LENGTH: usize = 20;

pub const HTTP_TIMEOUT_SEC: u64 = 15;
pub const EVENT_POST_TIMEOUT_SEC: u64 = 30;
pub const URL_SCRIPT_TIMEOUT_SEC: u64 = 8;
/// How long the tracker tick thread will wait on the background URL-capture thread before
/// giving up on this tick's URL and moving on (Suggestion #7).
pub const URL_CAPTURE_TICK_BUDGET_SEC: u64 = 7;

/// After this many consecutive failed URL reads for one browser window, stop probing it for
/// URL_CAPTURE_BACKOFF_SEC.
pub const URL_CAPTURE_MAX_FAILURES: u32 = 3;
pub const URL_CAPTURE_BACKOFF_SEC: u64 = 300;

/// App-icon extraction subprocess ceiling.
#[cfg(windows)]
pub const APP_ICON_SCRIPT_TIMEOUT_SEC: u64 = 10;
/// A 32x32 PNG icon is ~1-6 KB; anything past this is not an icon and is dropped rather
/// than sent.
#[cfg(windows)]
pub const MAX_APP_ICON_LEN: usize = 65_536;

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
