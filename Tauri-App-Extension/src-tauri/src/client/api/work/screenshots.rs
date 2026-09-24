//! The member's own captures.

use super::*;

impl ApiClient {
    /// The viewer's own recent screenshots (ids + timestamps), optionally narrowed to one
    /// project - image bytes come one at a time from fetch_screenshot_image.
    pub fn fetch_my_screenshots(
        &mut self,
        limit: u32,
        project_id: Option<&str>,
    ) -> Result<Vec<crate::types::ScreenshotRef>, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let mut url = format!("{}/api/activity/my-screenshots?limit={}", self.api_url, limit);
        if let Some(pid) = project_id.filter(|p| !p.is_empty()) {
            url.push_str(&format!("&projectId={}", urlencoding::encode(pid)));
        }
        let res = self
            .client
            .get(url)
            .header("Authorization", auth)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(Vec::new());
        }
        if !res.status().is_success() {
            // Same reasoning as fetch_agent_workspace: keep the real status instead of a
            // bare ApiError::Network, so a 401/500 is distinguishable from "not deployed
            let status = res.status();
            let body: Value = res.json().unwrap_or_else(|_| json!({}));
            let message = body.get("error").and_then(|v| v.as_str()).unwrap_or("request failed");
            return Err(ApiError::Rejected(format!("HTTP {status}: {message}")));
        }
        let body: Value = res.json().map_err(|_| ApiError::Network)?;
        let list = body.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        Ok(list
            .into_iter()
            .filter_map(|v| serde_json::from_value(v).ok())
            .collect())
    }

    /// One screenshot as a `data:` URL.
    pub fn fetch_screenshot_image(&mut self, screenshot_id: &str) -> Result<String, ApiError> {
        let body = self.get_json(&format!("/api/activity/screenshot/{}",
            urlencoding::encode(screenshot_id)))?;
        Ok(body
            .pointer("/data/imageData")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string())
    }
}
