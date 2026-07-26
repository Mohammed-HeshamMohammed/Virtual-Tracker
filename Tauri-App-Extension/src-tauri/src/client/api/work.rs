use std::time::Duration;

use serde_json::Value;

use super::ApiClient;
use crate::constants::HTTP_TIMEOUT_SEC;

impl ApiClient {
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
        projects.sort_by_key(|p| p.name.to_lowercase());
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
            let project_id = item
                .get("projectId")
                .or_else(|| item.get("project_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            tasks.push(crate::types::AgentTask {
                id,
                title,
                status,
                project_id,
            });
        }
        tasks.sort_by_key(|t| t.title.to_lowercase());
        Ok(tasks)
    }

    /// Per-task time-tracking summary — daily total, task estimate, and any
    /// overtime allowance. Was shown in the web dashboard's timer popup; that
    /// popup is gone, this is now its only home.
    pub fn fetch_task_time_tracking(
        &mut self,
        task_id: &str,
    ) -> Option<crate::types::TaskTimeTracking> {
        if !self.refresh_token_if_needed() {
            return None;
        }
        let auth = self.auth_headers()?;
        let url = format!(
            "{}/api/tasks/{}/time-tracking",
            self.api_url,
            urlencoding::encode(task_id)
        );
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
        let data = body.get("data")?;
        let allowance = data.get("timerAllowance");
        Some(crate::types::TaskTimeTracking {
            active_seconds: data.get("activeSeconds").and_then(|v| v.as_u64()).unwrap_or(0),
            idle_seconds: data.get("idleSeconds").and_then(|v| v.as_u64()).unwrap_or(0),
            task_status: data
                .get("taskStatus")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            estimated_seconds: data.get("estimatedSeconds").and_then(|v| v.as_u64()),
            overtime_seconds: data.get("overtimeSeconds").and_then(|v| v.as_u64()),
            progress_percent: data.get("progressPercent").and_then(|v| v.as_f64()),
            worked_today_seconds: allowance
                .and_then(|a| a.get("workedTodaySeconds"))
                .and_then(|v| v.as_u64()),
            worked_today_on_task_seconds: allowance
                .and_then(|a| a.get("workedTodayOnTaskSeconds"))
                .and_then(|v| v.as_u64()),
            allowed_remaining_seconds: allowance
                .and_then(|a| a.get("allowedRemainingSeconds"))
                .and_then(|v| v.as_i64()),
            limit_reached: allowance
                .and_then(|a| a.get("limitReached"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            allowance_message: allowance
                .and_then(|a| a.get("message"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        })
    }
}
