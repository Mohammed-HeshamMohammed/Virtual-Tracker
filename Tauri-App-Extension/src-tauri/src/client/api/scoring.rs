use std::time::Duration;

use serde_json::Value;

use super::ApiClient;
use crate::constants::HTTP_TIMEOUT_SEC;

/// ACT-3: every server-tunable agent constant the plan names - scoring calibration,
/// screenshot cadence, and the idle threshold - fetched and applied together since they
pub struct ActivityScoringSettings {
    pub saturation_events: u64,
    pub window_ms: u64,
    pub screenshot_min_delay_sec: u64,
    pub screenshot_max_delay_sec: u64,
    pub idle_threshold_sec: u64,
    pub blur_default: bool,
    pub outside_work_hours: bool,
    pub break_until_ms: i64,
    /// When the server says the work-window answer next changes. None from a backend
    /// that predates it, which falls back to the ordinary poll interval.
    pub recheck_in_sec: Option<u64>,
}

impl ApiClient {
    /// `Err(())` on any failure (network, auth, malformed response) - callers must keep
    /// using whatever's already cached rather than resetting to a hardcoded default, same
    pub fn fetch_activity_scoring_settings(&mut self) -> Result<ActivityScoringSettings, ()> {
        let auth = self.authorized().ok_or(())?;
        let url = format!("{}/api/activity/scoring-settings", self.api_url);
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
        let data = body.get("data").ok_or(())?;
        let field = |name: &str| data.get(name).and_then(|v| v.as_u64()).ok_or(());
        Ok(ActivityScoringSettings {
            saturation_events: field("saturationEvents")?,
            window_ms: field("windowMs")?,
            screenshot_min_delay_sec: field("screenshotMinDelaySec")?,
            screenshot_max_delay_sec: field("screenshotMaxDelaySec")?,
            idle_threshold_sec: field("idleThresholdSec")?,
            // Absent on an older backend, which must read as "no restriction"
            // rather than blocking every capture.
            blur_default: data.get("blurDefault").and_then(|v| v.as_bool()).unwrap_or(false),
            // The explicit flag exists so a running break does not hide the schedule; a
            // backend without it only had the reason, which is right whenever no break runs.
            outside_work_hours: data.get("outsideWorkHours").and_then(|v| v.as_bool()).unwrap_or_else(|| {
                data.get("captureBlockReason").and_then(|v| v.as_str()) == Some("outside_work_hours")
            }),
            break_until_ms: data.get("breakUntilMs").and_then(|v| v.as_i64()).unwrap_or(0),
            recheck_in_sec: data.get("recheckInSec").and_then(|v| v.as_u64()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{fake_jwt, fake_server};

    fn settings_from(extra: &str) -> ActivityScoringSettings {
        let body = format!(
            r#"{{"data":{{"saturationEvents":120,"windowMs":60000,"screenshotMinDelaySec":90,
            "screenshotMaxDelaySec":210,"idleThresholdSec":60{extra}}}}}"#
        );
        let url = fake_server(move |_| (200, body.clone()));
        let mut api = ApiClient::new(url, "http://127.0.0.1:1".into()).expect("client builds");
        api.set_tokens(&fake_jwt(3600), "refresh");
        api.fetch_activity_scoring_settings().expect("settings parse")
    }

    #[test]
    fn an_older_backend_with_none_of_the_capture_fields_reads_as_unrestricted() {
        let s = settings_from("");
        assert!(!s.blur_default);
        assert!(!s.outside_work_hours);
        assert_eq!(s.break_until_ms, 0);
        assert_eq!(s.recheck_in_sec, None);
    }

    #[test]
    fn the_explicit_schedule_flag_is_read_even_while_a_break_runs() {
        // The reason says "break", which alone would hide that the schedule also
        // blocks capture - so the agent would resume capturing the moment the
        // break ended, however long before the next poll that was.
        let s = settings_from(r#","captureBlockReason":"break","outsideWorkHours":true,"breakUntilMs":1700000000000"#);
        assert!(s.outside_work_hours);
        assert_eq!(s.break_until_ms, 1_700_000_000_000);
    }

    #[test]
    fn a_backend_with_only_the_reason_still_reports_the_schedule() {
        let s = settings_from(r#","captureBlockReason":"outside_work_hours""#);
        assert!(s.outside_work_hours);
    }

    #[test]
    fn a_break_reason_alone_is_not_mistaken_for_the_schedule() {
        let s = settings_from(r#","captureBlockReason":"break""#);
        assert!(!s.outside_work_hours);
    }

    #[test]
    fn the_recheck_hint_and_blur_default_are_carried_through() {
        let s = settings_from(r#","blurDefault":true,"recheckInSec":540"#);
        assert!(s.blur_default);
        assert_eq!(s.recheck_in_sec, Some(540));
    }
}
