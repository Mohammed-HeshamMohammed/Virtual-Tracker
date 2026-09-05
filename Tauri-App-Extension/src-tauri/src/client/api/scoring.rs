use std::time::Duration;

use serde_json::Value;

use super::ApiClient;
use crate::constants::HTTP_TIMEOUT_SEC;

/// ACT-3: every server-tunable agent constant the plan names - scoring
/// calibration, screenshot cadence, and the idle threshold - fetched and
/// applied together since they share one poll cycle and one backend row.
pub struct ActivityScoringSettings {
    pub saturation_events: u64,
    pub window_ms: u64,
    pub screenshot_min_delay_sec: u64,
    pub screenshot_max_delay_sec: u64,
    pub idle_threshold_sec: u64,
}

impl ApiClient {
    /// `Err(())` on any failure (network, auth, malformed response) - callers
    /// must keep using whatever's already cached rather than resetting to a
    /// hardcoded default, same contract as fetch_app_display_names.
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
        })
    }
}
