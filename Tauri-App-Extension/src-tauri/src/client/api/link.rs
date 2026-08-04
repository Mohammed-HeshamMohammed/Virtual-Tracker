use std::time::Duration;

use serde_json::{json, Value};

use super::ApiClient;
use crate::capture::vm_detect::detect_vm;
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

    /// Claims a device credential for this machine using the token we already
    /// hold. Covers the paths link/exchange doesn't: the browser's loopback
    /// handoff (which skips the exchange entirely) and agents that linked
    /// before device credentials existed. No-op once one is held.
    pub fn ensure_device_registered(&mut self) -> bool {
        if self.has_device_credential() {
            return true;
        }
        let Some(auth) = self.auth_headers() else {
            return false;
        };
        let url = format!("{}/api/activity/agent/device/register", self.api_url);
        // AC-3: computed once, right here at registration - not per-tick,
        // since VM status doesn't change mid-session. A signal for a manager
        // to weigh in context, never a verdict this call blocks on.
        let vm = detect_vm();
        let res = self
            .client
            .post(url)
            .header("Authorization", auth)
            .header("Content-Type", "application/json")
            .json(&json!({
                "source": REGISTER_SOURCE,
                "vmDetected": vm.detected,
                "vmSignals": vm.signals,
            }))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send();
        let Ok(res) = res else {
            log::warn!("Device registration unreachable; will retry on next link/launch");
            return false;
        };
        if !res.status().is_success() {
            log::warn!("Device registration failed ({})", res.status().as_u16());
            return false;
        }
        let Ok(body) = res.json::<Value>() else {
            return false;
        };
        let device_id = body
            .pointer("/data/deviceId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let secret = body
            .pointer("/data/agentSecret")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if device_id.is_empty() || secret.is_empty() {
            return false;
        }
        self.set_device_credential(device_id, secret);
        log::info!("Device credential registered for in-app reconnect");
        true
    }

    /// Returns (HTTP status, tokens). Status 0 means a network error.
    ///
    /// Also captures the long-lived device credential the backend hands back
    /// here, so this machine can re-authenticate on its own later instead of
    /// needing another browser link.
    pub fn poll_link_exchange(
        &mut self,
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

        let device_id = data
            .get("deviceId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        // Falls back to the secret we already hold from link/init if the
        // backend didn't echo it.
        let device_secret = data
            .get("agentSecret")
            .and_then(|v| v.as_str())
            .unwrap_or(agent_secret)
            .to_string();
        if !device_id.is_empty() && !device_secret.is_empty() {
            self.set_device_credential(&device_id, &device_secret);
            log::info!("Device credential stored for in-app reconnect");
        } else {
            log::warn!("Link exchange returned no device credential - in-app reconnect unavailable");
        }

        (200, Some((id_token, refresh)))
    }
}
