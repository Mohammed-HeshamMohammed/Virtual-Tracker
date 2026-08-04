use std::time::Duration;

use serde_json::{json, Value};

use super::ApiClient;
use crate::constants::{EVENT_POST_TIMEOUT_SEC, EVENT_SOURCE, HTTP_TIMEOUT_SEC, REGISTER_SOURCE};
use crate::types::ActivityEvent;

impl ApiClient {
    pub fn post_events(&mut self, session_id: &str, events: &[ActivityEvent]) -> bool {
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
            return false;
        }
        if let Ok(payload) = res.json::<Value>() {
            if let Some(data) = payload.get("data") {
                if data.get("skipped").and_then(|v| v.as_str())
                    == Some("desktop_agent_ingest_disabled")
                {
                    log::warn!(
                        "Server rejected agent events (desktop ingest disabled). \
                         Ask an admin to set ACTIVITY_DESKTOP_AGENT_INGEST_ENABLED=true and restart the backend."
                    );
                    return false;
                }
                if data.get("inserted").and_then(|v| v.as_i64()) == Some(0) {
                    log::warn!(
                        "Server accepted events but inserted 0 rows for session {session_id}"
                    );
                    return false;
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
