use std::time::Duration;

use serde_json::Value;

use super::ApiClient;
use crate::constants::HTTP_TIMEOUT_SEC;

impl ApiClient {
    /// MAC-3/CQ-4: `app`-type rows from CLS-1's activity_categories that
    /// carry a display_name - the single server-delivered mapping meant to
    /// replace window.rs's hardcoded overrides() map. Category/domain rows
    /// are backend/dashboard concerns the agent has no use for, so they're
    /// filtered out here rather than parsed and discarded by every caller.
    ///
    /// `Ok(vec![])` on a reachable-but-empty response is a legitimate
    /// result, not an error - it just means nothing has display names set
    /// yet. `Err(())` means the fetch itself failed (network, auth); callers
    /// must leave the existing cache in place rather than clearing it, so a
    /// transient failure doesn't blank out names that were working a moment
    /// ago.
    pub fn fetch_app_display_names(&mut self) -> Result<Vec<(String, String)>, ()> {
        let auth = self.authorized().ok_or(())?;
        let url = format!("{}/api/classification/categories", self.api_url);
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
        let rows = body
            .get("data")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut out = Vec::new();
        for row in rows {
            if row.get("matchType").and_then(|v| v.as_str()) != Some("app") {
                continue;
            }
            let Some(pattern) = row.get("pattern").and_then(|v| v.as_str()) else {
                continue;
            };
            let Some(display_name) = row.get("displayName").and_then(|v| v.as_str()) else {
                continue;
            };
            out.push((pattern.to_lowercase(), display_name.to_string()));
        }
        Ok(out)
    }
}
