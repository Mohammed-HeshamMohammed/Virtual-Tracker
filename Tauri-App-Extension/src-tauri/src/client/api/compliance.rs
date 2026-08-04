use std::time::Duration;

use serde_json::{json, Value};

use super::{ApiClient, ApiError};
use crate::constants::HTTP_TIMEOUT_SEC;
use crate::types::MonitoringNoticeView;

impl ApiClient {
    /// CF-2: the current disclosure notice, composed server-side from the
    /// live monitoring_policy row. `Ok(None)` = reachable but nothing to show
    /// (e.g. not signed in yet). `Err(_)` = could not reach the backend at
    /// all - callers must NOT treat this as "no acknowledgement needed" or a
    /// network blip would let tracking start unconsented; see controller.rs.
    pub fn fetch_monitoring_notice(&mut self) -> Result<Option<MonitoringNoticeView>, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!("{}/api/compliance/notice", self.api_url);
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
        let Some(data) = body.get("data") else {
            return Ok(None);
        };
        Ok(Some(MonitoringNoticeView {
            version: data.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            text: data.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            requires_acknowledgement: data
                .get("requiresAcknowledgement")
                .and_then(|v| v.as_bool())
                // Fail closed on a malformed response - an unrecognised
                // shape must not be read as "already acknowledged".
                .unwrap_or(true),
        }))
    }

    /// Records that the current notice was shown (not yet accepted).
    pub fn post_monitoring_disclosure(&mut self, notice_version: &str) -> Result<(), ApiError> {
        self.post_compliance_consent("disclose", notice_version)
    }

    /// Records that the current notice was accepted - clears
    /// `requires_acknowledgement` on the next `fetch_monitoring_notice`.
    pub fn post_monitoring_consent(&mut self, notice_version: &str) -> Result<(), ApiError> {
        self.post_compliance_consent("accept", notice_version)
    }

    fn post_compliance_consent(&mut self, action: &str, notice_version: &str) -> Result<(), ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!("{}/api/compliance/consent/{action}", self.api_url);
        let res = self
            .client
            .post(url)
            .header("Authorization", auth)
            .header("Content-Type", "application/json")
            .json(&json!({ "noticeVersion": notice_version }))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        if res.status().is_success() {
            Ok(())
        } else {
            Err(ApiError::Network)
        }
    }
}
