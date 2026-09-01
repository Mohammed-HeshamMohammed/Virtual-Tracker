use std::time::Duration;

use serde_json::{json, Value};

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
            let budget_exhausted = budget_map.get(&id).copied().unwrap_or(false);
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
                can_create_tasks,
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

    /// Creates a task on a task-based project (POST /api/tasks - gated
    /// server-side by viewerCanCreateProjectTasks, the same check
    /// ProjectInfo.can_create_tasks already reflects), then best-effort
    /// self-assigns it (POST /api/task-assignments) so it actually shows up
    /// in "Your tasks" (fetch_assigned_tasks is assigned_to-filtered) without
    /// a trip to the web dashboard first. Self-assign is gated separately
    /// (org-wide management role - see CreateTaskResult's own doc comment)
    /// and can fail on its own; that failure doesn't unwind the task, which
    /// already exists and is real - self_assigned just tells the caller
    /// whether to say so.
    pub fn create_task(
        &mut self,
        project_id: &str,
        title: &str,
        estimate_hours: Option<f64>,
    ) -> Result<crate::types::CreateTaskResult, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let create_url = format!("{}/api/tasks", self.api_url);
        let mut create_body = json!({
            "project_id": project_id,
            "title": title,
            "status": "todo",
        });
        // estimateAssignmentSeconds (task-schedule-math.js) is
        // working_days * (duration_hours_per_day + overtime_hours_per_day) *
        // 3600 - with no start/due date range set, working_days=1 makes
        // duration_hours_per_day alone equal to the plain hour estimate the
        // dialog collects, without also needing a date-range picker here.
        if let Some(hours) = estimate_hours.filter(|h| *h > 0.0) {
            create_body["working_days"] = json!(1);
            create_body["duration_hours_per_day"] = json!(hours);
        }
        let res = self
            .client
            .post(create_url)
            .header("Authorization", auth)
            .header("Content-Type", "application/json")
            .json(&create_body)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        let status = res.status();
        let body: Value = res.json().unwrap_or_else(|_| json!({}));
        if !status.is_success() {
            let message = body
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Could not create the task")
                .to_string();
            return Err(ApiError::Rejected(message));
        }
        let data = body.get("data").ok_or(ApiError::Network)?;
        let id = data
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or(ApiError::Network)?
            .to_string();
        let task = crate::types::AgentTask {
            id: id.clone(),
            title: data
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or(title)
                .to_string(),
            status: data
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("todo")
                .to_string(),
            project_id: data
                .get("projectId")
                .or_else(|| data.get("project_id"))
                .and_then(|v| v.as_str())
                .unwrap_or(project_id)
                .to_string(),
        };

        let self_assigned = self.assign_task_to_self(&id).unwrap_or(false);
        Ok(crate::types::CreateTaskResult { task, self_assigned })
    }

    /// Best-effort - see create_task's own doc comment for why a `false`
    /// here is an expected outcome, not treated as this call's error.
    fn assign_task_to_self(&mut self, task_id: &str) -> Result<bool, ApiError> {
        let member_id = self
            .fetch_viewer_member_id()
            .ok_or(ApiError::Unauthorized)?;
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!("{}/api/task-assignments", self.api_url);
        let body = json!({
            "task_id": task_id,
            "member_id": member_id,
            "status": "todo",
        });
        let res = self
            .client
            .post(url)
            .header("Authorization", auth)
            .header("Content-Type", "application/json")
            .json(&body)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        Ok(res.status().is_success())
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
    pub fn fetch_member_limits(
        &mut self,
        project_id: Option<&str>,
    ) -> Result<crate::types::MemberLimits, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = match project_id.filter(|id| !id.trim().is_empty()) {
            Some(id) => format!(
                "{}/api/activity/limits?projectId={}",
                self.api_url,
                urlencoding::encode(id.trim())
            ),
            None => format!("{}/api/activity/limits", self.api_url),
        };
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
            today_activity: {
                let node = data.get("todayActivity");
                let field = |key: &str| -> i64 {
                    node.and_then(|n| n.get(key)).and_then(|v| v.as_i64()).unwrap_or(0)
                };
                crate::types::TodayActivity {
                    active_seconds: field("activeSeconds"),
                    idle_seconds: field("idleSeconds"),
                }
            },
            project_today_activity: data.get("projectTodayActivity").filter(|v| !v.is_null()).map(|node| {
                let field = |key: &str| -> i64 {
                    node.get(key).and_then(|v| v.as_i64()).unwrap_or(0)
                };
                crate::types::TodayActivity {
                    active_seconds: field("activeSeconds"),
                    idle_seconds: field("idleSeconds"),
                }
            }),
        })
    }

    /// Everything the agent shows beyond the timer itself (time off, timesheet,
    /// earnings, and - per role - team status, pending approvals, org pulse),
    /// in one round trip. The whole payload is serde-shaped, so unlike the
    /// hand-parsed fetches above this is a straight deserialize; every section
    /// but `self` is Option and simply arrives null for a viewer the backend
    /// doesn't entitle to it. `Ok(None)` on a 404 (older backend without the
    /// route), same convention as fetch_dashboard_summary.
    pub fn fetch_agent_workspace(&mut self) -> Result<Option<crate::types::AgentWorkspace>, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!("{}/api/activity/workspace", self.api_url);
        let res = self
            .client
            .get(url)
            .header("Authorization", auth)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !res.status().is_success() {
            return Err(ApiError::Network);
        }
        let body: Value = res.json().map_err(|_| ApiError::Network)?;
        let Some(data) = body.get("data").filter(|d| !d.is_null()) else {
            return Ok(None);
        };
        serde_json::from_value(data.clone())
            .map(Some)
            .map_err(|_| ApiError::Network)
    }

    /// Logs time that was never tracked live. Gated to Manager-and-above by
    /// the workspace `canLogManualTime` capability the UI reads - the server
    /// separately enforces that entries for *other* members need a
    /// management role (assertTimeEntryWriteAuthorized).
    ///
    /// start_time/end_time are sent as explicit nulls, not omitted and not
    /// "": they are nullable TIME columns, and Postgres rejects '' for TIME.
    pub fn create_time_entry(
        &mut self,
        member_id: &str,
        project_id: &str,
        task_id: Option<&str>,
        date: &str,
        duration_seconds: i64,
        description: &str,
    ) -> Result<(), ApiError> {
        // Empty member_id means "me". Resolved here rather than plumbed
        // through the UI, which has no reason to know its own member id -
        // nothing else in the agent's frontend carries it.
        let resolved_member = if member_id.trim().is_empty() {
            self.fetch_viewer_member_id()
                .ok_or_else(|| ApiError::Rejected("Could not resolve your member profile".into()))?
        } else {
            member_id.to_string()
        };
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!("{}/api/time-entries", self.api_url);
        let mut body = json!({
            "member_id": resolved_member,
            "project_id": project_id,
            "date": date,
            "duration": duration_seconds,
            "description": description,
            "billable": true,
            "source": "manual",
            "status": "pending",
            "start_time": serde_json::Value::Null,
            "end_time": serde_json::Value::Null,
        });
        if let Some(tid) = task_id.filter(|t| !t.trim().is_empty()) {
            body["task_id"] = json!(tid);
        }
        self.post_expecting_ok(&auth, url, &body, "Could not save the time entry")
    }

    /// The viewer's own recent screenshots (ids + timestamps). Image bytes
    /// come one at a time from fetch_screenshot_image.
    pub fn fetch_my_screenshots(&mut self, limit: u32) -> Result<Vec<crate::types::ScreenshotRef>, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!("{}/api/activity/my-screenshots?limit={}", self.api_url, limit);
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
            return Err(ApiError::Network);
        }
        let body: Value = res.json().map_err(|_| ApiError::Network)?;
        let list = body.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        Ok(list
            .into_iter()
            .filter_map(|v| serde_json::from_value(v).ok())
            .collect())
    }

    /// One screenshot as a `data:` URL. The endpoint already returns it in
    /// that form, so the webview can render the string directly - it cannot
    /// fetch the image itself, having no way to attach the auth header to an
    /// <img src>.
    pub fn fetch_screenshot_image(&mut self, screenshot_id: &str) -> Result<String, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!(
            "{}/api/activity/screenshot/{}",
            self.api_url,
            urlencoding::encode(screenshot_id)
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
        Ok(body
            .pointer("/data/imageData")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string())
    }

    /// Submits the viewer's own timesheet for a period. The server refuses a
    /// period already submitted or approved (409), which surfaces as the
    /// message rather than a generic failure.
    pub fn submit_timesheet(&mut self, period_start: &str, period_end: &str) -> Result<(), ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!("{}/api/timesheets/submit", self.api_url);
        let body = json!({ "periodStart": period_start, "periodEnd": period_end });
        self.post_expecting_ok(&auth, url, &body, "Could not submit the timesheet")
    }

    /// Files a time-off request for the viewer against one of their policies.
    pub fn request_time_off(
        &mut self,
        policy_id: &str,
        start_date: &str,
        end_date: &str,
        note: &str,
    ) -> Result<(), ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!("{}/api/time-off/requests", self.api_url);
        let body = json!({
            "policyId": policy_id,
            "startDate": start_date,
            "endDate": end_date,
            "note": note,
        });
        self.post_expecting_ok(&auth, url, &body, "Could not submit the request")
    }

    /// One POST + "did it work, and if not what did the server say" - the
    /// three write calls above differ only in URL and body, and each needs
    /// the server's own message surfaced rather than a generic failure.
    fn post_expecting_ok(
        &self,
        auth: &str,
        url: String,
        body: &Value,
        fallback: &str,
    ) -> Result<(), ApiError> {
        let res = self
            .client
            .post(url)
            .header("Authorization", auth)
            .header("Content-Type", "application/json")
            .json(body)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        if res.status().is_success() {
            return Ok(());
        }
        let payload: Value = res.json().unwrap_or_else(|_| json!({}));
        Err(ApiError::Rejected(
            payload
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or(fallback)
                .to_string(),
        ))
    }

    /// The open task's own detail - description, priority, due date and
    /// subtask checklist - so "what am I actually meant to be doing" is
    /// answerable without opening the web app. Two calls because subtasks
    /// are a child collection (/api/tasks/:id/subtasks), and a failure on
    /// the child is non-fatal: the task detail is still worth showing
    /// without its checklist.
    pub fn fetch_task_detail(&mut self, task_id: &str) -> Result<crate::types::TaskDetail, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let encoded = urlencoding::encode(task_id).to_string();
        let res = self
            .client
            .get(format!("{}/api/tasks/{}", self.api_url, encoded))
            .header("Authorization", &auth)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        if !res.status().is_success() {
            return Err(ApiError::Network);
        }
        let body: Value = res.json().map_err(|_| ApiError::Network)?;
        let data = body.get("data").ok_or(ApiError::Network)?;
        let text = |key: &str| -> String {
            data.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
        };

        let subtasks = self
            .client
            .get(format!("{}/api/tasks/{}/subtasks", self.api_url, encoded))
            .header("Authorization", &auth)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .ok()
            .filter(|r| r.status().is_success())
            .and_then(|r| r.json::<Value>().ok())
            .and_then(|b| b.get("data").and_then(|v| v.as_array()).cloned())
            .unwrap_or_default()
            .into_iter()
            .map(|row| crate::types::TaskSubtask {
                id: row.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                title: row.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                completed: row.get("completed").and_then(|v| v.as_bool()).unwrap_or(false),
            })
            .collect();

        Ok(crate::types::TaskDetail {
            id: text("id"),
            title: text("title"),
            description: text("description"),
            status: text("status"),
            priority: text("priority"),
            // Trimmed to the date - the column is a timestamp and the UI
            // only ever shows the day.
            due_date: data
                .get("due_date")
                .or_else(|| data.get("dueDate"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .chars()
                .take(10)
                .collect(),
            subtasks,
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

    /// The same payload GET /api/dashboard/general feeds the web dashboard's
    /// own personal/general view with - only the "me" slice, never "all"
    /// (that's the manager cross-team view, out of scope for a per-member
    /// agent). `Ok(None)` on a 404/older backend that doesn't have this
    /// route yet, same convention as fetch_project_budget_status - "nothing
    /// to show" rather than an error banner over an optional widget.
    pub fn fetch_dashboard_summary(&mut self) -> Result<Option<crate::types::DashboardSummary>, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!("{}/api/dashboard/general", self.api_url);
        let res = self
            .client
            .get(url)
            .header("Authorization", auth)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !res.status().is_success() {
            return Err(ApiError::Network);
        }
        let body: Value = res.json().map_err(|_| ApiError::Network)?;
        let Some(me) = body.pointer("/data/me") else {
            return Ok(None);
        };
        let stats = me.get("stats");
        let weekly_activity = me
            .get("weeklyActivity")
            .and_then(|v| v.as_array())
            .map(|days| {
                days.iter()
                    .map(|d| crate::types::WeeklyActivityDay {
                        key: d.get("key").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        label: d.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        active_hours: d.get("activeHours").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        idle_hours: d.get("idleHours").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let recent_projects = me
            .get("recentProjects")
            .and_then(|v| v.as_array())
            .map(|projects| {
                projects
                    .iter()
                    .map(|p| crate::types::RecentProjectSummary {
                        id: p.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        name: p.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        progress: p.get("progress").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        member_count: p.get("memberCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(Some(crate::types::DashboardSummary {
            activity_week_percent: stats
                .and_then(|s| s.get("activityWeekPercent"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
            weekly_activity,
            recent_projects,
        }))
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
