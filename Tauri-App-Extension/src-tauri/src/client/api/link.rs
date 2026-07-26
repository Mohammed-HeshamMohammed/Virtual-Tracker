use std::time::Duration;

use serde_json::{json, Value};

use super::ApiClient;
use crate::constants::{HTTP_TIMEOUT_SEC, REGISTER_SOURCE};

impl ApiClient {
    pub fn create_link_session(&self) -> Option<(String, String)> {
        let url = format!("{}/api/activity/agent/link/init", self.api_url);
        let res = self
            .client
            .post(url)
            .header("Content-Type", "application/json")
            .json(&json!({"source": REGISTER_SOURCE}))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .ok()?;
        if !res.status().is_success() {
            return None;
        }
        let body: Value = res.json().ok()?;
        let data = body.get("data")?;
        let link_token = data.get("linkToken")?.as_str()?.to_string();
        let agent_secret = data.get("agentSecret")?.as_str()?.to_string();
        Some((link_token, agent_secret))
    }

    /// Returns (HTTP status, tokens). Status 0 means a network error.
    pub fn poll_link_exchange(
        &self,
        link_token: &str,
        agent_secret: &str,
    ) -> (u16, Option<(String, String)>) {
        let url = format!("{}/api/activity/agent/link/exchange", self.api_url);
        let res = match self
            .client
            .post(url)
            .header("Content-Type", "application/json")
            .json(&json!({
                "linkToken": link_token,
                "agentSecret": agent_secret,
            }))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
        {
            Ok(r) => r,
            Err(err) => {
                log::warn!("Link exchange network error: {err}");
                return (0, None);
            }
        };
        let status = res.status().as_u16();
        if status == 409 {
            return (409, None);
        }
        if !res.status().is_success() {
            let text = res.text().unwrap_or_default();
            log::warn!(
                "Link exchange failed ({status}): {}",
                &text[..text.len().min(200)]
            );
            return (status, None);
        }
        let body: Value = match res.json() {
            Ok(v) => v,
            Err(_) => return (status, None),
        };
        let data = body.get("data").cloned().unwrap_or(Value::Null);
        let id_token = match data.get("idToken").and_then(|v| v.as_str()) {
            Some(t) if !t.is_empty() => t.to_string(),
            _ => {
                log::warn!("Link exchange returned 200 without idToken");
                return (status, None);
            }
        };
        let refresh = data
            .get("refreshToken")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        (200, Some((id_token, refresh)))
    }
}
