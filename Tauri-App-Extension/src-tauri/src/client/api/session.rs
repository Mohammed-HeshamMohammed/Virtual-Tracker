use std::time::Duration;

use serde_json::{json, Value};

use super::{ApiClient, ApiError};
use crate::constants::HTTP_TIMEOUT_SEC;

/// The machine's IANA timezone name, or `None` if the OS won't tell us.
///
/// `None` is a normal outcome, not an error: the backend simply keeps
/// whatever it already had (or its UTC default), which is exactly the
/// behaviour that shipped before this was reported at all.
fn local_timezone() -> Option<String> {
    iana_time_zone::get_timezone()
        .ok()
        .map(|tz| tz.trim().to_string())
        .filter(|tz| !tz.is_empty())
}

/// The body of a session action. Its own function so what the server is told
/// can be tested without a live request (the test server cannot read bodies).
#[allow(clippy::too_many_arguments)]
fn session_action_payload(
    action: &str,
    task_id: Option<&str>,
    project_id: Option<&str>,
    active_seconds: u64,
    idle_seconds: u64,
    stop_note: Option<&str>,
    reason: Option<&str>,
    time_zone: Option<String>,
) -> Value {
    let mut payload = json!({
        "action": action,
        "activeSeconds": active_seconds,
        "idleSeconds": idle_seconds,
    });
    // Which calendar day this member's hours belong to is decided from their
    // timezone. Deliberately a zone *name*, never a timestamp: the server still
    // stamps every session itself.
    if let Some(tz) = time_zone {
        payload["timeZone"] = json!(tz);
    }
    if let Some(tid) = task_id {
        payload["taskId"] = json!(tid);
    }
    // Calling projects have no task, so this is the only thing tying the
    // session to the project it belongs to.
    if let Some(pid) = project_id {
        payload["projectId"] = json!(pid);
    }
    // Only "stop" carries one, and only when the project asks for it.
    if let Some(note) = stop_note.map(str::trim).filter(|n| !n.is_empty()) {
        payload["stopNote"] = json!(note);
    }
    // Why this happened, recorded by the server (PLAN-timer-stop-resilience.md D2).
    if let Some(reason) = reason.map(str::trim).filter(|r| !r.is_empty()) {
        payload["reason"] = json!(reason);
    }
    payload
}

impl ApiClient {
    /// `Ok(None)` = reachable, genuinely no active session. `Err(_)` = could
    /// not reach the backend, or reached it but got a bad response — the
    /// caller should keep tracking under the last known session rather than
    /// treat this the same as "no session".
    pub fn fetch_session(&mut self) -> Result<Option<Value>, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!("{}/api/activity/session", self.api_url);
        let res = self
            .client
            .get(url)
            .header("Authorization", auth)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        if !res.status().is_success() {
            return Err(ApiError::Network);
        }
        let body: Value = res.json().map_err(|_| ApiError::Network)?;
        Ok(body.get("data").cloned())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn post_session_action(
        &mut self,
        action: &str,
        task_id: Option<&str>,
        project_id: Option<&str>,
        active_seconds: u64,
        idle_seconds: u64,
        stop_note: Option<&str>,
        // Why this happened ("member_pause", "idle_escalation", ...), so the
        // server can record it (PLAN-timer-stop-resilience.md D2). `None` for
        // syncs, which are not state changes.
        reason: Option<&str>,
    ) -> Result<crate::types::SessionInfo, String> {
        let auth = self
            .authorized()
            .ok_or_else(|| "Not signed in".to_string())?;
        let url = format!("{}/api/activity/session", self.api_url);
        let payload = session_action_payload(
            action,
            task_id,
            project_id,
            active_seconds,
            idle_seconds,
            stop_note,
            reason,
            local_timezone(),
        );
        let res = self
            .client
            .post(url)
            .header("Authorization", auth)
            .header("Content-Type", "application/json")
            // Ties the server's session history to the build that wrote it
            // (PLAN D4), so a report can be matched to a version without
            // asking the member which one they have.
            .header("X-Agent-Version", env!("CARGO_PKG_VERSION"))
            .json(&payload)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|e| e.to_string())?;
        let status = res.status();
        let body: Value = res.json().unwrap_or(json!({}));
        if !status.is_success() {
            let err = body
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Session update failed");
            return Err(err.to_string());
        }
        let data = body.get("data");
        Ok(session_info_from_json(data))
    }

    pub fn current_session_info(&mut self) -> crate::types::SessionInfo {
        match self.fetch_session().unwrap_or(None) {
            Some(session) => session_info_from_json(Some(&session)),
            None => crate::types::SessionInfo {
                id: None,
                status: "stopped".into(),
                task_id: None,
                task_title: None,
                project_id: None,
                idle_stage: 0,
                active_seconds: 0,
                idle_seconds: 0,
                timer_capped: false,
                budget_capped: false,
            },
        }
    }
}

fn session_info_from_json(data: Option<&Value>) -> crate::types::SessionInfo {
    crate::types::SessionInfo {
        id: data
            .and_then(|d| d.get("id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        status: data
            .and_then(|d| d.get("status"))
            .and_then(|v| v.as_str())
            .unwrap_or("stopped")
            .to_string(),
        task_id: data
            .and_then(|d| d.get("taskId").or_else(|| d.get("task_id")))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        task_title: None,
        // Filled in by the controller from the live tracker - the server has
        // no view of local idle state.
        idle_stage: 0,
        project_id: data
            .and_then(|d| d.get("projectId").or_else(|| d.get("project_id")))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        active_seconds: data
            .and_then(|d| d.get("activeSeconds"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        idle_seconds: data
            .and_then(|d| d.get("idleSeconds"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        timer_capped: data
            .and_then(|d| d.get("timerCapped"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        budget_capped: data
            .and_then(|d| d.get("budgetCapped"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{fake_jwt, fake_server};
    use std::sync::{Arc, Mutex as StdMutex};

    #[test]
    fn a_state_change_tells_the_server_why() {
        let body = session_action_payload("stop", Some("task-1"), None, 30, 5, None, Some("idle_escalation"), None);
        assert_eq!(body["reason"], "idle_escalation");
        assert_eq!(body["action"], "stop");
        assert_eq!(body["taskId"], "task-1");
    }

    // Syncs are not state changes; a reason there would be noise in the history.
    #[test]
    fn a_sync_carries_no_reason() {
        let body = session_action_payload("sync", None, Some("proj-1"), 30, 5, None, None, None);
        assert!(body.get("reason").is_none());
    }

    #[test]
    fn a_blank_reason_is_not_sent() {
        let body = session_action_payload("idle", None, None, 0, 0, None, Some("   "), None);
        assert!(body.get("reason").is_none());
    }

    #[test]
    fn the_existing_fields_are_unchanged() {
        let body = session_action_payload(
            "stop",
            None,
            Some("proj-1"),
            12,
            3,
            Some("  done for today "),
            Some("member_stop"),
            Some("Africa/Cairo".to_string()),
        );
        assert_eq!(body["projectId"], "proj-1");
        assert_eq!(body["activeSeconds"], 12);
        assert_eq!(body["idleSeconds"], 3);
        assert_eq!(body["stopNote"], "done for today");
        assert_eq!(body["timeZone"], "Africa/Cairo");
    }

    // Ties the server's session history to the build that wrote it (PLAN D4).
    #[test]
    fn every_session_action_names_the_agent_version() {
        let seen: Arc<StdMutex<Option<String>>> = Arc::new(StdMutex::new(None));
        let seen_in_server = Arc::clone(&seen);
        let url = fake_server(move |request| {
            let version = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("X-Agent-Version"))
                .map(|h| h.value.as_str().to_string());
            *seen_in_server.lock().unwrap() = version;
            (200, r#"{"data": {"id": "sess-1", "status": "stopped"}}"#.to_string())
        });
        let mut api = ApiClient::new(url, "http://127.0.0.1:1".into()).expect("client builds");
        api.set_tokens(&fake_jwt(3600), "refresh-token");
        let _ = api.post_session_action("stop", None, None, 1, 0, None, Some("member_stop"));
        assert_eq!(seen.lock().unwrap().as_deref(), Some(env!("CARGO_PKG_VERSION")));
    }
}
