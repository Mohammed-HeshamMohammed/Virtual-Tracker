//! Tests for tracker.rs.

/// Makes `idle_seconds()` report a machine nobody is touching, and puts the real OS
/// query back on drop so one test cannot leak into another.
#[cfg(windows)]
struct SimulatedOsIdle;

#[cfg(windows)]
impl SimulatedOsIdle {
    fn seconds(seconds: u64) -> Self {
        crate::capture::activity::override_system_idle_for_test(Some(seconds));
        Self
    }
}

#[cfg(windows)]
impl Drop for SimulatedOsIdle {
    fn drop(&mut self) {
        crate::capture::activity::override_system_idle_for_test(None);
    }
}

#[cfg(windows)]
use super::IdleWatch;
use super::{valid_idle_threshold, ActivityTracker, PendingStop, TickState};
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use tiny_http::Method;

use crate::capture::activity::ActivityMeter;
use crate::client::api::ApiClient;
use crate::config::Settings;
use crate::test_support::{fake_jwt, fake_server};

// Suggestion #14a: end-to-end tick() coverage, made tractable by the TickState refactor
// (Suggestion #11) - a test can now hand tick() one struct instead of hand-threading 15

/// A `Settings` pointed at `api_url`, with every filesystem path inside its own fresh
/// temp directory so parallel tests never share state (the queue file in particular -
fn test_settings(api_url: String) -> Settings {
    let dir = std::env::temp_dir().join(format!(
        "vt-tracker-test-{}-{:?}",
        std::process::id(),
        std::time::Instant::now()
    ));
    let _ = std::fs::create_dir_all(&dir);
    Settings {
        api_url,
        web_url: "http://127.0.0.1:1".into(),
        auth_url: "http://127.0.0.1:1".into(),
        auth_port: 0,
        store_path: dir.join("store.json"),
        prefs_path: dir.join("prefs.json"),
        queue_path: dir.join("queue.jsonl"),
        classification_cache_path: dir.join("classifications.json"),
        progress_path: dir.join("progress.json"),
        log_path: dir.join("agent.log"),
        url_script_path: dir.join("missing-get-browser-url.ps1"),
        macos_url_script_path: dir.join("missing-get-browser-url.applescript"),
        app_icon_script_path: dir.join("missing-get-app-icon.ps1"),
    }
}

/// A tracker whose `ApiClient` already holds a not-yet-expired id token, so
/// `authorized()` never needs a real Firebase round-trip, pointed at `api_url`.
fn test_tracker(api_url: String) -> ActivityTracker {
    let mut api = ApiClient::new(api_url.clone(), "http://127.0.0.1:1".into())
        .expect("HTTP client builds in a test environment");
    api.set_tokens(&fake_jwt(3600), "refresh-token");
    let settings = test_settings(api_url);
    ActivityTracker::new(
        std::sync::Arc::new(Mutex::new(api)),
        &settings,
        ActivityMeter::new(),
        None,
    )
}

/// Answers exactly the routes a session-transition tick needs; anything else 404s,
/// which every caller in `tick()` already treats as a harmless failed best-effort fetch
fn session_test_server(session_body: &'static str) -> String {
    fake_server(move |request| {
        let path = request.url().split('?').next().unwrap_or("").to_string();
        match (request.method(), path.as_str()) {
            (Method::Get, "/api/activity/session") => (200, session_body.to_string()),
            (Method::Get, p) if p.starts_with("/api/tasks/") && p.ends_with("/time-tracking") => {
                // IdleTimeSeconds=1 so a test that shrinks the org-wide idle stages via
                // apply_idle_thresholds (warn/alert/stop) isn't gated on the real
                (200, r#"{"data": {"activeSeconds": 0, "idleSeconds": 0, "disableIdleTime": false, "idleTimeSeconds": 1}}"#.to_string())
            }
            (Method::Post, "/api/activity/events") => {
                (200, r#"{"data": {"inserted": 1}}"#.to_string())
            }
            (Method::Post, "/api/activity/session") => {
                (200, r#"{"data": {"id": "sess-1", "status": "stopped"}}"#.to_string())
            }
            _ => (404, "{}".to_string()),
        }
    })
}

// C1: the server says this session is paused - historically the dashboard, on a single
// "agent offline" reading.
#[test]
fn a_server_pause_keeps_the_session_and_its_totals() {
    let tracker = test_tracker(session_test_server(IDLE_SESSION_WITH_TASK));
    let mut state = TickState::new();
    state.was_active = true;
    state.current_session = "sess-1".to_string();
    state.task_id = "task-1".to_string();
    state.idle_settings_stale = false;
    state.active_baseline = 100;
    state.active_elapsed = 40;

    tracker.tick(&mut state);

    assert!(!state.was_active, "paused: nothing is being credited");
    assert_eq!(state.current_session, "sess-1", "the session is kept");
    assert_eq!(state.task_id, "task-1", "and its task");
    assert_eq!(state.active_baseline, 100, "and its baseline");
    assert_eq!(state.active_elapsed, 40, "and the time already worked - not thrown away");
}

#[test]
fn resuming_after_a_server_pause_carries_on_and_credits_none_of_the_pause() {
    let paused = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    let paused_in_server = std::sync::Arc::clone(&paused);
    let url = fake_server(move |request| {
        let path = request.url().split('?').next().unwrap_or("").to_string();
        match (request.method(), path.as_str()) {
            (Method::Get, "/api/activity/session") => {
                let body = if paused_in_server.load(std::sync::atomic::Ordering::SeqCst) {
                    IDLE_SESSION_WITH_TASK
                } else {
                    ACTIVE_SESSION_WITH_TASK
                };
                (200, body.to_string())
            }
            (Method::Post, "/api/activity/events") => (200, r#"{"data": {"inserted": 1}}"#.to_string()),
            _ => (404, "{}".to_string()),
        }
    });
    let tracker = test_tracker(url);
    let mut state = TickState::new();
    state.was_active = true;
    state.current_session = "sess-1".to_string();
    state.task_id = "task-1".to_string();
    state.idle_settings_stale = false;
    state.active_baseline = 100;
    state.active_elapsed = 40;

    tracker.tick(&mut state); // paused
    thread::sleep(Duration::from_millis(1_200)); // time that is not work

    paused.store(false, std::sync::atomic::Ordering::SeqCst);
    state.ticks_since_session_fetch = super::SESSION_FETCH_EVERY_N_TICKS; // due to poll
    tracker.tick(&mut state); // resumed

    assert!(state.was_active, "counting has resumed");
    assert_eq!(state.current_session, "sess-1", "on the same session");
    assert_eq!(state.active_baseline, 100, "no re-baseline for the same session and task");
    assert_eq!(state.active_elapsed, 40, "the 1.2s spent paused is not credited as work");
}

#[test]
fn ticks_while_paused_by_the_server_count_nothing() {
    let tracker = test_tracker(session_test_server(IDLE_SESSION_WITH_TASK));
    let mut state = TickState::new();
    state.was_active = false;
    state.current_session = "sess-1".to_string();
    state.task_id = "task-1".to_string();
    state.active_elapsed = 40;

    thread::sleep(Duration::from_millis(1_100));
    tracker.tick_local_progress(&mut state);

    assert_eq!(state.active_elapsed, 40);
    assert_eq!(state.idle_elapsed, 0);
    assert!(state.last_tick_at.elapsed() < Duration::from_millis(500), "the clock moved on");
}

const IDLE_SESSION_WITH_TASK: &str = r#"{"data": {"id": "sess-1", "status": "idle", "taskId": "task-1", "projectId": "proj-1", "activeSeconds": 0, "idleSeconds": 0}}"#;

const ACTIVE_SESSION_WITH_TASK: &str = r#"{"data": {"id": "sess-1", "status": "active", "taskId": "task-1", "projectId": "proj-1", "activeSeconds": 0, "idleSeconds": 0}}"#;

/// A task-less ("calling project") session - no `taskId`, and the project's own idle
/// settings attached to the session itself, exactly as `normalizeSession` sends them
const ACTIVE_SESSION_TASK_LESS: &str = r#"{"data": {"id": "sess-2", "status": "active", "taskId": null, "projectId": "proj-1", "activeSeconds": 0, "idleSeconds": 0, "disableIdleTime": false, "idleTimeSeconds": 450}}"#;

/// Same shape, but with the unusable `0` allowance a cleared field in the project modal
/// actually stores (nothing upstream forbids it).
const ACTIVE_SESSION_TASK_LESS_ZERO_ALLOWANCE: &str = r#"{"data": {"id": "sess-3", "status": "active", "taskId": null, "projectId": "proj-1", "activeSeconds": 0, "idleSeconds": 0, "disableIdleTime": false, "idleTimeSeconds": 0}}"#;

#[test]
fn tick_transitions_into_a_newly_started_session() {
    let tracker = test_tracker(session_test_server(ACTIVE_SESSION_WITH_TASK));
    let mut state = TickState::new();

    tracker.tick(&mut state);

    assert!(state.was_active, "a fresh active session must mark the tracker active");
    assert_eq!(state.current_session, "sess-1");
    assert_eq!(state.task_id, "task-1");
}

#[test]
fn tick_keeps_capturing_under_the_last_known_session_when_fetch_session_fails() {
    // A real, listening, always-500 server - not a dropped/unbound port.
    let base_url = fake_server(|_request| (500, "{}".to_string()));
    let tracker = test_tracker(base_url);

    // Simulate a tick that already has a session open - the exact scenario TC-2/this
    // branch exists for: keep ticking under the last known session across a network
    let mut state = TickState::new();
    state.was_active = true;
    state.current_session = "sess-1".to_string();
    state.task_id = "task-1".to_string();
    // Skip the incidental best-effort refreshes and screenshot capture - none of them
    // are what this test is about (and a real screenshot capture, via xcap, isn't
    let far_future = std::time::Instant::now() + Duration::from_secs(3600);
    state.next_screenshot_at = far_future;
    state.next_display_name_refresh_at = far_future;
    state.next_scoring_refresh_at = far_future;

    tracker.tick(&mut state);

    assert!(state.was_active, "an unreachable backend must not be treated as session-over");
    assert_eq!(state.current_session, "sess-1", "the last known session must be preserved");
    assert_eq!(state.task_id, "task-1");
}

// `tick_idle_escalation` itself short-circuits to a no-op off Windows (`if
// !ActivityMeter::HOOKS_SUPPORTED { return false; }`, see its own doc comment) because
/// The project's allowance must reach a task-less session.
#[test]
fn tick_reads_the_projects_idle_allowance_for_a_task_less_session() {
    let tracker = test_tracker(session_test_server(ACTIVE_SESSION_TASK_LESS));
    let mut state = TickState::new();
    assert_eq!(
        state.idle_threshold_sec_for_project,
        crate::constants::IDLE_THRESHOLD_SEC,
        "precondition: a fresh state starts on the compile-time default",
    );

    tracker.tick(&mut state);

    assert!(state.was_active, "precondition: the session must have started");
    assert!(state.task_id.is_empty(), "precondition: this session is task-less");
    assert_eq!(
        state.idle_threshold_sec_for_project, 450,
        "the project's own allowance must be adopted, not IDLE_THRESHOLD_SEC",
    );
}

/// `projects.idle_time_seconds` has no `CHECK (> 0)` and the project modal floors a
/// cleared field to `0`, so `0` is reachable.
#[test]
fn an_unusable_project_idle_allowance_falls_back_to_the_org_wide_value() {
    let tracker = test_tracker(session_test_server(ACTIVE_SESSION_TASK_LESS_ZERO_ALLOWANCE));
    tracker.apply_idle_thresholds(123);
    let mut state = TickState::new();

    tracker.tick(&mut state);

    assert!(state.was_active, "precondition: the session must have started");
    assert_eq!(
        state.idle_threshold_sec_for_project, 123,
        "a 0 allowance must fall back to the org-wide threshold, never be used as-is",
    );
}

#[cfg(windows)]
#[test]
fn tick_stops_the_timer_once_the_idle_escalation_deadline_passes() {
    let tracker = test_tracker(session_test_server(ACTIVE_SESSION_WITH_TASK));
    // Shrunk far below any real project allowance so this test finishes in a few
    // seconds instead of waiting out a real idle period.
    tracker.apply_idle_thresholds(1);
    let mut state = TickState::new();

    // Idle now takes the smaller of the hook clock and the OS's own GetLastInputInfo.
    let _os_idle = SimulatedOsIdle::seconds(9_999);

    // Starts the session.
    tracker.tick(&mut state);
    assert!(state.was_active, "precondition: the session must have started");

    thread::sleep(Duration::from_millis(3_500));
    tracker.tick(&mut state);

    assert!(!state.was_active, "idle escalation should have stopped the timer");
    assert!(state.current_session.is_empty());
}

// Windows-only, same as the sibling above: tick_idle_escalation short- circuits on
// `!ActivityMeter::HOOKS_SUPPORTED` off Windows, so `stopped` is always false there and
#[cfg(windows)]
#[test]
fn idle_escalation_folds_the_reversed_active_chunk_into_idle_instead_of_discarding_it() {
    let base_url = fake_server(|request| match request.method() {
        Method::Post => (200, r#"{"data": {"id": "sess-1", "status": "stopped"}}"#.to_string()),
        _ => (404, "{}".to_string()),
    });
    let tracker = test_tracker(base_url);
    tracker.apply_idle_thresholds(1);

    // As above, both idle sources have to say nobody is here.
    let _os_idle = SimulatedOsIdle::seconds(9_999);

    // Real idle_seconds() growing from construction, same technique the test above uses
    // - nothing here ever feeds ActivityMeter real input.
    thread::sleep(Duration::from_millis(3_500));

    let mut watch = IdleWatch {
        stage: 0,
        // The last confirmed real input was at 10s of active time - everything credited
        // active since then (up to 100s) is the idle grace window tick_progress
        active_at_last_input: 10,
    };
    let active_baseline = 0u64;
    let active_elapsed = 100u64;
    let idle_baseline = 0u64;
    // The couple of ticks tick_progress had already credited idle by the time
    // escalation ran on the same tick it crossed the threshold.
    let idle_elapsed = 2u64;

    let stopped = tracker.tick_idle_escalation(
        &mut watch,
        "task-1",
        "project-1",
        &active_baseline,
        &active_elapsed,
        &idle_baseline,
        &idle_elapsed,
        false,
        1,
    );
    assert!(stopped, "past the threshold, escalation must stop the session");

    let (_, active_seconds, idle_seconds) = tracker.task_progress.lock().clone();
    // Rewound to the last real input - 10s, not 0 and not the full 100s.
    assert_eq!(active_seconds, 10);
    assert_eq!(idle_seconds, 92);
}

/// `disable_idle_time = true` on the project must mean no idle escalation at all - the
/// same idle stretch that stops the timer in the test above must leave it running when
#[test]
fn tick_never_escalates_when_the_projects_idle_time_is_disabled() {
    let base_url = fake_server(move |request| {
        let path = request.url().split('?').next().unwrap_or("").to_string();
        match (request.method(), path.as_str()) {
            (Method::Get, "/api/activity/session") => (200, ACTIVE_SESSION_WITH_TASK.to_string()),
            (Method::Get, p) if p.starts_with("/api/tasks/") && p.ends_with("/time-tracking") => (
                200,
                r#"{"data": {"activeSeconds": 0, "idleSeconds": 0, "disableIdleTime": true, "idleTimeSeconds": 1}}"#
                    .to_string(),
            ),
            (Method::Post, "/api/activity/events") => (200, r#"{"data": {"inserted": 1}}"#.to_string()),
            (Method::Post, "/api/activity/session") => {
                (200, r#"{"data": {"id": "sess-1", "status": "stopped"}}"#.to_string())
            }
            _ => (404, "{}".to_string()),
        }
    });
    let tracker = test_tracker(base_url);
    // Same shrunk threshold as the test above - if disable_idle_time were being
    // ignored, this would stop the timer within the same 3.5s.
    tracker.apply_idle_thresholds(1);
    let mut state = TickState::new();

    tracker.tick(&mut state);
    assert!(state.was_active, "precondition: the session must have started");

    thread::sleep(Duration::from_millis(3_500));
    tracker.tick(&mut state);

    assert!(state.was_active, "idle time disabled must never stop the timer");
    assert_eq!(state.current_session, "sess-1");
}

/// Guards the Start/idle-stop race: `start_task_session`/ `start_project_session` must
/// refuse to proceed (get `false` back) while a pending idle-stop genuinely can't be
#[test]
fn flush_pending_stop_reports_false_while_stuck_and_true_once_delivered() {
    let attempts = std::sync::Arc::new(AtomicUsize::new(0));
    let attempts_clone = attempts.clone();
    let base_url = fake_server(move |request| {
        let path = request.url().split('?').next().unwrap_or("").to_string();
        match (request.method(), path.as_str()) {
            (Method::Post, "/api/activity/session") => {
                if attempts_clone.fetch_add(1, AtomicOrdering::SeqCst) == 0 {
                    (500, "{}".to_string())
                } else {
                    (200, r#"{"data": {"id": "sess-1", "status": "stopped"}}"#.to_string())
                }
            }
            _ => (404, "{}".to_string()),
        }
    });
    let tracker = test_tracker(base_url);
    *tracker.pending_stop.lock() = Some(PendingStop {
        task_id: "task-1".into(),
        project_id: String::new(),
        active_seconds: 120,
        idle_seconds: 30,
    });

    assert!(!tracker.flush_pending_stop(), "first attempt fails (500) - must report false");
    assert!(tracker.pending_stop.lock().is_some(), "still queued after a failed attempt");

    assert!(tracker.flush_pending_stop(), "second attempt succeeds - must report true");
    assert!(tracker.pending_stop.lock().is_none(), "cleared once actually delivered");
}

#[test]
fn flush_pending_stop_is_a_true_no_op_when_nothing_is_queued() {
    let base_url = fake_server(|_| (404, "{}".to_string()));
    let tracker = test_tracker(base_url);
    assert!(tracker.flush_pending_stop(), "nothing pending - must not block starting a session");
}

/// ID-3, missed the first time: tick_progress and tick_idle_escalation both already
/// respected idle_time_disabled, but tick_paused - the third and only other place
#[test]
fn tick_paused_never_credits_idle_when_the_projects_idle_time_is_disabled() {
    let base_url = fake_server(|_| (200, "{}".to_string()));
    let tracker = test_tracker(base_url);
    let mut state = TickState::new();
    state.idle_time_disabled = true;
    // Past due right away by default (TickState::new() sets next_sync_at to
    // construction time), which would otherwise fire tick_paused's conditional sync
    state.next_sync_at = Instant::now() + Duration::from_secs(3600);

    thread::sleep(Duration::from_millis(1_100));
    tracker.tick_paused(&mut state);

    assert_eq!(state.idle_elapsed, 0, "idle time disabled must mean no idle time tracked, including on a break");
    assert_eq!(state.active_elapsed, 0, "a break must not be credited as active work either - it should be left out of both totals, not moved into the other one");
}

/// Same setup, idle time *not* disabled - the elapsed wall-clock time must still land
/// in idle_elapsed exactly as before this fix, since the guard above only skips
#[test]
fn tick_paused_still_credits_idle_normally_when_idle_time_is_not_disabled() {
    let base_url = fake_server(|_| (200, "{}".to_string()));
    let tracker = test_tracker(base_url);
    let mut state = TickState::new();
    state.idle_time_disabled = false;
    state.next_sync_at = Instant::now() + Duration::from_secs(3600);

    thread::sleep(Duration::from_millis(1_100));
    tracker.tick_paused(&mut state);

    assert!(state.idle_elapsed >= 1, "a break must still count as idle time by default");
    assert_eq!(state.active_elapsed, 0, "a break is never active time");
}

/// Clicking Stop from a paused session used to leave `paused` true forever - nothing
/// else ever cleared it, so every later tick kept taking tick_paused's branch, which
#[test]
fn stopping_a_paused_session_actually_ends_the_break() {
    let base_url = fake_server(|_| (200, "{}".to_string()));
    let tracker = test_tracker(base_url);
    tracker.pause().expect("pause should succeed against the fake server");
    assert!(tracker.is_paused(), "sanity check: pausing does pause");

    tracker.note_stop_requested();

    assert!(
        !tracker.is_paused(),
        "a stop must end the break, or the tick loop can never see the session is gone"
    );
}

#[test]
fn pausing_a_task_less_session_sends_its_project_id_so_the_server_can_find_it() {
    let captured_body = std::sync::Arc::new(Mutex::new(String::new()));
    let captured_for_server = std::sync::Arc::clone(&captured_body);
    let url = fake_server(move |request| {
        let path = request.url().split('?').next().unwrap_or("").to_string();
        match (request.method(), path.as_str()) {
            (Method::Get, "/api/activity/session") => (200, ACTIVE_SESSION_TASK_LESS.to_string()),
            (Method::Post, "/api/activity/session") => {
                let mut body = String::new();
                let _ = request.as_reader().read_to_string(&mut body);
                *captured_for_server.lock() = body;
                (200, r#"{"data": {"id": "sess-2", "status": "idle"}}"#.to_string())
            }
            _ => (404, "{}".to_string()),
        }
    });
    let tracker = test_tracker(url);
    let mut state = TickState::new();
    tracker.tick(&mut state);

    tracker.pause().expect("pause should succeed once the project id travels with it");

    let body = captured_body.lock().clone();
    assert!(
        body.contains(r#""projectId":"proj-1""#),
        "pause must send the task-less session's project id, got: {body}"
    );
}

/// Screenshots must stop while the user is idle - a picture of an empty desk defeats
/// the point of idle detection.
// A tick period is never a whole number of seconds - it is the sleep plus however long
// the tick's network I/O took.
#[test]
fn a_tick_carries_its_sub_second_remainder_into_the_next_one() {
    // 5.4s of real time credits 5s now and leaves 0.4s owed.
    let elapsed = Duration::from_millis(5_400);
    let credited = ActivityTracker::credited_seconds(elapsed);
    assert_eq!(credited, 5);
    let consumed = ActivityTracker::consumed_span(elapsed, credited);
    assert_eq!(elapsed - consumed, Duration::from_millis(400));
}

#[test]
fn carried_remainders_eventually_credit_a_whole_second() {
    // Three 5.4s ticks are 16.2s of real time.
    let mut owed = Duration::ZERO;
    let mut total = 0u64;
    for _ in 0..3 {
        let elapsed = Duration::from_millis(5_400) + owed;
        let credited = ActivityTracker::credited_seconds(elapsed);
        owed = elapsed - ActivityTracker::consumed_span(elapsed, credited);
        total += credited;
    }
    assert_eq!(total, 16, "16.2s of real time must credit 16s, not 15");
    assert_eq!(owed, Duration::from_millis(200));
}

// A resumed laptop must not bank the whole suspend as active work, and must not keep
// owing it either - the gap is consumed and dropped.
#[test]
fn a_sleep_gap_is_clamped_and_leaves_nothing_owed() {
    let elapsed = Duration::from_secs(3_600);
    let credited = ActivityTracker::credited_seconds(elapsed);
    assert_eq!(credited, crate::constants::SESSION_POLL_SEC * 4);
    assert_eq!(elapsed - ActivityTracker::consumed_span(elapsed, credited), Duration::ZERO);
}

#[test]
fn an_exact_whole_second_tick_owes_nothing() {
    let elapsed = Duration::from_secs(5);
    let credited = ActivityTracker::credited_seconds(elapsed);
    assert_eq!(elapsed - ActivityTracker::consumed_span(elapsed, credited), Duration::ZERO);
}

#[test]
fn tick_progress_reports_idle_once_the_threshold_is_crossed() {
    let base_url = fake_server(|_| (200, "{}".to_string()));
    let tracker = test_tracker(base_url);
    let mut state = TickState::new();
    state.task_id = "task-1".to_string();
    state.idle_threshold_sec_for_project = 1;

    // Pin the OS idle clock instead of relying on this machine genuinely being
    // idle. Reading the real clock made this fail roughly one run in three -
    // anything touching the keyboard or mouse during the suite reset it.
    #[cfg(windows)]
    let _idle = SimulatedOsIdle::seconds(5);

    thread::sleep(Duration::from_millis(1_100));
    let credited_idle = tracker.tick_progress(&mut state);
    let (active_elapsed, idle_elapsed) = (state.active_elapsed, state.idle_elapsed);

    if ActivityMeter::HOOKS_SUPPORTED {
        // Real hooks: ActivityMeter's last-input clock was set at construction and
        // nothing here ever fed it real input, so idle_seconds() grew with the sleep
        assert!(credited_idle, "should report idle once idle_seconds() clears the threshold");
        assert_eq!(active_elapsed, 0);
        assert!(idle_elapsed >= 1);
    } else {
        // No real hooks on this platform - idle_seconds() can't move, so tick_progress
        // always credits active.
        assert!(!credited_idle);
        assert!(active_elapsed >= 1);
        assert_eq!(idle_elapsed, 0);
    }
}

/// The disabled-project counterpart: even once the same real idle time has elapsed,
/// idle_time_disabled must keep tick_progress reporting "not idle" - screenshots keep
#[test]
fn tick_progress_never_reports_idle_when_the_projects_idle_time_is_disabled() {
    let base_url = fake_server(|_| (200, "{}".to_string()));
    let tracker = test_tracker(base_url);
    let mut state = TickState::new();
    state.task_id = "task-1".to_string();
    state.idle_threshold_sec_for_project = 1;
    state.idle_time_disabled = true;

    thread::sleep(Duration::from_millis(1_100));
    let credited_idle = tracker.tick_progress(&mut state);
    let (active_elapsed, idle_elapsed) = (state.active_elapsed, state.idle_elapsed);

    assert!(!credited_idle, "idle time disabled must mean screenshots never stop for idleness");
    assert!(active_elapsed >= 1);
    assert_eq!(idle_elapsed, 0);
}

// Guards ACT-3: a server-pushed idle threshold is only applied if it's sane - idle time
// is decided solely by the project's own allowance now, so there's nothing left to

#[test]
fn a_positive_idle_threshold_is_valid() {
    assert!(valid_idle_threshold(60));
}

#[test]
fn a_zero_idle_threshold_is_rejected() {
    assert!(!valid_idle_threshold(0));
}

// Guards TC-2: the tracker must credit real elapsed wall time, not an assumed
// SESSION_POLL_SEC per tick.

#[test]
fn credits_real_elapsed_time_not_the_assumed_poll_interval() {
    // A tick that actually took 9s (5s sleep + 4s of slow HTTP) must credit 9, not
    // SESSION_POLL_SEC (5).
    assert_eq!(ActivityTracker::credited_seconds(Duration::from_secs(9)), 9);
}

#[test]
fn a_short_tick_credits_exactly_what_elapsed() {
    assert_eq!(ActivityTracker::credited_seconds(Duration::from_secs(5)), 5);
}

#[test]
fn a_suspend_gap_cannot_bank_hours_nobody_worked() {
    // Laptop closed for 2h: clamp to SESSION_POLL_SEC * 4, then let idle escalation
    // take over and rewind to the last real input.
    assert_eq!(
        ActivityTracker::credited_seconds(Duration::from_secs(7200)),
        super::SESSION_POLL_SEC * 4,
    );
}

#[test]
fn the_clamp_boundary_is_exact() {
    let ceiling = super::SESSION_POLL_SEC * 4;
    assert_eq!(
        ActivityTracker::credited_seconds(Duration::from_secs(ceiling)),
        ceiling,
        "exactly at the ceiling must not be clamped down further"
    );
    assert_eq!(
        ActivityTracker::credited_seconds(Duration::from_secs(ceiling + 1)),
        ceiling,
        "one second past the ceiling must still clamp"
    );
}

#[test]
fn zero_elapsed_credits_zero() {
    assert_eq!(ActivityTracker::credited_seconds(Duration::from_secs(0)), 0);
}

// Guards the money-adjacent bit of idle escalation: when the timer auto- stops, exactly
// the time worked after the user stopped touching the machine must come off

#[test]
fn reverses_only_the_time_credited_since_the_user_went_idle() {
    // 3600s on the clock, 3540s of it earned before input stopped.
    let (rewound, reversed) = ActivityTracker::rewind_active(3600, 3540);
    assert_eq!(rewound, 3540);
    assert_eq!(reversed, 60);
}

#[test]
fn idling_from_the_very_start_reverses_everything() {
    let (rewound, reversed) = ActivityTracker::rewind_active(45, 0);
    assert_eq!(rewound, 0);
    assert_eq!(reversed, 45);
}

#[test]
fn a_snapshot_ahead_of_the_clock_cannot_invent_time() {
    // Would go negative if subtracted naively; must clamp, not wrap.
    let (rewound, reversed) = ActivityTracker::rewind_active(100, 500);
    assert_eq!(rewound, 100, "must never rewind upward");
    assert_eq!(reversed, 0);
}

#[test]
fn nothing_to_reverse_when_input_was_current() {
    let (rewound, reversed) = ActivityTracker::rewind_active(2400, 2400);
    assert_eq!(rewound, 2400);
    assert_eq!(reversed, 0);
}

#[test]
fn zero_clock_stays_zero() {
    let (rewound, reversed) = ActivityTracker::rewind_active(0, 0);
    assert_eq!(rewound, 0);
    assert_eq!(reversed, 0);
}

