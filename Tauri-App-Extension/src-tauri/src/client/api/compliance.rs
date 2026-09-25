use std::time::Duration;

use serde_json::{json, Value};

use super::{ApiClient, ApiError};
use crate::constants::HTTP_TIMEOUT_SEC;
use crate::types::{CaptureSummary, MonitoringNoticeView, OwnExclusion};

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
    /// Tells the server that unsent activity was discarded, so the member is
    /// told rather than only a local log line being written.
    pub fn report_dropped_batches(&mut self, batches: usize) -> Result<(), ApiError> {
        let body = serde_json::json!({ "kind": "work_dropped", "detail": format!("{batches} batch(es)") });
        self.post_ok("/api/activity/record-notice", &body, "Could not report discarded activity.")
    }

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

impl ApiClient {
    /// The member's own never-capture list, not the org-wide one.
    pub fn list_own_exclusions(&mut self) -> Result<Vec<OwnExclusion>, ApiError> {
        let body = self.get_json("/api/compliance/my-capture-exclusions")?;
        Ok(body
            .get("data")
            .and_then(|d| serde_json::from_value(d.clone()).ok())
            .unwrap_or_default())
    }

    pub fn add_own_exclusion(&mut self, match_type: &str, pattern: &str) -> Result<OwnExclusion, ApiError> {
        let body = json!({ "matchType": match_type, "pattern": pattern });
        let value = self.post_json("/api/compliance/my-capture-exclusions", &body)?;
        value
            .get("data")
            .and_then(|d| serde_json::from_value(d.clone()).ok())
            // A null row means the server already had this exact rule.
            .ok_or_else(|| ApiError::Rejected("That is already on your list.".into()))
    }

    pub fn remove_own_exclusion(&mut self, id: &str) -> Result<(), ApiError> {
        let path = format!("/api/compliance/my-capture-exclusions/{}", urlencoding::encode(id));
        self.request_json(reqwest::Method::DELETE, &path, None).map(|_| ())
    }

    pub fn fetch_capture_summary(&mut self, time_zone: &str) -> Result<CaptureSummary, ApiError> {
        let path = format!("/api/activity/my-capture-summary?tz={}", urlencoding::encode(time_zone));
        let body = self.get_json(&path)?;
        Ok(body
            .get("data")
            .and_then(|d| serde_json::from_value(d.clone()).ok())
            .unwrap_or_default())
    }
}

#[cfg(test)]
mod own_exclusion_tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::test_support::{fake_jwt, fake_server};

    /// A client against a server that records "METHOD path" for every request and
    /// answers each with the given status and body.
    fn client_answering(status: u16, body: &str) -> (ApiClient, Arc<Mutex<Vec<String>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&seen);
        let body = body.to_string();
        let url = fake_server(move |req| {
            log.lock().unwrap().push(format!("{} {}", req.method(), req.url()));
            (status, body.clone())
        });
        let mut api = ApiClient::new(url, "http://127.0.0.1:1".into()).expect("client builds");
        api.set_tokens(&fake_jwt(3600), "refresh");
        (api, seen)
    }

    #[test]
    fn listing_reads_the_members_own_rules() {
        let (mut api, seen) = client_answering(
            200,
            r#"{"success":true,"data":[{"id":"e1","matchType":"domain","pattern":"mybank.com"}]}"#,
        );
        let rows = api.list_own_exclusions().expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].pattern, "mybank.com");
        assert_eq!(seen.lock().unwrap()[0], "GET /api/compliance/my-capture-exclusions");
    }

    #[test]
    fn adding_posts_to_the_members_own_route_not_the_org_wide_one() {
        let (mut api, seen) = client_answering(
            200,
            r#"{"success":true,"data":{"id":"e1","matchType":"app","pattern":"keepass"}}"#,
        );
        let row = api.add_own_exclusion("app", "KeePass").expect("add");
        assert_eq!(row.id, "e1");
        assert_eq!(seen.lock().unwrap()[0], "POST /api/compliance/my-capture-exclusions");
    }

    #[test]
    fn a_refusal_carries_the_servers_own_words_to_the_member() {
        let (mut api, _) = client_answering(409, r#"{"success":false,"error":"You can exclude up to 100 items."}"#);
        match api.add_own_exclusion("app", "one-more") {
            Err(ApiError::Rejected(message)) => assert_eq!(message, "You can exclude up to 100 items."),
            other => panic!("expected the server's message, got {:?}", other.map(|r| r.id)),
        }
    }

    #[test]
    fn adding_something_already_listed_says_so_instead_of_failing_obscurely() {
        // The server answers a duplicate with a null row rather than an error.
        let (mut api, _) = client_answering(200, r#"{"success":true,"data":null}"#);
        match api.add_own_exclusion("domain", "mybank.com") {
            Err(ApiError::Rejected(message)) => assert!(message.contains("already")),
            other => panic!("expected an already-listed message, got {:?}", other.map(|r| r.id)),
        }
    }

    #[test]
    fn removing_sends_a_delete_with_the_id_encoded_in_the_path() {
        let (mut api, seen) = client_answering(200, r#"{"success":true,"data":null}"#);
        api.remove_own_exclusion("a/b c").expect("remove");
        assert_eq!(seen.lock().unwrap()[0], "DELETE /api/compliance/my-capture-exclusions/a%2Fb%20c");
    }

    #[test]
    fn a_rule_that_was_not_found_is_an_error_not_a_silent_success() {
        let (mut api, _) = client_answering(404, r#"{"success":false,"error":"That exclusion was not found."}"#);
        assert!(api.remove_own_exclusion("gone").is_err());
    }

    #[test]
    fn the_summary_asks_in_the_members_own_time_zone() {
        let (mut api, seen) = client_answering(
            200,
            r#"{"success":true,"data":{"timezone":"Africa/Cairo","screenshots":4,"appEvents":9,"apps":3,"domains":2,"activeSeconds":3600}}"#,
        );
        let s = api.fetch_capture_summary("Africa/Cairo").expect("summary");
        assert_eq!((s.screenshots, s.apps, s.domains, s.active_seconds), (4, 3, 2, 3600));
        assert_eq!(seen.lock().unwrap()[0], "GET /api/activity/my-capture-summary?tz=Africa%2FCairo");
    }
}
