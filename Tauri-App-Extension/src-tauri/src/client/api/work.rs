use std::time::Duration;

use serde_json::Value;

use super::{ApiClient, ApiError};
use crate::constants::HTTP_TIMEOUT_SEC;

impl ApiClient {
    pub fn fetch_viewer_member_id(&mut self) -> Option<String> {
        let auth = self.authorized()?;
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

    /// Fails loudly (`Err`) rather than silently returning an empty map on
    /// network/parse failure - an empty map reads downstream as "no project
    /// has a budget limit," which would fail-open a budget gate on a
    /// transient blip instead of surfacing the problem.
    pub fn fetch_project_budgets_map(&mut self) -> Result<std::collections::HashMap<String, bool>, ApiError> {
        let mut map = std::collections::HashMap::new();
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!("{}/api/project-budgets", self.api_url);
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
        let list = body
            .get("data")
            .and_then(|v| v.as_array())
            .ok_or(ApiError::Network)?;

        for item in list {
            let pid = match item.get("project_id").and_then(|v| v.as_str()) {
                Some(id) if !id.is_empty() => id.to_string(),
                _ => continue,
            };
            let stop_when_reached = item
                .get("stop_timers_when_reached")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if !stop_when_reached {
                map.insert(pid, false);
                continue;
            }
            let stop_pct = match item.get("stop_timers_at_pct") {
                Some(v) if v.is_number() => v.as_f64().unwrap_or(100.0),
                Some(v) if v.is_string() => v.as_str().unwrap_or("100").parse::<f64>().unwrap_or(100.0),
                _ => 100.0,
            };
            let spent = item.get("spent").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let target = item.get("target").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let usage_pct = if target > 0.0 { (spent / target) * 100.0 } else { 0.0 };

            let limit_reached = stop_when_reached && (usage_pct >= stop_pct);
            map.insert(pid, limit_reached);
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
            if let Some(limit_reached) = budget_map.get(&id) {
                if *limit_reached {
                    continue;
                }
            }
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
            projects.push(crate::types::ProjectInfo {
                id,
                name,
                project_type,
            });
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
    ) -> Result<crate::types::TaskTimeTracking, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
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
            .map_err(|_| ApiError::Network)?;
        if !res.status().is_success() {
            return Err(ApiError::Network);
        }
        let body: Value = res.json().map_err(|_| ApiError::Network)?;
        let data = body.get("data").ok_or(ApiError::Network)?;
        let allowance = data.get("timerAllowance");
        Ok(crate::types::TaskTimeTracking {
            active_seconds: data.get("activeSeconds").and_then(|v| v.as_u64()).unwrap_or(0),
            idle_seconds: data.get("idleSeconds").and_then(|v| v.as_u64()).unwrap_or(0),
            task_status: data
                .get("taskStatus")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            estimated_seconds: data.get("estimatedSeconds").and_then(|v| v.as_u64()),
            overtime_seconds: data.get("overtimeSeconds").and_then(|v| v.as_u64()),
            working_days: data.get("workingDays").and_then(|v| v.as_u64()),
            hours_per_day: data.get("hoursPerDay").and_then(|v| v.as_f64()),
            overtime_hours_per_day: data.get("overtimeHoursPerDay").and_then(|v| v.as_f64()),
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
            disable_idle_time: data.get("disableIdleTime").and_then(|v| v.as_bool()).unwrap_or(false),
            idle_time_seconds: data.get("idleTimeSeconds").and_then(|v| v.as_u64()).unwrap_or(450),
            shared_budget: data.get("sharedBudget").and_then(|v| v.as_bool()).unwrap_or(false),
        })
    }

    /// A project's Hours-based budget remaining, resolved server-side for the
    /// current viewer (per-person vs shared scope). `Ok(None)` means no
    /// Hours-based budget is configured on this project at all - not an
    /// error, just nothing to show.
    pub fn fetch_project_budget_status(
        &mut self,
        project_id: &str,
    ) -> Result<Option<crate::types::ProjectBudgetStatus>, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!(
            "{}/api/projects/{}/budget-status",
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
        if !res.status().is_success() {
            return Err(ApiError::Network);
        }
        let body: Value = res.json().map_err(|_| ApiError::Network)?;
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

    /// The viewer's own daily/weekly work-hour limits, for the profile view.
    pub fn fetch_member_limits(&mut self) -> Result<crate::types::MemberLimits, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!("{}/api/activity/limits", self.api_url);
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
        let data = body.get("data").ok_or(ApiError::Network)?;
        // timerAllowance is what actually gates the start button server-side.
        // Absent on older backends - every field below then keeps its zero
        // value and the UI shows the plain caps, no allowance line.
        let allowance = data.get("timerAllowance");
        let allowance_num = |key: &str| -> i64 {
            allowance
                .and_then(|a| a.get(key))
                .and_then(|v| v.as_i64())
                .unwrap_or(0)
        };
        Ok(crate::types::MemberLimits {
            daily_hours: data.get("dailyHours").and_then(|v| v.as_f64()).unwrap_or(0.0),
            weekly_hours: data.get("weeklyHours").and_then(|v| v.as_f64()).unwrap_or(0.0),
            uses_shifts: data.get("usesShifts").and_then(|v| v.as_bool()).unwrap_or(false),
            worked_today_seconds: allowance_num("workedTodaySeconds"),
            worked_week_seconds: allowance_num("workedWeekSeconds"),
            // Explicit null means "no cap", which is not the same as 0 left -
            // only a real number becomes Some(..).
            allowed_remaining_seconds: allowance
                .and_then(|a| a.get("allowedRemainingSeconds"))
                .and_then(|v| v.as_i64()),
            limit_reached: allowance
                .and_then(|a| a.get("limitReached"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            assigned_today: parse_assigned_today(data.get("assignedToday")),
            working_today: data.get("workingToday").and_then(|v| v.as_bool()).unwrap_or(true),
            is_makeup_day: data.get("isMakeupDay").and_then(|v| v.as_bool()).unwrap_or(false),
        })
    }

    /// The viewer's own People-page member record, for the profile view.
    pub fn fetch_member_profile(&mut self) -> Result<crate::types::MemberProfile, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!("{}/api/members/current", self.api_url);
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
        let data = body.get("data").ok_or(ApiError::Network)?;
        let str_field = |key: &str| {
            data.get(key)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        Ok(crate::types::MemberProfile {
            name: str_field("name"),
            email: str_field("email"),
            avatar_url: str_field("avatarUrl"),
            // role_name (from role enrichment) is the human label; role can be
            // a raw id/slug when enrichment didn't attach a name.
            role: {
                let named = str_field("role_name");
                if named.is_empty() { str_field("role") } else { named }
            },
            status: str_field("status"),
            date_added: str_field("dateAdded"),
            phone: str_field("phone"),
            teams: data.get("teams").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        })
    }
}

/// Parses the `assignedToday` block on GET /api/activity/limits (T5,
/// PLAN-livesyncandagenttimer.md §11). Absent on older backends - every
/// field then keeps its zero default via #[derive(Default)], same fallback
/// timerAllowance already relies on above.
fn parse_assigned_today(node: Option<&Value>) -> crate::types::AssignedToday {
    let i64_field = |key: &str| -> i64 {
        node.and_then(|n| n.get(key)).and_then(|v| v.as_i64()).unwrap_or(0)
    };
    let by_project_type = node.and_then(|n| n.get("byProjectType"));
    crate::types::AssignedToday {
        demand_seconds: i64_field("demandSeconds"),
        planned_seconds: i64_field("plannedSeconds"),
        deferred_seconds: i64_field("deferredSeconds"),
        rollover_seconds: i64_field("rolloverSeconds"),
        task_count: i64_field("taskCount"),
        by_project_type: crate::types::AssignedTodayByProjectType {
            normal: by_project_type
                .and_then(|b| b.get("normal"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0),
            calling: by_project_type
                .and_then(|b| b.get("calling"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0),
        },
    }
}
