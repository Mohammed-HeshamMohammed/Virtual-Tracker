use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::blocking::Client;
use serde_json::{json, Value};

use crate::client::firebase::FirebaseTokenService;
use crate::constants::{
    EVENT_POST_TIMEOUT_SEC, EVENT_SOURCE, HTTP_TIMEOUT_SEC, REGISTER_SOURCE,
    TOKEN_REFRESH_BUFFER_MS,
};
use crate::types::ActivityEvent;

pub struct ApiClient {
    api_url: String,
    client: Client,
    firebase: FirebaseTokenService,
    pub id_token: Option<String>,
    pub refresh_token: Option<String>,
    pub on_tokens_refreshed: Option<Box<dyn Fn(String, String) + Send>>,
}

impl ApiClient {
    pub fn new(api_url: String) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .build()
            .expect("http client");
        let firebase = FirebaseTokenService::new(api_url.clone(), client.clone());
        Self {
            api_url,
            client,
            firebase,
            id_token: None,
            refresh_token: None,
            on_tokens_refreshed: None,
        }
    }

    pub fn set_tokens(&mut self, id_token: &str, refresh_token: &str) {
        self.id_token = if id_token.is_empty() {
            None
        } else {
            Some(id_token.to_string())
        };
        self.refresh_token = if refresh_token.is_empty() {
            None
        } else {
            Some(refresh_token.to_string())
        };
    }

    pub fn is_authenticated(&self) -> bool {
        self.id_token.is_some()
    }

    fn auth_headers(&self) -> Option<String> {
        self.id_token
            .as_ref()
            .map(|t| format!("Bearer {t}"))
    }

    pub fn refresh_token_if_needed(&mut self) -> bool {
        let Some(id_token) = self.id_token.clone() else {
            return false;
        };
        let Some(refresh) = self.refresh_token.clone() else {
            return true;
        };
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        if let Some(exp) = FirebaseTokenService::id_token_expiry_ms(&id_token) {
            if exp > now_ms + TOKEN_REFRESH_BUFFER_MS {
                return true;
            }
        }
        match self.firebase.refresh(&refresh) {
            Some((id, next_refresh)) => {
                self.id_token = Some(id.clone());
                self.refresh_token = Some(next_refresh.clone());
                if let Some(cb) = &self.on_tokens_refreshed {
                    cb(id, next_refresh);
                }
                true
            }
            None => false,
        }
    }

    pub fn fetch_session(&mut self) -> Option<Value> {
        if !self.refresh_token_if_needed() {
            return None;
        }
        let auth = self.auth_headers()?;
        let url = format!("{}/api/activity/session", self.api_url);
        let res = self
            .client
            .get(url)
            .header("Authorization", auth)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .ok()?;
        if !res.status().is_success() {
            return None;
        }
        let body: Value = res.json().ok()?;
        body.get("data").cloned()
    }

    pub fn post_events(&mut self, session_id: &str, events: &[ActivityEvent]) -> bool {
        if self.id_token.is_none() || events.is_empty() {
            return false;
        }
        if !self.refresh_token_if_needed() {
            return false;
        }
        let auth = match self.auth_headers() {
            Some(a) => a,
            None => return false,
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
        if !self.refresh_token_if_needed() {
            return false;
        }
        let auth = match self.auth_headers() {
            Some(a) => a,
            None => return false,
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

    pub fn health_ok(&self) -> bool {
        let url = format!("{}/health", self.api_url);
        self.client
            .get(url)
            .timeout(Duration::from_secs(2))
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    pub fn fetch_viewer_member_id(&mut self) -> Option<String> {
        if !self.refresh_token_if_needed() {
            return None;
        }
        let auth = self.auth_headers()?;
        let url = format!("{}/api/activity/scope", self.api_url);
        let res = self
            .client
            .get(url)
            .header("Authorization", auth)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .ok()?;
        if !res.status().is_success() {
            return None;
        }
        let body: Value = res.json().ok()?;
        body.pointer("/data/viewerMemberId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }

    pub fn fetch_viewer_projects(&mut self) -> Result<Vec<crate::types::ProjectInfo>, String> {
        if !self.refresh_token_if_needed() {
            return Err("Not signed in".into());
        }
        let auth = self
            .auth_headers()
            .ok_or_else(|| "Not signed in".to_string())?;
        let url = format!("{}/api/projects", self.api_url);
        let res = self
            .client
            .get(url)
            .header("Authorization", auth)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("Failed to load projects ({})", res.status().as_u16()));
        }
        let body: Value = res.json().map_err(|e| e.to_string())?;
        let list = body
            .get("data")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut projects = Vec::new();
        for item in list {
            let id = item
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if id.is_empty() {
                continue;
            }
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Untitled project")
                .to_string();
            projects.push(crate::types::ProjectInfo { id, name });
        }
        projects.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(projects)
    }

    pub fn fetch_assigned_tasks(
        &mut self,
        project_id: Option<&str>,
    ) -> Result<Vec<crate::types::AgentTask>, String> {
        if !self.refresh_token_if_needed() {
            return Err("Not signed in".into());
        }
        let member_id = self
            .fetch_viewer_member_id()
            .ok_or_else(|| "Could not resolve your member profile".to_string())?;
        let auth = self
            .auth_headers()
            .ok_or_else(|| "Not signed in".to_string())?;
        let mut url = format!(
            "{}/api/tasks?assigned_to={}",
            self.api_url,
            urlencoding::encode(&member_id)
        );
        if let Some(pid) = project_id.filter(|p| !p.is_empty()) {
            url.push_str(&format!("&project_id={}", urlencoding::encode(pid)));
        }
        let res = self
            .client
            .get(url)
            .header("Authorization", auth)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("Failed to load tasks ({})", res.status().as_u16()));
        }
        let body: Value = res.json().map_err(|e| e.to_string())?;
        let list = body
            .get("data")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut tasks = Vec::new();
        for item in list {
            let id = item
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if id.is_empty() {
                continue;
            }
            let title = item
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("Untitled task")
                .to_string();
            let status = item
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            // Prefer actionable tasks; still show others if status empty.
            let lower = status.to_lowercase();
            if !lower.is_empty()
                && matches!(
                    lower.as_str(),
                    "done" | "completed" | "cancelled" | "canceled" | "archived"
                )
            {
                continue;
            }
            tasks.push(crate::types::AgentTask { id, title, status });
        }
        tasks.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
        Ok(tasks)
    }

    pub fn post_session_action(
        &mut self,
        action: &str,
        task_id: Option<&str>,
    ) -> Result<crate::types::SessionInfo, String> {
        if !self.refresh_token_if_needed() {
            return Err("Not signed in".into());
        }
        let auth = self
            .auth_headers()
            .ok_or_else(|| "Not signed in".to_string())?;
        let url = format!("{}/api/activity/session", self.api_url);
        let mut payload = json!({
            "action": action,
            "activeSeconds": 0,
            "idleSeconds": 0,
        });
        if let Some(tid) = task_id {
            payload["taskId"] = json!(tid);
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
        Ok(crate::types::SessionInfo {
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
        })
    }

    pub fn current_session_info(&mut self) -> crate::types::SessionInfo {
        match self.fetch_session() {
            Some(session) => crate::types::SessionInfo {
                id: session
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                status: session
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("stopped")
                    .to_string(),
                task_id: session
                    .get("taskId")
                    .or_else(|| session.get("task_id"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                task_title: None,
            },
            None => crate::types::SessionInfo {
                id: None,
                status: "stopped".into(),
                task_id: None,
                task_title: None,
            },
        }
    }
}
