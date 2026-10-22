//! The agent's use cases, end to end through `AgentController` - the layer every Tauri
//! command calls - against a fake backend over real HTTP.
//!
//! The tracker is installed but never started: a running tick loop captures the real
//! screen and hooks real input. A test that needs an open session hands it one with
//! `adopt_session_for_test`, which is what the tick loop does when it finds one.

use tiny_http::Method;

use super::*;
use crate::test_support::{fake_jwt, fake_server, test_settings};

#[derive(Clone, Copy)]
enum Notice {
    Acknowledged,
    NeedsAcknowledgement,
    Unreachable,
}

/// Every request the fake backend saw: method, path, body.
type Seen = Arc<Mutex<Vec<(Method, String, String)>>>;

fn backend(notice: Notice) -> (String, Seen) {
    let seen: Seen = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&seen);
    let mut acknowledged = matches!(notice, Notice::Acknowledged);
    let url = fake_server(move |request| {
        let method = request.method().clone();
        let path = request.url().split('?').next().unwrap_or("").to_string();
        let mut body = String::new();
        let _ = request.as_reader().read_to_string(&mut body);
        log.lock().push((method.clone(), path.clone(), body));
        match (method, path.as_str()) {
            (Method::Get, "/api/compliance/notice") => match notice {
                Notice::Unreachable => (500, "{}".into()),
                _ => (
                    200,
                    format!(r#"{{"data": {{"version": "v1", "text": "We record apps and screenshots.", "requiresAcknowledgement": {}}}}}"#, !acknowledged),
                ),
            },
            (Method::Post, "/api/compliance/consent/accept") => {
                acknowledged = true;
                (200, "{}".into())
            }
            (Method::Post, "/api/compliance/consent/disclose") => (200, "{}".into()),
            (Method::Get, p) if p.ends_with("/time-tracking") => {
                (200, r#"{"data": {"activeSeconds": 120, "idleSeconds": 30}}"#.into())
            }
            (Method::Post, "/api/activity/session") => {
                (200, r#"{"data": {"id": "sess-1", "status": "active"}}"#.into())
            }
            (Method::Post, "/api/activity/private-break") => (200, r#"{"data": {}}"#.into()),
            (Method::Post, "/api/auth/resolve-sign-in-methods") => {
                (200, r#"{"methods": ["google.com"]}"#.into())
            }
            _ => (404, "{}".into()),
        }
    });
    (url, seen)
}

/// Signed in, tracker installed, no session open yet.
fn signed_in(url: String) -> Arc<AgentController> {
    let mut settings = test_settings(url.clone());
    settings.auth_url = url;
    let controller = AgentController::new(settings).expect("controller builds");
    controller.api.lock().set_tokens(&fake_jwt(3600), "refresh-token");
    let tracker = ActivityTracker::new(
        Arc::clone(&controller.api),
        &controller.settings,
        Arc::clone(&controller.activity),
        None,
    );
    *controller.tracker.lock() = Some(Arc::new(tracker));
    controller
}

/// Signed in with session `sess-1` open on `task-1`: 400s active, 50s idle so far.
fn mid_session(url: String) -> Arc<AgentController> {
    let controller = signed_in(url);
    controller
        .current_tracker()
        .expect("tracker installed")
        .adopt_session_for_test("sess-1", "task-1", 400, 50);
    controller
}

/// The JSON bodies POSTed to the session endpoint, in order.
fn session_posts(seen: &Seen) -> Vec<serde_json::Value> {
    seen.lock()
        .iter()
        .filter(|(method, path, _)| *method == Method::Post && path == "/api/activity/session")
        .map(|(_, _, body)| serde_json::from_str(body).expect("session body is JSON"))
        .collect()
}

fn break_posts(seen: &Seen) -> Vec<serde_json::Value> {
    seen.lock()
        .iter()
        .filter(|(_, path, _)| path == "/api/activity/private-break")
        .map(|(_, _, body)| serde_json::from_str(body).expect("break body is JSON"))
        .collect()
}

// --- Starting the timer -------------------------------------------------------------

#[test]
fn starting_a_task_carries_on_from_its_recorded_totals() {
    let (url, seen) = backend(Notice::Acknowledged);
    let controller = signed_in(url);

    let result = controller.start_task_session("task-1");

    assert!(result.success, "{:?}", result.error);
    assert_eq!(controller.status(), "Task session active");
    let start = &session_posts(&seen)[0];
    assert_eq!(start["action"], "start");
    assert_eq!(start["taskId"], "task-1");
    assert_eq!(start["activeSeconds"], 120, "seeded from the task's totals, not 0");
    assert_eq!(start["idleSeconds"], 30);
    assert_eq!(start["reason"], "member_start");
}

#[test]
fn the_timer_will_not_start_until_the_monitoring_notice_is_accepted() {
    let (url, seen) = backend(Notice::NeedsAcknowledgement);
    let controller = signed_in(url);

    let refused = controller.start_task_session("task-1");
    assert!(!refused.success);
    assert_eq!(refused.error.as_deref(), Some("Review the monitoring notice before starting the timer."));
    assert!(session_posts(&seen).is_empty(), "nothing is tracked before consent");

    let notice = controller.get_monitoring_notice().expect("notice is shown");
    assert!(controller.acknowledge_monitoring_notice(&notice.version));

    assert!(controller.start_task_session("task-1").success);
    assert_eq!(session_posts(&seen).len(), 1);
}

#[test]
fn a_notice_that_cannot_be_checked_blocks_the_timer() {
    let (url, seen) = backend(Notice::Unreachable);
    let controller = signed_in(url);

    let result = controller.start_task_session("task-1");

    assert!(!result.success, "\"couldn't check\" must never count as consent");
    assert!(result.error.unwrap_or_default().starts_with("Could not verify the monitoring notice"));
    assert!(session_posts(&seen).is_empty());
}

#[test]
fn starting_without_choosing_a_task_never_reaches_the_server() {
    let (url, seen) = backend(Notice::Acknowledged);
    let controller = signed_in(url);

    let result = controller.start_task_session("   ");

    assert_eq!(result.error.as_deref(), Some("Select a task first"));
    assert!(seen.lock().is_empty());
}

#[test]
fn a_calling_project_with_no_tasks_starts_on_the_project() {
    let (url, seen) = backend(Notice::Acknowledged);
    let controller = signed_in(url);

    assert!(controller.start_project_session("proj-9").success);

    let start = &session_posts(&seen)[0];
    assert_eq!(start["projectId"], "proj-9");
    assert!(start.get("taskId").is_none());
}

// --- Pause and Break ----------------------------------------------------------------

#[test]
fn pausing_and_resuming_keeps_the_sessions_totals() {
    let (url, seen) = backend(Notice::Acknowledged);
    let controller = mid_session(url);

    assert!(controller.pause_session().success);
    assert!(controller.is_session_paused());
    assert!(!controller.is_session_on_break(), "a Pause is not a Break");

    assert!(controller.resume_session().success);
    assert!(!controller.is_session_paused());

    let posts = session_posts(&seen);
    let actions: Vec<_> = posts.iter().map(|p| p["action"].as_str().unwrap().to_string()).collect();
    assert_eq!(actions, ["idle", "resume"]);
    assert!(posts.iter().all(|p| p["activeSeconds"] == 400 && p["idleSeconds"] == 50));
}

#[test]
fn a_break_stops_capture_until_the_member_resumes() {
    let (url, seen) = backend(Notice::Acknowledged);
    let controller = mid_session(url);
    let tracker = controller.current_tracker().unwrap();

    assert!(controller.start_break().success);
    assert!(controller.is_session_on_break());
    assert!(tracker.gate().blocked(), "nothing is captured during a break");

    assert!(controller.resume_session().success);
    assert!(!controller.is_session_paused());
    assert!(!tracker.gate().blocked(), "resuming lifts the capture block");

    let breaks = break_posts(&seen);
    assert!(breaks[0]["minutes"].as_u64().unwrap() > 0, "the break is recorded");
    assert_eq!(breaks[1]["minutes"], 0, "and so is its end");
}

#[test]
fn pausing_with_no_timer_running_says_so() {
    let (url, _) = backend(Notice::Acknowledged);
    let controller = AgentController::new(test_settings(url)).unwrap();

    assert_eq!(controller.pause_session().error.as_deref(), Some("No active session"));
    assert_eq!(controller.start_break().error.as_deref(), Some("No active session"));
}

// --- Ending the session -------------------------------------------------------------

#[test]
fn stopping_with_a_note_closes_the_session_with_its_totals() {
    let (url, seen) = backend(Notice::Acknowledged);
    let controller = mid_session(url);

    assert!(controller.stop_session(Some("  fixed the login bug ")).success);

    let stop = &session_posts(&seen)[0];
    assert_eq!(stop["action"], "stop");
    assert_eq!(stop["stopNote"], "fixed the login bug");
    assert_eq!(stop["activeSeconds"], 400);
    assert_eq!(stop["idleSeconds"], 50);
    assert_eq!(stop["reason"], "member_stop");
    assert_eq!(controller.status(), "Signed in — waiting for timer");
}

#[test]
fn signing_out_mid_session_closes_it_and_forgets_the_account() {
    let (url, seen) = backend(Notice::Acknowledged);
    let controller = mid_session(url);

    controller.sign_out();

    let stop = &session_posts(&seen)[0];
    assert_eq!(stop["action"], "stop");
    assert_eq!(stop["reason"], "agent_signout");
    assert_eq!(stop["activeSeconds"], 400, "closed with its real totals, not 0s");
    assert_eq!(controller.status(), "Not signed in");
    assert_eq!(controller.get_connection_state(), ConnectionState::SignedOut);
    assert!(!controller.get_profile().signed_in);
}

#[test]
fn quitting_mid_session_closes_it() {
    let (url, seen) = backend(Notice::Acknowledged);
    let controller = mid_session(url);

    controller.stop();

    assert_eq!(session_posts(&seen)[0]["reason"], "agent_quit");
}

#[test]
fn the_computer_sleeping_closes_the_session_and_clears_a_pause() {
    let (url, seen) = backend(Notice::Acknowledged);
    let controller = mid_session(url);
    assert!(controller.pause_session().success);

    controller.stop_for_power("suspend");

    let stop = session_posts(&seen).pop().unwrap();
    assert_eq!(stop["action"], "stop");
    assert_eq!(stop["reason"], "system_suspend");
    assert!(!controller.is_session_paused(), "waking must not show a stale pause");
}

// --- Signing in ---------------------------------------------------------------------

#[test]
fn password_sign_in_needs_both_fields() {
    let (url, seen) = backend(Notice::Acknowledged);
    let controller = AgentController::new(test_settings(url)).unwrap();

    let result = controller.sign_in_with_password("  ", "secret");

    assert_eq!(result.error.as_deref(), Some("Enter your email and password."));
    assert!(seen.lock().is_empty());
}

#[test]
fn a_google_only_account_is_pointed_at_link_account_instead() {
    let (url, _) = backend(Notice::Acknowledged);
    let mut settings = test_settings(url.clone());
    settings.auth_url = url;
    let controller = AgentController::new(settings).unwrap();

    let result = controller.sign_in_with_password("member@example.com", "secret");

    assert!(!result.success);
    assert!(result.error.unwrap_or_default().contains("Use Link account"));
    assert!(!controller.get_profile().signed_in);
}
