use std::time::Duration;

use serde_json::{json, Value};

use super::ApiClient;
use crate::constants::{EVENT_POST_TIMEOUT_SEC, EVENT_SOURCE, HTTP_TIMEOUT_SEC, REGISTER_SOURCE};
use crate::types::ActivityEvent;

impl ApiClient {
    pub fn post_events(&mut self, session_id: &str, events: &[ActivityEvent]) -> bool {
        self.post_events_at(session_id, events, None)
    }

    /// `captured_at_ms` is when a queued batch was captured; the server uses it instead of
    /// its own clock so an outage does not move events to the moment of the retry.
    pub fn post_events_at(
        &mut self,
        session_id: &str,
        events: &[ActivityEvent],
        captured_at_ms: Option<i64>,
    ) -> bool {
        if self.id_token.is_none() || events.is_empty() {
            return false;
        }
        let Some(auth) = self.authorized() else {
            return false;
        };
        let url = format!("{}/api/activity/events", self.api_url);
        let payload = json!({
            "sessionId": session_id,
            "events": events,
            "source": EVENT_SOURCE,
            "capturedAtMs": captured_at_ms,
        });
        let res = match self
            .client
            .post(url)
            .header("Authorization", auth)
            .header("Content-Type", "application/json")
            .json(&payload)
            .timeout(Duration::from_secs(EVENT_POST_TIMEOUT_SEC))
            .send()
        {
            Ok(r) => r,
            Err(_) => return false,
        };
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().unwrap_or_default();
            log::warn!(
                "Event upload failed ({}): {}",
                status.as_u16(),
                &text[..text.len().min(200)]
            );
            // A refusal of this batch itself will be the same on every retry, and a queued
            // batch that never succeeds holds back every batch queued behind it. A bare 404
            // is not one: a proxy answers that while the backend is mid-deploy.
            let refused = matches!(status.as_u16(), 400 | 413 | 422)
                || (status.as_u16() == 404 && text.contains("Session not found"));
            if refused {
                log::warn!("The server refused these events for good - not retrying");
                return true;
            }
            return false;
        }
        if let Ok(payload) = res.json::<Value>() {
            if let Some(data) = payload.get("data") {
                if events.iter().any(|e| matches!(e, ActivityEvent::Screenshot { .. })) {
                    self.screenshots_off_by_policy = data
                        .pointer("/policyDropped/screenshots")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0)
                        > 0;
                }
                if data.get("skipped").and_then(|v| v.as_str())
                    == Some("desktop_agent_ingest_disabled")
                {
                    log::warn!(
                        "Server rejected agent events (desktop ingest disabled). \
                         Ask an admin to set ACTIVITY_DESKTOP_AGENT_INGEST_ENABLED=true and restart the backend."
                    );
                    return false;
                }
                // An answer, not an outage: the server dropped these on purpose (an excluded
                // app, a policy, an oversize image). Re-queueing would retry them for ever.
                if data.get("inserted").and_then(|v| v.as_i64()) == Some(0) {
                    log::warn!("Server accepted the events but stored none of them - not retrying");
                }
            }
        }
        true
    }

    pub fn register_agent(&mut self) -> bool {
        let Some(auth) = self.authorized() else {
            return false;
        };
        let url = format!("{}/api/activity/agent/register", self.api_url);
        self.client
            .post(url)
            .header("Authorization", auth)
            .header("Content-Type", "application/json")
            .json(&json!({"source": REGISTER_SOURCE}))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{fake_jwt, fake_server};
    use crate::types::ActivitySignal;

    fn one_event() -> Vec<ActivityEvent> {
        vec![ActivityEvent::App {
            app_name: "Notepad".into(),
            page_title: "notes".into(),
            duration_seconds: 15,
            app_icon: None,
            signal: ActivitySignal::default(),
        }]
    }

    fn signed_in_client(server: String) -> ApiClient {
        let mut api = ApiClient::new(server, "http://127.0.0.1:1".into()).expect("client builds");
        api.set_tokens(&fake_jwt(3600), "refresh-token");
        api
    }

    #[test]
    fn events_the_server_stored_are_delivered() {
        let url = fake_server(|_| (200, r#"{"data": {"inserted": 1}}"#.to_string()));
        assert!(signed_in_client(url).post_events("sess-1", &one_event()));
    }

    // PLAN-agent-time-loss-and-event-queue.md Q2: the server answers 200 with inserted 0
    // when it dropped the events on purpose (an excluded app, a policy, an oversize image).
    // That is an answer, not an outage: re-queueing the batch retries it every 30 s until
    // the 2000-batch cap pushes it out.
    #[test]
    fn events_the_server_dropped_on_purpose_are_not_retried_forever() {
        let url = fake_server(|_| (200, r#"{"data": {"inserted": 0}}"#.to_string()));
        assert!(
            signed_in_client(url).post_events("sess-1", &one_event()),
            "a 200 that says nothing was stored is final, so the batch must not be re-queued"
        );
    }

    // The one 200 that really is "try again later": an admin switched agent ingest off.
    #[test]
    fn events_refused_because_ingest_is_switched_off_stay_queued() {
        let url = fake_server(|_| {
            (200, r#"{"data": {"inserted": 0, "skipped": "desktop_agent_ingest_disabled"}}"#.to_string())
        });
        assert!(!signed_in_client(url).post_events("sess-1", &one_event()));
    }

    // A queued batch the server will never take (its session is gone) used to fail every
    // flush, and flush stops at the first failure, so nothing queued behind it was ever sent.
    #[test]
    fn events_for_a_session_the_server_no_longer_has_are_not_retried_forever() {
        let url = fake_server(|_| (404, r#"{"success": false, "error": "Session not found"}"#.to_string()));
        assert!(signed_in_client(url).post_events("sess-1", &one_event()));
    }

    #[test]
    fn a_404_that_is_not_about_the_session_keeps_the_events_queued() {
        let url = fake_server(|_| (404, "Not Found".to_string()));
        assert!(!signed_in_client(url).post_events("sess-1", &one_event()));
    }

    #[test]
    fn a_screenshot_dropped_by_the_monitoring_policy_is_remembered_until_one_is_stored() {
        let shot = vec![ActivityEvent::Screenshot {
            image_data: "data:image/jpeg;base64,AA==".into(),
            app_name: "Notepad".into(),
            page_title: String::new(),
            activity_level: 50,
            url: None,
            signal: ActivitySignal::default(),
        }];
        let off = fake_server(|_| (200, r#"{"data": {"inserted": 0, "policyDropped": {"screenshots": 1}}}"#.to_string()));
        let mut api = signed_in_client(off);
        assert!(api.post_events("sess-1", &shot));
        assert!(api.screenshots_off_by_policy);
        // An app slice says nothing about screenshots either way.
        assert!(api.post_events("sess-1", &one_event()));
        assert!(api.screenshots_off_by_policy);

        let on = fake_server(|_| (200, r#"{"data": {"inserted": 1}}"#.to_string()));
        let mut api = signed_in_client(on);
        api.screenshots_off_by_policy = true;
        assert!(api.post_events("sess-1", &shot));
        assert!(!api.screenshots_off_by_policy);
    }

    #[test]
    fn a_server_error_keeps_the_events_queued() {
        let url = fake_server(|_| (500, r#"{"error": "boom"}"#.to_string()));
        assert!(!signed_in_client(url).post_events("sess-1", &one_event()));
    }
}
