//! Projects the member can see, and their budgets and app breakdowns.

use super::*;

impl ApiClient {
    /// Fails loudly (`Err`) rather than silently returning an empty map on network/parse
    /// failure - an empty map reads downstream as "no project has a budget limit," which
    pub fn fetch_project_budgets_map(
        &mut self,
    ) -> Result<std::collections::HashMap<String, (bool, Option<f64>)>, ApiError> {
        let mut map = std::collections::HashMap::new();
        let body = self.get_json("/api/project-budgets")?;
        let list = body
            .get("data")
            .and_then(|v| v.as_array())
            .ok_or(ApiError::Network)?;

        for item in list {
            let pid = match item.get("project_id").and_then(|v| v.as_str()) {
                Some(id) if !id.is_empty() => id.to_string(),
                _ => continue,
            };
            let spent = item.get("spent").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let target = item.get("target").and_then(|v| v.as_f64()).unwrap_or(0.0);
            // None (not 0.0) when there's no real target to divide by - a project with a
            // budget row but nothing to compare against isn't "0% spent", it's "not
            let spent_percent = if target > 0.0 { Some((spent / target) * 100.0) } else { None };

            let stop_when_reached = item
                .get("stop_timers_when_reached")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let limit_reached = if stop_when_reached {
                let stop_pct = match item.get("stop_timers_at_pct") {
                    Some(v) if v.is_number() => v.as_f64().unwrap_or(100.0),
                    Some(v) if v.is_string() => v.as_str().unwrap_or("100").parse::<f64>().unwrap_or(100.0),
                    _ => 100.0,
                };
                spent_percent.is_some_and(|p| p >= stop_pct)
            } else {
                false
            };

            map.insert(pid, (limit_reached, spent_percent));
        }

        Ok(map)
    }

    pub fn fetch_viewer_projects(&mut self) -> Result<Vec<crate::types::ProjectInfo>, String> {
        let auth = self
            .authorized()
            .ok_or_else(|| "Not signed in".to_string())?;
        let url = format!("{}/api/projects", self.api_url);
        let res = self
            .client
            .get(url)
            .header("Authorization", &auth)
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

        let budget_map = self
            .fetch_project_budgets_map()
            .map_err(|e| format!("Failed to load project budgets: {e}"))?;

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
            let (budget_exhausted, budget_spent_percent) =
                budget_map.get(&id).copied().unwrap_or((false, None));
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Untitled project")
                .to_string();
            let project_type = item
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("normal")
                .to_string();
            let require_task_to_track = item
                .get("requireTaskToTrack")
                .or_else(|| item.get("require_task_to_track"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let require_stop_note = item
                .get("requireStopNote")
                .or_else(|| item.get("require_stop_note"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let has_tasks = item
                .get("hasTasks")
                .or_else(|| item.get("has_tasks"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let can_create_tasks = item
                .get("canCreateTasks")
                .or_else(|| item.get("can_create_tasks"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            projects.push(crate::types::ProjectInfo {
                id,
                name,
                project_type,
                has_tasks,
                require_task_to_track,
                require_stop_note,
                budget_exhausted,
                budget_spent_percent,
                can_create_tasks,
            });
        }
        projects.sort_by_key(|p| p.name.to_lowercase());
        Ok(projects)
    }

    /// A project's Hours-based budget remaining, resolved server-side for the current
    /// viewer (per-person vs shared scope).
    pub fn fetch_project_budget_status(
        &mut self,
        project_id: &str,
    ) -> Result<Option<crate::types::ProjectBudgetStatus>, ApiError> {
        let body = self.get_json(&format!("/api/projects/{}/budget-status",
            urlencoding::encode(project_id)))?;
        let data = body.get("data");
        let Some(data) = data.filter(|d| !d.is_null()) else {
            return Ok(None);
        };
        Ok(Some(crate::types::ProjectBudgetStatus {
            scope: data.get("scope").and_then(|v| v.as_str()).unwrap_or("shared").to_string(),
            cap_seconds: data.get("capSeconds").and_then(|v| v.as_u64()).unwrap_or(0),
            spent_seconds: data.get("spentSeconds").and_then(|v| v.as_u64()).unwrap_or(0),
            remaining_seconds: data.get("remainingSeconds").and_then(|v| v.as_u64()).unwrap_or(0),
        }))
    }

    /// Top apps by tracked time on one project this week - the task-less counterpart to a
    /// task's progress bar.
    pub fn fetch_project_app_breakdown(
        &mut self,
        project_id: &str,
    ) -> Result<crate::types::ProjectAppBreakdown, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!(
            "{}/api/activity/project-app-breakdown?projectId={}",
            self.api_url,
            urlencoding::encode(project_id)
        );
        let res = self
            .client
            .get(url)
            .header("Authorization", auth)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(crate::types::ProjectAppBreakdown::default());
        }
        if !res.status().is_success() {
            let status = res.status();
            let body: Value = res.json().unwrap_or_else(|_| json!({}));
            let message = body.get("error").and_then(|v| v.as_str()).unwrap_or("request failed");
            return Err(ApiError::Rejected(format!("HTTP {status}: {message}")));
        }
        let body: Value = res.json().map_err(|_| ApiError::Network)?;
        let data = body.get("data").cloned().unwrap_or_else(|| json!({}));
        // An older server returns a bare array here; read that as the app list with no
        // totals rather than failing the whole panel.
        if let Some(list) = data.as_array() {
            let apps: Vec<crate::types::ProjectAppTime> =
                list.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect();
            let shown = apps.iter().map(|a| a.total_seconds).sum();
            return Ok(crate::types::ProjectAppBreakdown {
                app_count: apps.len() as u32,
                shown_seconds: shown,
                total_seconds: shown,
                apps,
            });
        }
        Ok(serde_json::from_value(data).unwrap_or_default())
    }
}
