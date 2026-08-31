//! Shared timing and API limits (aligned with the former Python agent + web tracker).

/// Always matches Cargo.toml's `version` at compile time — no separate string to drift.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const AGENT_NAME: &str = "tauri";

/// Production dashboard frontend.
pub const PROD_WEB_URL: &str = "https://app.myvirtualtracker.com";
/// Production dashboard / activity API.
pub const PROD_API_URL: &str = "https://appapi.myvirtualtracker.com";
/// Auth-Backend. A separate service from the dashboard API, which deliberately
/// 404s every `/api/auth/*` authn route ("This route is handled by
/// Auth-Backend"). Asking the dashboard API for the Firebase web config - as
/// this agent used to - therefore yielded no API key, which silently disabled
/// token refresh *and* device re-auth.
pub const PROD_AUTH_URL: &str = "https://auth.myvirtualtracker.com";

pub const SESSION_POLL_SEC: u64 = 5;
pub const APP_LOG_INTERVAL_SEC: u64 = 15;
/// How often the tracker flushes its accumulated active/idle seconds back to
/// the backend session so "hours worked" reflects reality within this window
/// instead of only updating on start/stop.
pub const SESSION_SYNC_INTERVAL_SEC: u64 = 20;
/// Kept comfortably under 20s even with SESSION_POLL_SEC tick jitter.
pub const FIRST_SCREENSHOT_DELAY_SEC: u64 = 5;
/// MAC-3/CQ-4: how often the tracker re-fetches the server-delivered
/// app-name/display-name map (CLS-1's activity_categories). Display names
/// change rarely - this is deliberately much slower than SESSION_POLL_SEC,
/// not a tick-rate concern. "Adding a browser requires no client release"
/// only needs this to happen eventually, not within seconds.
pub const DISPLAY_NAME_REFRESH_INTERVAL_SEC: u64 = 30 * 60;
/// ACT-3: how often the tracker re-fetches server-tunable activity scoring
/// calibration. Same rationale as DISPLAY_NAME_REFRESH_INTERVAL_SEC - a
/// calibration change is not time-sensitive, so this is paced far slower
/// than SESSION_POLL_SEC.
pub const ACTIVITY_SCORING_REFRESH_INTERVAL_SEC: u64 = 30 * 60;

pub const SCREENSHOT_MIN_DELAY_SEC: u64 = 90;
pub const SCREENSHOT_MAX_DELAY_SEC: u64 = 210;

pub const ACTIVITY_WINDOW_MS: u64 = 60_000;
/// ACT-2: this is now a *weighted-points* saturation, not a raw event count -
/// see KEYBOARD_INPUT_WEIGHT etc below. Left at the same value on purpose:
/// ~40 real keystrokes/minute (40 * 3 = 120) is a realistic "fully active
/// typing" baseline, similar in feel to the old 120-raw-events number it
/// replaces, not a re-tuned target.
pub const ACTIVITY_SATURATION_EVENTS: u64 = 120;
pub const ACTIVITY_MIN_SCORE: u32 = 5;

// ─── ACT-2: score keystroke *work*, not keystroke *count* ──────────────────
// "Weight keyboard > mouse-click > mouse-move. Right now they're equal."
pub const KEYBOARD_INPUT_WEIGHT: u64 = 3;
pub const MOUSE_CLICK_WEIGHT: u64 = 2;
pub const MOUSE_MOVE_WEIGHT: u64 = 1;
/// "200 presses of the same key... is a macro." Keyboard's weighted
/// contribution is scaled by (distinct keys / keystrokes), floored here so a
/// legitimately-held navigation key (arrow keys, backspace) doesn't get
/// credited at near-zero just for repeating.
pub const MIN_DISTINCT_KEY_RATIO: f64 = 0.15;
/// How many recent keydown timestamps are kept to judge cadence variance.
pub const CADENCE_SAMPLE_SIZE: usize = 30;
/// Below this many samples, cadence is too small a sample to judge - no
/// penalty either way.
pub const CADENCE_MIN_SAMPLES: usize = 10;
/// "...or perfectly even 100ms spacing is a macro." A standard deviation of
/// inter-keystroke intervals below this, with enough samples, reads as
/// mechanical rather than human-irregular typing.
pub const CADENCE_MACHINE_STDDEV_MS: f64 = 15.0;
/// Multiplier applied to keyboard's weighted contribution when cadence looks
/// mechanical - a penalty, not a hard zero, since this is still a scoring
/// signal (AC-1's OS-level injected flag is the harder anti-cheat signal).
pub const CADENCE_MACHINE_PENALTY: f64 = 0.3;
/// No mouse/keyboard input for this long counts a tick as idle rather than
/// active time.
pub const IDLE_THRESHOLD_SEC: u64 = 60;

// ─── Idle escalation ────────────────────────────────────────────────────────
// Three stages. The first two only warn; the third stops the timer and
// reverses the active time credited since the user actually stopped working,
// so an unattended machine cannot bank hours nobody worked.
/// First warning flag.
pub const IDLE_FLAG_WARN_SEC: u64 = 5 * 60;
/// Second, louder warning flag.
pub const IDLE_FLAG_ALERT_SEC: u64 = 10 * 60;
/// Timer stops and the idle stretch is reversed.
pub const IDLE_FLAG_STOP_SEC: u64 = 15 * 60;

pub const TOKEN_REFRESH_BUFFER_MS: i64 = 120_000;

/// Consecutive failed connection checks (polled every 5s, see App.tsx) before
/// the agent shows its recovery screen. Was 2 (~10s) - flipped to
/// "Disconnected" on a single brief hiccup in the same token-refresh path
/// that also (independently) stalls session syncs, showing the user a scary
/// screen for something that was resolving itself within a few more seconds.
/// 5 (~25s) still catches a real outage promptly.
pub const CONNECTION_FAILURE_GRACE: u32 = 5;
pub const MIN_TOKEN_LENGTH: usize = 20;

pub const HTTP_TIMEOUT_SEC: u64 = 15;
pub const EVENT_POST_TIMEOUT_SEC: u64 = 30;
pub const URL_SCRIPT_TIMEOUT_SEC: u64 = 8;
/// How long the tracker tick thread will wait on the background URL-capture
/// thread before giving up on this tick's URL and moving on (Suggestion #7).
/// Shorter than URL_SCRIPT_TIMEOUT_SEC - the subprocess itself keeps running
/// in the background up to that full timeout, this only bounds how long the
/// *tick thread* blocks waiting for it.
///
/// Was 2s, which in practice was shorter than get-browser-url.ps1 itself
/// ever needs to finish a real UI Automation read: cold `powershell.exe`
/// startup alone (routinely slowed further by real-time AV scanning of a
/// freshly spawned process) plus `Add-Type -AssemblyName
/// UIAutomationClient`'s first-load JIT cost plus walking a real browser's
/// accessibility tree across the script's up-to-five fallback strategies
/// routinely runs past 2s on an ordinary machine - not a slow/hung outlier
/// case, the normal case. Every tick on every browser tab was giving up
/// before the script had a real chance to answer, so every "site" the
/// activity feed ever showed was the window-title fallback (a bare browser
/// name), never a real domain - a member's actual URL never got captured at
/// all, on any browser, regardless of how healthy the machine was. Raised
/// to sit close to the script's own ceiling instead of well under it -
/// the tick loop already measures real elapsed time rather than assuming a
/// fixed SESSION_POLL_SEC per iteration (see credited_seconds in
/// agent/tracker.rs), so an occasional longer tick here doesn't skew
/// tracked time, it just means idle escalation/session sync land a few
/// seconds later on that one tick.
pub const URL_CAPTURE_TICK_BUDGET_SEC: u64 = 7;

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
