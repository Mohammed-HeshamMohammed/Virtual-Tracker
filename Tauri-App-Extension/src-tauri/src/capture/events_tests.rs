//! Tests for events.rs.

use super::*;
use crate::capture::activity::ActivityMeter;

// Guards MAC-3/CQ-4's override layer: the server-delivered cache wins when it has an
// entry, everything else falls through to what window.rs already resolved - this can

fn builder() -> EventBuilder {
    // A unique cache path per builder.
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    EventBuilder::new(
        ActivityMeter::new(),
        PathBuf::new(),
        PathBuf::new(),
        std::env::temp_dir().join(format!("vt-eventbuilder-test-{unique}.json")),
        PathBuf::new(),
    )
}

fn window(process_name: &str, app_name: &str) -> ForegroundWindow {
    ForegroundWindow {
        app_name: app_name.to_string(),
        title: "Some Title".to_string(),
        process_name: process_name.to_string(),
        exe_path: String::new(),
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
    // MAC-2 sets process_name = app_name on macOS (no separate exe form), and CLS-1
    // seeds macOS-style patterns ("Google Chrome") alongside the Windows .exe ones for
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

fn browser_window() -> ForegroundWindow {
    ForegroundWindow {
        app_name: "Google Chrome".to_string(),
        title: "Some page".to_string(),
        process_name: "chrome.exe".to_string(),
        exe_path: String::new(),
        hwnd: 0,
        is_browser: true,
        browser_hint: "chrome".to_string(),
    }
}

// A screenshot carries the site that was open, so the server can categorise it directly
// instead of inferring from a separate URL log.

#[test]
fn no_url_on_a_screenshot_when_nothing_has_been_captured() {
    let builder = builder();
    assert_eq!(builder.recent_url(&browser_window()), None);
}

#[test]
fn an_app_slice_carries_no_icon_without_an_executable_path() {
    // Window() leaves exe_path empty (the non-Windows / unreadable case), so extraction
    // never even starts.
    let builder = builder();
    match builder.app_slice(&window("code.exe", "VS Code")) {
        ActivityEvent::App { app_icon, .. } => assert_eq!(app_icon, None),
        other => panic!("expected App, got {other:?}"),
    }
}

#[test]
fn a_missing_icon_script_settles_to_done_and_never_blocks_the_slice() {
    // Builder() passes an empty (non-existent) script path; the first slice spawns a
    // thread that resolves to nothing, and no slice ever returns an icon or panics.
    let builder = builder();
    let mut win = window("code.exe", "VS Code");
    win.exe_path = "C:\\does\\not\\exist\\code.exe".to_string();
    for _ in 0..3 {
        match builder.app_slice(&win) {
            ActivityEvent::App { app_icon, .. } => assert_eq!(app_icon, None),
            other => panic!("expected App, got {other:?}"),
        }
    }
}

fn observation(url: &str, secs_ago: u64) -> crate::capture::uia_url::UrlObservation {
    crate::capture::uia_url::UrlObservation {
        hwnd: 1,
        url: url.to_string(),
        at: Instant::now() - Duration::from_secs(secs_ago),
    }
}

#[test]
fn dwell_is_credited_from_one_navigation_to_the_next() {
    // Visited a, then b five seconds later, then c four after that; c is still open
    // with three seconds gone.
    let observed = [observation("a", 12), observation("b", 7), observation("c", 3)];
    let out = attribute_dwell(&observed, Instant::now());
    let secs: Vec<u64> = out.iter().map(|(_, s)| *s).collect();
    assert_eq!(out.iter().map(|(u, _)| u.as_str()).collect::<Vec<_>>(), ["a", "b", "c"]);
    assert_eq!(secs, [5, 4, 3], "each URL keeps the gap until the next one");
    assert!(secs.iter().sum::<u64>() <= APP_LOG_INTERVAL_SEC);
}

#[test]
fn a_single_navigation_gets_the_time_since_it_happened() {
    let out = attribute_dwell(&[observation("only", 6)], Instant::now());
    assert_eq!(out, vec![("only".to_string(), 6)]);
}

#[test]
fn a_fast_click_through_still_counts_as_a_second() {
    // Three navigations inside the same second must not record as zero.
    let observed = [observation("a", 1), observation("b", 1), observation("c", 1)];
    let out = attribute_dwell(&observed, Instant::now());
    assert_eq!(out.iter().map(|(_, s)| *s).collect::<Vec<_>>(), [1, 1, 1]);
}

#[test]
fn the_tick_never_gives_away_more_time_than_it_covered() {
    // Stale observations that together exceed one interval get trimmed from the oldest,
    // and nothing is dropped entirely.
    let observed = [observation("a", 600), observation("b", 300), observation("c", 30)];
    let out = attribute_dwell(&observed, Instant::now());
    let total: u64 = out.iter().map(|(_, s)| *s).sum();
    assert_eq!(out.len(), 3, "every URL is still reported");
    assert!(total <= APP_LOG_INTERVAL_SEC, "total {total} exceeds a tick");
    assert!(out.iter().all(|(_, s)| *s >= 1), "no URL is credited zero");
}

#[test]
fn capture_exclusions_match_display_name_or_process_name() {
    let builder = builder();
    let win = window("slack.exe", "Slack");
    assert!(!builder.is_capture_excluded(&win), "nothing excluded by default");

    builder.apply_capture_exclusions(vec!["slack".to_string()]);
    assert!(builder.is_capture_excluded(&win), "matches the display name");

    builder.apply_capture_exclusions(vec!["slack.exe".to_string()]);
    assert!(builder.is_capture_excluded(&win), "matches the process name");

    builder.apply_capture_exclusions(vec!["notepad.exe".to_string()]);
    assert!(!builder.is_capture_excluded(&win), "an unrelated exclusion does not match");

    // A refresh that drops the pattern must actually stop excluding.
    builder.apply_capture_exclusions(vec!["slack".to_string()]);
    assert!(builder.is_capture_excluded(&win));
    builder.apply_capture_exclusions(vec![]);
    assert!(!builder.is_capture_excluded(&win), "cleared list stops excluding");
}

#[test]
fn url_capture_backs_off_after_repeated_failures_and_a_success_clears_it() {
    let builder = builder();
    assert!(!builder.url_capture_backed_off("hwnd-1"), "clean window is not backed off");

    for _ in 0..(URL_CAPTURE_MAX_FAILURES - 1) {
        builder.record_url_capture_outcome("hwnd-1", false);
        assert!(!builder.url_capture_backed_off("hwnd-1"), "not yet at the failure threshold");
    }
    builder.record_url_capture_outcome("hwnd-1", false);
    assert!(builder.url_capture_backed_off("hwnd-1"), "threshold reached - now backed off");

    // A different window is unaffected.
    assert!(!builder.url_capture_backed_off("hwnd-2"));

    builder.record_url_capture_outcome("hwnd-1", true);
    assert!(!builder.url_capture_backed_off("hwnd-1"), "a success clears the backoff");
}

#[test]
fn a_fresh_url_is_attached() {
    let builder = builder();
    *builder.last_url.lock() = Some(("https://github.com/x".to_string(), Instant::now()));
    assert_eq!(
        builder.recent_url(&browser_window()),
        Some("https://github.com/x".to_string())
    );
}

#[test]
fn a_stale_url_is_dropped_rather_than_attached() {
    // Worse than no URL: the server would categorise the capture by a site the member
    // had already left, and would trust it over its own inference.
    let builder = builder();
    let stale = Instant::now() - Duration::from_secs(URL_CACHE_MAX_AGE_SEC + 1);
    *builder.last_url.lock() = Some(("https://github.com/x".to_string(), stale));
    assert_eq!(builder.recent_url(&browser_window()), None);
}

#[test]
fn a_stale_url_still_decides_the_blur_even_though_it_cannot_label() {
    // The asymmetry this pair exists to pin: labelling must not claim a site it cannot
    // prove, but blurring is asked "might this be private?" and a stale WhatsApp
    let builder = builder();
    let stale = Instant::now() - Duration::from_secs(URL_CACHE_MAX_AGE_SEC + 1);
    *builder.last_url.lock() = Some(("https://web.whatsapp.com/".to_string(), stale));
    let win = browser_window();

    assert_eq!(builder.recent_url(&win), None, "too old to name the site");
    assert_eq!(
        builder.url_for_blur(&win),
        Some("https://web.whatsapp.com/".to_string()),
        "still recent enough to justify blurring",
    );
}

#[test]
fn past_the_grace_window_even_the_blur_reading_is_dropped() {
    // The generosity has a limit: an hour-old reading says nothing about what is on
    // screen now.
    let builder = builder();
    let ancient = Instant::now() - Duration::from_secs(URL_BLUR_GRACE_SEC + 1);
    *builder.last_url.lock() = Some(("https://web.whatsapp.com/".to_string(), ancient));
    assert_eq!(builder.url_for_blur(&browser_window()), None);
}

#[test]
fn the_blur_reading_does_not_follow_focus_out_of_the_browser() {
    let builder = builder();
    *builder.last_url.lock() = Some(("https://web.whatsapp.com/".to_string(), Instant::now()));
    let editor = window("code.exe", "VS Code");
    assert_eq!(builder.url_for_blur(&editor), None);
}

#[test]
fn a_non_browser_window_never_carries_a_url() {
    // Focus moved from the browser to an editor; the cached URL must not follow it.
    let builder = builder();
    *builder.last_url.lock() = Some(("https://github.com/x".to_string(), Instant::now()));
    let editor = window("code.exe", "VS Code");
    assert_eq!(builder.recent_url(&editor), None);
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

