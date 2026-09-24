use std::time::Duration;

use serde_json::Value;

use super::{ApiClient, ApiError};
use crate::constants::HTTP_TIMEOUT_SEC;
use crate::types::{AgentNotification, AgentNotificationList};

fn rejected_message(body: &Value, fallback: &str) -> String {
    body.get("error")
        .and_then(|value| value.as_str())
        .unwrap_or(fallback)
        .to_string()
}

impl ApiClient {
    pub fn report_agent_open(&mut self, version: &str, platform: &str) -> Result<(), ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let response = self
            .client
            .post(format!("{}/api/agent/open", self.api_url))
            .header("Authorization", auth)
            .json(&serde_json::json!({ "version": version, "platform": platform }))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        if status.is_server_error() {
            return Err(ApiError::Network);
        }
        let body = response.json::<Value>().unwrap_or(Value::Null);
        Err(ApiError::Rejected(rejected_message(&body, "Tracker version report was rejected.")))
    }

    /// Replies to an Owner message from the tracker.
    pub fn reply_to_message_thread(&mut self, thread_id: &str, body: &str) -> Result<(), ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let response = self
            .client
            .post(format!(
                "{}/api/messages/threads/{}/reply",
                self.api_url,
                urlencoding::encode(thread_id)
            ))
            .header("Authorization", auth)
            .json(&serde_json::json!({ "body": body }))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        if status.is_server_error() {
            return Err(ApiError::Network);
        }
        let body = response.json::<Value>().unwrap_or(Value::Null);
        Err(ApiError::Rejected(rejected_message(&body, "The reply was not accepted.")))
    }

    pub fn fetch_agent_notifications(&mut self) -> Result<AgentNotificationList, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let response = self
            .client
            .get(format!("{}/api/agent-notifications?limit=20", self.api_url))
            .header("Authorization", auth)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        let status = response.status();
        if !status.is_success() {
            return Err(if status.is_server_error() { ApiError::Network } else { ApiError::Unauthorized });
        }
        let body = response.json::<Value>().map_err(|_| ApiError::Network)?;
        let notifications = serde_json::from_value::<Vec<AgentNotification>>(
            body.get("data").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        )
        .map_err(|_| ApiError::Network)?;
        Ok(AgentNotificationList {
            notifications,
            unread_count: body.get("unreadCount").and_then(Value::as_u64).unwrap_or(0) as u32,
        })
    }

    pub fn mark_agent_notification_read(&mut self, notification_id: &str) -> Result<(), ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let response = self
            .client
            .post(format!("{}/api/agent-notifications/{}/read", self.api_url, urlencoding::encode(notification_id)))
            .header("Authorization", auth)
            .json(&serde_json::json!({}))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        if response.status().is_success() { Ok(()) } else { Err(ApiError::Rejected("Tracker notification was not found.".into())) }
    }

    pub fn mark_all_agent_notifications_read(&mut self) -> Result<(), ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let response = self
            .client
            .post(format!("{}/api/agent-notifications/read-all", self.api_url))
            .header("Authorization", auth)
            .json(&serde_json::json!({}))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        if response.status().is_success() { Ok(()) } else { Err(ApiError::Network) }
    }
}
