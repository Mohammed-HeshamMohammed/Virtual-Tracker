//! Tests for work.rs.

#[allow(unused_imports)]
use super::*;

#[cfg(test)]
mod tests {
    #[test]
    fn week_days_parse_from_the_limits_payload_and_tolerate_its_absence() {
        let payload = serde_json::json!([
            { "day": "2026-09-14", "label": "Mon", "activeSeconds": 424, "idleSeconds": 12 },
            { "day": "2026-09-15", "label": "Tue", "activeSeconds": 0, "idleSeconds": 0 }
        ]);
        let days = super::parse_week_days(Some(&payload));
        assert_eq!(days.len(), 2);
        assert_eq!(days[0].day, "2026-09-14");
        assert_eq!(days[0].active_seconds, 424);
        assert_eq!(days[0].idle_seconds, 12);
        assert!(super::parse_week_days(None).is_empty());
        assert!(super::parse_week_days(Some(&serde_json::json!("garbage"))).is_empty());
    }

    use super::*;
    use crate::test_support::{fake_jwt, fake_server};

    fn authed_client(api_url: String) -> ApiClient {
        let mut api = ApiClient::new(api_url, "http://127.0.0.1:1".into())
            .expect("HTTP client builds in a test environment");
        api.set_tokens(&fake_jwt(3600), "refresh-token");
        api
    }

    #[test]
    fn assign_task_to_self_posts_to_the_per_task_assignments_endpoint_not_the_flat_one() {
        let url = fake_server(|request| {
            let path = request.url().to_string();
            if path == "/api/activity/scope" {
                return (200, r#"{"data": {"viewerMemberId": "m1"}}"#.to_string());
            }
            assert_ne!(
                path, "/api/task-assignments",
                "must not use the flat endpoint - it has no creator exception",
            );
            assert_eq!(
                path, "/api/tasks/t1/assignments",
                "must hit the per-task endpoint for task t1, whose canSyncTaskAssignments \
                 allows the task's own creator",
            );
            assert_eq!(request.method(), &tiny_http::Method::Post);
            (200, r#"{"success": true, "data": []}"#.to_string())
        });
        let mut api = authed_client(url);
        assert_eq!(api.assign_task_to_self("t1"), Ok(true));
    }

    #[test]
    fn assign_task_to_self_reports_false_rather_than_erroring_on_a_business_rejection() {
        // E.g.
        let url = fake_server(|request| {
            if request.url() == "/api/activity/scope" {
                return (200, r#"{"data": {"viewerMemberId": "m1"}}"#.to_string());
            }
            (400, r#"{"success": false, "error": "You have reached your daily limit."}"#.to_string())
        });
        let mut api = authed_client(url);
        assert_eq!(api.assign_task_to_self("t1"), Ok(false));
    }
}

#[cfg(test)]
mod diagnostic_error_tests {
    use super::*;
    use crate::test_support::{fake_jwt, fake_server};

    fn authed_client(api_url: String) -> ApiClient {
        let mut api = ApiClient::new(api_url, "http://127.0.0.1:1".into())
            .expect("HTTP client builds in a test environment");
        api.set_tokens(&fake_jwt(3600), "refresh-token");
        api
    }

    // Regression for a real diagnostic dead end: both fetches used to collapse every
    // non-404 failure into a bare ApiError::Network, making a 401 (stale/invalid token)
    #[test]
    fn workspace_401_is_a_rejected_error_naming_its_status_not_a_bare_network_error() {
        let url = fake_server(|_request| (401, r#"{"error": "Invalid token"}"#.to_string()));
        let mut api = authed_client(url);
        let err = api.fetch_agent_workspace().unwrap_err();
        match err {
            ApiError::Rejected(msg) => {
                assert!(msg.contains("401"), "expected the status code in the message, got: {msg}");
                assert!(msg.contains("Invalid token"), "expected the server's own message, got: {msg}");
            }
            other => panic!("expected ApiError::Rejected, got {other:?}"),
        }
    }

    #[test]
    fn screenshots_500_is_a_rejected_error_naming_its_status() {
        let url = fake_server(|_request| (500, r#"{"error": "Internal error"}"#.to_string()));
        let mut api = authed_client(url);
        let err = api.fetch_my_screenshots(12, None).unwrap_err();
        match err {
            ApiError::Rejected(msg) => assert!(msg.contains("500"), "expected the status code, got: {msg}"),
            other => panic!("expected ApiError::Rejected, got {other:?}"),
        }
    }

    // Unchanged behavior, pinned so the branch above can't accidentally swallow the
    // still-important "older backend" case into Rejected too.
    #[test]
    fn workspace_404_is_still_ok_none_not_an_error() {
        let url = fake_server(|_request| (404, "not found".to_string()));
        let mut api = authed_client(url);
        // Matches!, not assert_eq!
        assert!(matches!(api.fetch_agent_workspace(), Ok(None)));
    }

    #[test]
    fn fetch_my_screenshots_only_appends_project_id_when_one_is_given() {
        use std::sync::{Arc, Mutex};
        let seen_urls: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&seen_urls);
        let url = fake_server(move |request| {
            seen.lock().unwrap().push(request.url().to_string());
            (200, r#"{"data": []}"#.to_string())
        });
        let mut api = authed_client(url);

        api.fetch_my_screenshots(6, None).expect("ok");
        api.fetch_my_screenshots(6, Some("proj-1")).expect("ok");

        let urls = seen_urls.lock().unwrap();
        assert!(!urls[0].contains("projectId"), "no filter requested: {}", urls[0]);
        assert!(urls[1].contains("projectId=proj-1"), "filter requested: {}", urls[1]);
    }

    #[test]
    fn project_app_breakdown_404_is_ok_empty_not_an_error() {
        let url = fake_server(|_request| (404, "not found".to_string()));
        let mut api = authed_client(url);
        let breakdown = api.fetch_project_app_breakdown("proj-1").expect("ok");
        assert!(breakdown.apps.is_empty());
        assert_eq!(breakdown.total_seconds, 0);
    }

    #[test]
    fn project_app_breakdown_parses_apps_and_the_totals_they_came_from() {
        let url = fake_server(|_request| {
            (
                200,
                r#"{"data": {"apps": [{"appName": "Zoom", "totalSeconds": 1800}],
                             "totalSeconds": 5400, "appCount": 9, "shownSeconds": 1800}}"#
                    .to_string(),
            )
        });
        let mut api = authed_client(url);
        let breakdown = api.fetch_project_app_breakdown("proj-1").expect("ok");
        assert_eq!(breakdown.apps.len(), 1);
        assert_eq!(breakdown.apps[0].app_name, "Zoom");
        assert_eq!(breakdown.apps[0].total_seconds, 1800);
        // The panel needs these to say it is showing a few of many.
        assert_eq!(breakdown.total_seconds, 5400);
        assert_eq!(breakdown.app_count, 9);
    }

    // A server on the previous release still returns a bare array here.
    #[test]
    fn project_app_breakdown_accepts_an_older_servers_bare_array() {
        let url = fake_server(|_request| {
            (200, r#"{"data": [{"appName": "Zoom", "totalSeconds": 1800}]}"#.to_string())
        });
        let mut api = authed_client(url);
        let breakdown = api.fetch_project_app_breakdown("proj-1").expect("ok");
        assert_eq!(breakdown.apps.len(), 1);
        assert_eq!(breakdown.apps[0].app_name, "Zoom");
        assert_eq!(breakdown.total_seconds, 1800);
        assert_eq!(breakdown.app_count, 1);
    }
}

#[cfg(test)]
mod project_budget_percent_tests {
    use super::*;
    use crate::test_support::{fake_jwt, fake_server};

    fn authed_client(api_url: String) -> ApiClient {
        let mut api = ApiClient::new(api_url, "http://127.0.0.1:1".into())
            .expect("HTTP client builds in a test environment");
        api.set_tokens(&fake_jwt(3600), "refresh-token");
        api
    }

    // The actual bug: a project's real spend/target was only ever kept for projects with
    // stop_timers_when_reached on - every other budgeted project's spend was computed by
    #[test]
    fn spent_percent_is_kept_even_when_stop_timers_when_reached_is_off() {
        let url = fake_server(|_request| {
            (
                200,
                r#"{"data": [{
                    "project_id": "p1",
                    "spent": 30,
                    "target": 100,
                    "stop_timers_when_reached": false
                }]}"#
                    .to_string(),
            )
        });
        let mut api = authed_client(url);
        let map = api.fetch_project_budgets_map().expect("ok");
        let (exhausted, spent_percent) = map.get("p1").copied().expect("p1 present");
        assert_eq!(exhausted, false, "never exhausted when the project opted out of stopping timers");
        assert_eq!(spent_percent, Some(30.0), "30/100 spent, not thrown away");
    }

    #[test]
    fn spent_percent_is_none_not_zero_when_there_is_no_real_target() {
        let url = fake_server(|_request| {
            (200, r#"{"data": [{"project_id": "p1", "spent": 0, "target": 0}]}"#.to_string())
        });
        let mut api = authed_client(url);
        let map = api.fetch_project_budgets_map().expect("ok");
        let (_, spent_percent) = map.get("p1").copied().expect("p1 present");
        assert_eq!(spent_percent, None, "nothing to divide by is not the same as 0% spent");
    }

    #[test]
    fn exhausted_still_requires_stop_timers_when_reached_and_crossing_the_threshold() {
        let url = fake_server(|_request| {
            (
                200,
                r#"{"data": [{
                    "project_id": "p1",
                    "spent": 95,
                    "target": 100,
                    "stop_timers_when_reached": true,
                    "stop_timers_at_pct": 90
                }]}"#
                    .to_string(),
            )
        });
        let mut api = authed_client(url);
        let map = api.fetch_project_budgets_map().expect("ok");
        let (exhausted, spent_percent) = map.get("p1").copied().expect("p1 present");
        assert_eq!(exhausted, true, "95% >= the 90% stop threshold");
        assert_eq!(spent_percent, Some(95.0));
    }
}
