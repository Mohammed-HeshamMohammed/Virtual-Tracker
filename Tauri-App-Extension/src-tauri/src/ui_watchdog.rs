//! Brings back a main window whose page has stopped running.
//!
//! The page reports in every few seconds (`ui_heartbeat`). When the window has been on
//! screen for a while and the page has gone quiet, the page is reloaded: that is the
//! window that is open but shows nothing, which members otherwise only fixed by quitting.
//!
//! Only a window on screen is judged. A hidden or minimized page is throttled by the
//! browser engine and may legitimately report in once a minute, so it is never "stuck".

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

/// Longer than the engine's harshest timer throttling (one wake-up a minute), so a slow
/// page is never mistaken for a stuck one.
const STUCK_AFTER: Duration = Duration::from_secs(120);
const CHECK_EVERY: Duration = Duration::from_secs(10);
/// A page that is stuck again right after a reload is not helped by reloading it in a loop.
const MIN_BETWEEN_RELOADS: Duration = Duration::from_secs(10 * 60);

fn epoch() -> Instant {
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    *EPOCH.get_or_init(Instant::now)
}

fn now_ms() -> u64 {
    epoch().elapsed().as_millis() as u64
}

static LAST_BEAT_MS: AtomicU64 = AtomicU64::new(0);

/// Called by the main window's page; it only stores a number, so it is safe to run on the
/// window's own thread.
#[tauri::command]
pub fn ui_heartbeat() {
    LAST_BEAT_MS.store(now_ms(), Ordering::Relaxed);
}

/// Whether the page should be reloaded, given how long the window has been on screen and
/// how long the page has been quiet.
fn is_stuck(on_screen_for: Duration, quiet_for: Duration) -> bool {
    on_screen_for >= STUCK_AFTER && quiet_for >= STUCK_AFTER
}

pub fn start(app: AppHandle) {
    LAST_BEAT_MS.store(now_ms(), Ordering::Relaxed);
    let spawned = std::thread::Builder::new().name("ui-watchdog".into()).spawn(move || {
        let mut on_screen_since: Option<Instant> = None;
        let mut last_reload: Option<Instant> = None;
        loop {
            std::thread::sleep(CHECK_EVERY);
            let Some(window) = app.get_webview_window("main") else {
                on_screen_since = None;
                continue;
            };
            let on_screen = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
            if !on_screen {
                on_screen_since = None;
                continue;
            }
            let since = *on_screen_since.get_or_insert_with(Instant::now);
            let quiet_for = Duration::from_millis(now_ms().saturating_sub(LAST_BEAT_MS.load(Ordering::Relaxed)));
            if !is_stuck(since.elapsed(), quiet_for) {
                continue;
            }
            if last_reload.is_some_and(|at| at.elapsed() < MIN_BETWEEN_RELOADS) {
                continue;
            }
            log::warn!(
                "The window's page has not reported in for {}s while on screen - reloading it",
                quiet_for.as_secs()
            );
            last_reload = Some(Instant::now());
            // A fresh page gets the full allowance before it is judged again.
            LAST_BEAT_MS.store(now_ms(), Ordering::Relaxed);
            if let Err(error) = window.reload() {
                log::warn!("could not reload the window's page: {error}");
            }
        }
    });
    if let Err(error) = spawned {
        log::warn!("could not start the window watchdog: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_is_stuck_only_when_on_screen_and_quiet_long_enough() {
        let long = STUCK_AFTER + Duration::from_secs(1);
        let short = Duration::from_secs(30);
        assert!(is_stuck(long, long));
        // Just shown: the page may simply have been throttled while hidden.
        assert!(!is_stuck(short, long));
        // Reported in recently.
        assert!(!is_stuck(long, short));
    }
}
