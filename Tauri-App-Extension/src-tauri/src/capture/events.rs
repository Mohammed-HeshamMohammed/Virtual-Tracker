use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;
use rand::Rng;

use crate::capture::activity::ActivityMeter;
use crate::capture::screen::ScreenCapture;
use crate::capture::window::{read_browser_url, ForegroundWindow};
use crate::constants::{
    APP_LOG_INTERVAL_SEC, MAX_APP_NAME_LEN, MAX_PAGE_TITLE_LEN, MAX_URL_LEN,
    SCREENSHOT_MAX_DELAY_SEC, SCREENSHOT_MIN_DELAY_SEC, URL_CAPTURE_TICK_BUDGET_SEC,
};
use crate::types::ActivityEvent;
use crate::util::truncate;

pub struct EventBuilder {
    screen: ScreenCapture,
    activity: Arc<ActivityMeter>,
    url_script_path: PathBuf,
    macos_url_script_path: PathBuf,
    /// MAC-3/CQ-4: server-delivered app-name overrides (CLS-1's
    /// activity_categories, keyed by lowercased process_name/app_name -
    /// window.rs already normalizes Windows .exe names and macOS display
    /// names into the same field, `process_name`). A pure override layer:
    /// empty (e.g. agent never reached the server, or offline) means every
    /// lookup falls through to window.rs's own resolved app_name exactly as
    /// before this existed - this can never make name resolution worse than
    /// it already was, only better once populated.
    display_names: Mutex<HashMap<String, String>>,
    /// ACT-3: server-tunable screenshot cadence bounds, defaulted to the
    /// compile-time constants and overwritten by `apply_screenshot_cadence`
    /// on the tracker's periodic scoring-settings poll.
    screenshot_min_delay_sec: AtomicU64,
    screenshot_max_delay_sec: AtomicU64,
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
            display_names: Mutex::new(HashMap::new()),
            screenshot_min_delay_sec: AtomicU64::new(SCREENSHOT_MIN_DELAY_SEC),
            screenshot_max_delay_sec: AtomicU64::new(SCREENSHOT_MAX_DELAY_SEC),
        }
    }

    /// ACT-3: applied from the periodic scoring-settings poll. A min above
    /// the max is refused rather than stored - `random_screenshot_delay_sec`
    /// would panic on `rng.gen_range` with an inverted bound, and the
    /// backend already rejects this ordering before it can be sent, so this
    /// is defense in depth, not the primary guard.
    pub fn apply_screenshot_cadence(&self, min_delay_sec: u64, max_delay_sec: u64) {
        if min_delay_sec > 0 && max_delay_sec > 0 && min_delay_sec <= max_delay_sec {
            self.screenshot_min_delay_sec.store(min_delay_sec, Ordering::Relaxed);
            self.screenshot_max_delay_sec.store(max_delay_sec, Ordering::Relaxed);
        }
    }

    /// Replaces the whole cache atomically (not merged) so a mapping removed
    /// server-side actually disappears here too, rather than only ever
    /// growing. Called periodically by the tracker loop - see
    /// DISPLAY_NAME_REFRESH_INTERVAL_SEC.
    pub fn apply_display_names(&self, entries: Vec<(String, String)>) {
        *self.display_names.lock() = entries.into_iter().collect();
    }

    /// The server-delivered name when the cache has one for this window's
    /// process/app name, else whatever window.rs already resolved
    /// (its own overrides() map or algorithmic title-casing on Windows; the
    /// raw xcap display name on macOS).
    fn resolve_app_name(&self, window: &ForegroundWindow) -> String {
        let key = window.process_name.to_lowercase();
        if !key.is_empty() {
            if let Some(name) = self.display_names.lock().get(&key) {
                return name.clone();
            }
        }
        window.app_name.clone()
    }

    pub fn random_screenshot_delay_sec(&self) -> u64 {
        let mut rng = rand::thread_rng();
        let min = self.screenshot_min_delay_sec.load(Ordering::Relaxed);
        let max = self.screenshot_max_delay_sec.load(Ordering::Relaxed);
        let span = max.saturating_sub(min);
        min + rng.gen_range(0..=span)
    }

    pub fn screenshot(&self, window: &ForegroundWindow) -> Option<ActivityEvent> {
        let image_data = self.screen.capture_jpeg_data_url()?;
        Some(ActivityEvent::Screenshot {
            image_data,
            app_name: truncate(&self.resolve_app_name(window), MAX_APP_NAME_LEN),
            page_title: truncate(&window.title, MAX_PAGE_TITLE_LEN),
            activity_level: self.activity.score(),
            signal: self.activity.signal_snapshot(),
        })
    }

    pub fn app_slice(&self, window: &ForegroundWindow) -> ActivityEvent {
        ActivityEvent::App {
            app_name: truncate(&self.resolve_app_name(window), MAX_APP_NAME_LEN),
            page_title: truncate(&window.title, MAX_PAGE_TITLE_LEN),
            duration_seconds: APP_LOG_INTERVAL_SEC,
            signal: self.activity.signal_snapshot(),
        }
    }

    pub fn url_slice(&self, window: &ForegroundWindow) -> Option<ActivityEvent> {
        let url = self.capture_url_bounded(window)?;
        Some(ActivityEvent::Url {
            url: truncate(&url, MAX_URL_LEN),
            page_title: truncate(&window.title, MAX_PAGE_TITLE_LEN),
            duration_seconds: APP_LOG_INTERVAL_SEC,
        })
    }

    /// Suggestion #7: `read_browser_url` spawns a subprocess (PowerShell on
    /// Windows, osascript on macOS) with its own internal timeout up to
    /// URL_SCRIPT_TIMEOUT_SEC (8s) - calling it inline used to make the
    /// tracker's tick thread block for that full worst case, delaying
    /// everything else scheduled for the same tick (including idle
    /// escalation). Running the capture on its own thread and only waiting
    /// URL_CAPTURE_TICK_BUDGET_SEC for it here means a slow script just costs
    /// this tick its URL (falls through to "no URL captured", same as today
    /// when the script fails or returns nothing) instead of stalling the
    /// tracker. The background thread is left to run to its own completion or
    /// timeout independently; a late result after the deadline is simply
    /// dropped (the receiver is gone by then).
    fn capture_url_bounded(&self, window: &ForegroundWindow) -> Option<String> {
        if !window.is_browser {
            return None;
        }
        let script_path = self.url_script_path.clone();
        let macos_script_path = self.macos_url_script_path.clone();
        let process_name = window.process_name.clone();
        let window = window.clone();
        let (tx, rx) = mpsc::channel();
        let spawned = thread::Builder::new()
            .name("vt-url-capture".into())
            .spawn(move || {
                let result = read_browser_url(&script_path, &macos_script_path, &window);
                let _ = tx.send(result);
            })
            .is_ok();
        if !spawned {
            return None;
        }
        match rx.recv_timeout(Duration::from_secs(URL_CAPTURE_TICK_BUDGET_SEC)) {
            Ok(result) => result,
            Err(_) => {
                // Distinct from read_browser_url's own "failed or timed out"
                // warning (that one only fires if the script itself hits its
                // full URL_SCRIPT_TIMEOUT_SEC) - this is the *tick* giving up
                // on waiting, which used to happen silently and looked
                // identical in the feed to a genuine capture failure. Logged
                // once it's actually hit so a still-too-tight budget on some
                // machine shows up as this line, not as an unexplained
                // permanent "no real URLs, ever" the next time someone asks.
                log::warn!(
                    "URL capture: tick gave up after {URL_CAPTURE_TICK_BUDGET_SEC}s waiting on {process_name}, falling back to window title for this tick"
                );
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::activity::ActivityMeter;

    // Guards MAC-3/CQ-4's override layer: the server-delivered cache wins
    // when it has an entry, everything else falls through to what window.rs
    // already resolved - this can never make name resolution worse than
    // doing nothing here, only better once populated.

    fn builder() -> EventBuilder {
        EventBuilder::new(ActivityMeter::new(), PathBuf::new(), PathBuf::new())
    }

    fn window(process_name: &str, app_name: &str) -> ForegroundWindow {
        ForegroundWindow {
            app_name: app_name.to_string(),
            title: "Some Title".to_string(),
            process_name: process_name.to_string(),
            hwnd: 0,
            is_browser: false,
            browser_hint: String::new(),
        }
    }

    #[test]
    fn falls_back_to_window_rs_resolved_name_when_cache_is_empty() {
        let builder = builder();
        let win = window("chrome.exe", "Chrome (title-cased fallback)");
        assert_eq!(builder.resolve_app_name(&win), "Chrome (title-cased fallback)");
    }

    #[test]
    fn a_cached_entry_overrides_the_window_rs_resolved_name() {
        let builder = builder();
        builder.apply_display_names(vec![("chrome.exe".to_string(), "Google Chrome".to_string())]);
        let win = window("chrome.exe", "Chrome (title-cased fallback)");
        assert_eq!(builder.resolve_app_name(&win), "Google Chrome");
    }

    #[test]
    fn lookup_is_case_insensitive_on_process_name() {
        let builder = builder();
        builder.apply_display_names(vec![("chrome.exe".to_string(), "Google Chrome".to_string())]);
        let win = window("CHROME.EXE", "whatever");
        assert_eq!(builder.resolve_app_name(&win), "Google Chrome");
    }

    #[test]
    fn works_uniformly_for_macos_style_process_names() {
        // MAC-2 sets process_name = app_name on macOS (no separate exe form),
        // and CLS-1 seeds macOS-style patterns ("Google Chrome") alongside
        // the Windows .exe ones for exactly this case.
        let builder = builder();
        builder.apply_display_names(vec![("google chrome".to_string(), "Google Chrome".to_string())]);
        let win = window("Google Chrome", "Google Chrome");
        assert_eq!(builder.resolve_app_name(&win), "Google Chrome");
    }

    #[test]
    fn a_refresh_replaces_the_cache_rather_than_merging() {
        let builder = builder();
        builder.apply_display_names(vec![("chrome.exe".to_string(), "Google Chrome".to_string())]);
        builder.apply_display_names(vec![("firefox.exe".to_string(), "Mozilla Firefox".to_string())]);

        let chrome = window("chrome.exe", "fallback name");
        assert_eq!(
            builder.resolve_app_name(&chrome),
            "fallback name",
            "a mapping dropped from a later refresh must actually disappear, not linger"
        );
        let firefox = window("firefox.exe", "fallback");
        assert_eq!(builder.resolve_app_name(&firefox), "Mozilla Firefox");
    }

    #[test]
    fn an_empty_process_name_never_panics_and_falls_back_cleanly() {
        let builder = builder();
        let win = window("", "Unknown");
        assert_eq!(builder.resolve_app_name(&win), "Unknown");
    }

    #[test]
    fn screenshot_delay_defaults_to_the_compile_time_bounds() {
        let builder = builder();
        for _ in 0..20 {
            let delay = builder.random_screenshot_delay_sec();
            assert!(delay >= SCREENSHOT_MIN_DELAY_SEC && delay <= SCREENSHOT_MAX_DELAY_SEC);
        }
    }

    #[test]
    fn apply_screenshot_cadence_takes_effect_immediately() {
        let builder = builder();
        builder.apply_screenshot_cadence(5, 10);
        for _ in 0..20 {
            let delay = builder.random_screenshot_delay_sec();
            assert!((5..=10).contains(&delay), "expected 5..=10, got {delay}");
        }
    }

    #[test]
    fn apply_screenshot_cadence_refuses_an_inverted_range() {
        let builder = builder();
        builder.apply_screenshot_cadence(200, 100); // min > max - must be rejected
        // Falls back to the untouched compile-time defaults, not a broken state.
        let delay = builder.random_screenshot_delay_sec();
        assert!(delay >= SCREENSHOT_MIN_DELAY_SEC && delay <= SCREENSHOT_MAX_DELAY_SEC);
    }
}
