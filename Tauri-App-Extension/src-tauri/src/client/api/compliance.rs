use std::time::Duration;

use serde_json::{json, Value};

use super::{ApiClient, ApiError};
use crate::constants::HTTP_TIMEOUT_SEC;
use crate::types::MonitoringNoticeView;

impl ApiClient {
    /// App patterns the org has excluded from capture.
    pub fn fetch_capture_exclusions(&mut self) -> Result<Vec<String>, ()> {
        let auth = self.authorized().ok_or(())?;
        let url = format!("{}/api/compliance/capture-exclusions/effective", self.api_url);
        let res = self
            .client
            .get(url)
            .header("Authorization", auth)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ())?;
        if !res.status().is_success() {
            return Err(());
        }
        let body: Value = res.json().map_err(|_| ())?;
        Ok(body
            .get("data")
            .and_then(|d| d.get("apps"))
            .and_then(|v| v.as_array())
            .map(|rows| {
                rows.iter()
                    .filter_map(|r| r.as_str())
                    .map(|s| s.trim().to_lowercase())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default())
    }

    /// The current disclosure notice, composed server-side from the live monitoring_policy
    /// row.
    pub fn fetch_monitoring_notice(&mut self) -> Result<Option<MonitoringNoticeView>, ApiError> {
        let body = self.get_json("/api/compliance/notice")?;
        let Some(data) = body.get("data") else {
            return Ok(None);
        };
        Ok(Some(MonitoringNoticeView {
            version: data.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            text: data.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            requires_acknowledgement: data
                .get("requiresAcknowledgement")
                .and_then(|v| v.as_bool())
                // Fail closed on a malformed response - an unrecognised shape must not be
                // read as "already acknowledged".
                .unwrap_or(true),
        }))
    }

    /// Records that the current notice was shown (not yet accepted).
    pub fn post_monitoring_disclosure(&mut self, notice_version: &str) -> Result<(), ApiError> {
        self.post_compliance_consent("disclose", notice_version)
    }

    /// Records that the current notice was accepted - clears `requires_acknowledgement` on
    /// the next `fetch_monitoring_notice`.
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

impl ApiClient {
    /// `minutes = None` ends the break. This is the audit record; the tracker
    /// has already stopped capturing locally.
    pub fn set_private_break(&mut self, minutes: Option<u32>, reason: &str) -> Result<i64, ApiError> {
        let body = serde_json::json!({ "minutes": minutes.unwrap_or(0), "reason": reason });
        let value = self.post_json("/api/activity/private-break", &body)?;
        Ok(value
            .get("data")
            .and_then(|d| d.get("breakUntil"))
            .and_then(|v| v.as_str())
            .and_then(epoch_ms_from_iso)
            .unwrap_or(0))
    }
}

/// The server returns an ISO-8601 instant; only the epoch is needed and the
/// agent has no date library, so this reads the fixed-width fields directly.
fn epoch_ms_from_iso(iso: &str) -> Option<i64> {
    let bytes = iso.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let num = |from: usize, to: usize| iso.get(from..to)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi, s) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    // Days from the civil epoch (Howard Hinnant's days_from_civil).
    let y = if mo <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400) + h * 3_600 + mi * 60 + s) * 1_000)
}
