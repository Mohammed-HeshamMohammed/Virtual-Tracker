use std::time::Duration;

use serde_json::{json, Value};

use super::{ApiClient, ApiError};
use crate::constants::HTTP_TIMEOUT_SEC;

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

    pub fn post_session_action(
        &mut self,
        action: &str,
        task_id: Option<&str>,
        project_id: Option<&str>,
        active_seconds: u64,
        idle_seconds: u64,
        stop_note: Option<&str>,
    ) -> Result<crate::types::SessionInfo, String> {
        let auth = self
            .authorized()
            .ok_or_else(|| "Not signed in".to_string())?;
        let url = format!("{}/api/activity/session", self.api_url);
        let mut payload = json!({
            "action": action,
            "activeSeconds": active_seconds,
            "idleSeconds": idle_seconds,
        });
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
        let res = self
            .client
            .post(url)
            .header("Authorization", auth)
            .header("Content-Type", "application/json")
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
