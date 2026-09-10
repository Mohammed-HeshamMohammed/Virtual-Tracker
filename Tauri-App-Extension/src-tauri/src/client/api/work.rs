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
    ///
    /// Value is (limit_reached, spent_percent). spent_percent is computed for
    /// every row with a real target, not only ones with stop_timers_when_reached
    /// on - it used to be thrown away for every project that hadn't opted into
    /// stopping timers, which was every project the sidebar showed 0% progress
    /// for despite real budget spend: the task-completion percentage
    /// (recentProjects) reads 0% until a task is marked done, and nothing else
    /// filled in for a project tracked by budget instead of a task checklist.
    pub fn fetch_project_budgets_map(
        &mut self,
    ) -> Result<std::collections::HashMap<String, (bool, Option<f64>)>, ApiError> {
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
            let spent = item.get("spent").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let target = item.get("target").and_then(|v| v.as_f64()).unwrap_or(0.0);
            // None (not 0.0) when there's no real target to divide by - a
            // project with a budget row but nothing to compare against isn't
            // "0% spent", it's "not measurable", same distinction
            // budget_exhausted already draws elsewhere.
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
    /// self-assigns it so it actually shows up in "Your tasks"
    /// (fetch_assigned_tasks is assigned_to-filtered) without a trip to the
    /// web dashboard first.
    ///
    /// Self-assign goes through POST /api/tasks/:id/assignments, not the
    /// flat POST /api/task-assignments this used to call. The flat one is
    /// gated by requireManagementRole - org-wide Manager tier or above, with
    /// no exception for the task's own creator - so a per-project manager
    /// (project_role = "manager" in project_members, which is exactly who
    /// can_create_tasks already let create this task) whose org-wide role
    /// sits below Manager would create the task and then be silently
    /// refused assigning it to themselves, with no way to tell why from the
    /// agent. The per-task endpoint's canSyncTaskAssignments explicitly
    /// allows the task's own creator in addition to management, which is
    /// exactly who is calling this method.
    ///
    /// This can still fail on its own (e.g. the member is already at their
    /// daily/weekly work-hour limit) - that failure doesn't unwind the task,
    /// which already exists and is real; self_assigned just tells the caller
    /// whether to say so.
    pub fn create_task(
        &mut self,
        project_id: &str,
        title: &str,
        estimate_hours: Option<f64>,
        description: Option<&str>,
        // "low" | "medium" | "high" | "urgent" - PRIORITY_CONFIG's own key
        // set (Dashboard-Web task-constants.tsx). Not validated here; an
        // unrecognized value is the server's to reject, same as every other
        // field in this body.
        priority: Option<&str>,
        // "YYYY-MM-DD". The column is a timestamptz, but the server already
        // date-only-coerces this on write (dateOnly() in tasks-postgres.
        // service.js) - a plain date string matches what the web wizard
        // itself sends.
        due_date: Option<&str>,
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
        // Same field names task-api.ts's own outgoing payload uses
        // (description, priority, due_date) - matching the web wizard's
        // wire shape rather than inventing a parallel one.
        if let Some(d) = description.filter(|d| !d.trim().is_empty()) {
            create_body["description"] = json!(d);
        }
        // Defaults to "medium" server-side when omitted (tasks-postgres.
        // service.js), same as the web wizard's own default - sent
        // explicitly anyway so a blank picker and an active "Medium"
        // selection produce an identical task either way.
        create_body["priority"] = json!(priority.filter(|p| !p.trim().is_empty()).unwrap_or("medium"));
        if let Some(d) = due_date.filter(|d| !d.trim().is_empty()) {
            create_body["due_date"] = json!(d);
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
    ///
    /// assigneeIds carries only the caller's own id and removeUnlisted is
    /// left false (the server default): on a brand-new task there are no
    /// other assignees yet, so this only ever adds, never removes.
    fn assign_task_to_self(&mut self, task_id: &str) -> Result<bool, ApiError> {
        let member_id = self
            .fetch_viewer_member_id()
            .ok_or(ApiError::Unauthorized)?;
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let url = format!(
            "{}/api/tasks/{}/assignments",
            self.api_url,
            urlencoding::encode(task_id)
        );
        let body = json!({ "assigneeIds": [member_id] });
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
            assigned_total: parse_assigned_total(data.get("assignedTotal")),
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
            // Was collapsed to a bare ApiError::Network, indistinguishable
            // from a real connection failure - which made a 401 (stale
            // token) or a 500 (real server error) impossible to tell apart
            // from "route not deployed yet" in the log. The status code is
            // the one piece of information worth keeping here.
            let status = res.status();
            let body: Value = res.json().unwrap_or_else(|_| json!({}));
            let message = body.get("error").and_then(|v| v.as_str()).unwrap_or("request failed");
            return Err(ApiError::Rejected(format!("HTTP {status}: {message}")));
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

    /// The viewer's own recent screenshots (ids + timestamps), optionally
    /// narrowed to one project - image bytes come one at a time from
    /// fetch_screenshot_image.
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
            // Same reasoning as fetch_agent_workspace: keep the real status
            // instead of a bare ApiError::Network, so a 401/500 is
            // distinguishable from "not deployed yet" in the log.
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

    /// Top apps by tracked time on one project this week - the task-less
    /// counterpart to a task's progress bar. `Ok(Vec::new())` on a 404 (older
    /// backend without the route), same convention as fetch_project_budget_status.
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
        // An older server returns a bare array here; read that as the app list
        // with no totals rather than failing the whole panel.
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
            // /api/members/current returns the member row as-is, so the column
            // name is snake_case; accept the camelCase spelling too rather
            // than depending on which shim the response came through.
            timezone: {
                let snake = str_field("timezone");
                if snake.is_empty() { str_field("timeZone") } else { snake }
            },
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

/// Parses the `assignedTotal` block on GET /api/activity/limits. Absent on
/// older backends, which zeroes every field - the UI reads a zero total as
/// "nothing assigned" and hides the badge, same as an empty plate.
fn parse_assigned_total(node: Option<&Value>) -> crate::types::AssignedTotal {
    let i64_field = |key: &str| -> i64 {
        node.and_then(|n| n.get(key)).and_then(|v| v.as_i64()).unwrap_or(0)
    };
    crate::types::AssignedTotal {
        assigned_seconds: i64_field("assignedSeconds"),
        worked_seconds: i64_field("workedSeconds"),
        remaining_seconds: i64_field("remainingSeconds"),
        task_count: i64_field("taskCount"),
        project_count: i64_field("projectCount"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{fake_jwt, fake_server};

    fn authed_client(api_url: String) -> ApiClient {
        let mut api = ApiClient::new(api_url, "http://127.0.0.1:1".into())
            .expect("HTTP client builds in a test environment");
        api.set_tokens(&fake_jwt(3600), "refresh-token");
        api
    }

    // Regression for the bug this endpoint switch fixed: a per-project
    // manager (project_role = "manager" - the same check that lets
    // can_create_tasks show the "+ New task" button at all) whose org-wide
    // role sat below Manager tier could create a task and then be silently
    // refused assigning it to themselves, because the old call
    // (POST /api/task-assignments) is gated by an org-wide-management-only
    // check with no exception for the task's own creator. This asserts the
    // call now reaches the per-task endpoint, whose canSyncTaskAssignments
    // explicitly allows the creator - which is always who calls this.
    #[test]
    fn assign_task_to_self_posts_to_the_per_task_assignments_endpoint_not_the_flat_one() {
        let url = fake_server(|request| {
            let path = request.url().to_string();
            if path == "/api/activity/scope" {
                return (200, r#"{"data": {"viewerMemberId": "m1"}}"#.to_string());
            }
            // The bug this test guards against: a regression back to the
            // flat endpoint would hit this path instead and fail here.
            assert_ne!(
                path, "/api/task-assignments",
                "must not use the flat endpoint - it has no creator exception",
            );
            assert_eq!(
                path, "/api/tasks/t1/assignments",
                "must hit the per-task endpoint for task t1, whose canSyncTaskAssignments \
                 allows the task's own creator",
            );
            assert_eq!(request.method(), &tiny_http::Method::Post);
            (200, r#"{"success": true, "data": []}"#.to_string())
        });
        let mut api = authed_client(url);
        assert_eq!(api.assign_task_to_self("t1"), Ok(true));
    }

    #[test]
    fn assign_task_to_self_reports_false_rather_than_erroring_on_a_business_rejection() {
        // e.g. the creator is already at their own daily/weekly work-hour
        // limit - create_task's own doc comment covers why this must not
        // unwind the already-created task.
        let url = fake_server(|request| {
            if request.url() == "/api/activity/scope" {
                return (200, r#"{"data": {"viewerMemberId": "m1"}}"#.to_string());
            }
            (400, r#"{"success": false, "error": "You have reached your daily limit."}"#.to_string())
        });
        let mut api = authed_client(url);
        assert_eq!(api.assign_task_to_self("t1"), Ok(false));
    }
}

#[cfg(test)]
mod diagnostic_error_tests {
    use super::*;
    use crate::test_support::{fake_jwt, fake_server};

    fn authed_client(api_url: String) -> ApiClient {
        let mut api = ApiClient::new(api_url, "http://127.0.0.1:1".into())
            .expect("HTTP client builds in a test environment");
        api.set_tokens(&fake_jwt(3600), "refresh-token");
        api
    }

    // Regression for a real diagnostic dead end: both fetches used to
    // collapse every non-404 failure into a bare ApiError::Network, making a
    // 401 (stale/invalid token) indistinguishable from an actual dropped
    // connection - and, since get_agent_workspace/get_my_screenshots then
    // discarded the error entirely (.ok().flatten() / .unwrap_or_default()),
    // indistinguishable from "nothing to show" too. Nothing in agent.log
    // could tell "the backend refused this" apart from "the request never
    // reached it" or "there was simply no data".
    #[test]
    fn workspace_401_is_a_rejected_error_naming_its_status_not_a_bare_network_error() {
        let url = fake_server(|_request| (401, r#"{"error": "Invalid token"}"#.to_string()));
        let mut api = authed_client(url);
        let err = api.fetch_agent_workspace().unwrap_err();
        match err {
            ApiError::Rejected(msg) => {
                assert!(msg.contains("401"), "expected the status code in the message, got: {msg}");
                assert!(msg.contains("Invalid token"), "expected the server's own message, got: {msg}");
            }
            other => panic!("expected ApiError::Rejected, got {other:?}"),
        }
    }

    #[test]
    fn screenshots_500_is_a_rejected_error_naming_its_status() {
        let url = fake_server(|_request| (500, r#"{"error": "Internal error"}"#.to_string()));
        let mut api = authed_client(url);
        let err = api.fetch_my_screenshots(12, None).unwrap_err();
        match err {
            ApiError::Rejected(msg) => assert!(msg.contains("500"), "expected the status code, got: {msg}"),
            other => panic!("expected ApiError::Rejected, got {other:?}"),
        }
    }

    // Unchanged behavior, pinned so the branch above can't accidentally
    // swallow the still-important "older backend" case into Rejected too.
    #[test]
    fn workspace_404_is_still_ok_none_not_an_error() {
        let url = fake_server(|_request| (404, "not found".to_string()));
        let mut api = authed_client(url);
        // matches!, not assert_eq! - Ok(None) doesn't need AgentWorkspace to
        // implement PartialEq, and adding that derive just for a test that
        // never actually compares one isn't worth it.
        assert!(matches!(api.fetch_agent_workspace(), Ok(None)));
    }

    #[test]
    fn fetch_my_screenshots_only_appends_project_id_when_one_is_given() {
        use std::sync::{Arc, Mutex};
        let seen_urls: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&seen_urls);
        let url = fake_server(move |request| {
            seen.lock().unwrap().push(request.url().to_string());
            (200, r#"{"data": []}"#.to_string())
        });
        let mut api = authed_client(url);

        api.fetch_my_screenshots(6, None).expect("ok");
        api.fetch_my_screenshots(6, Some("proj-1")).expect("ok");

        let urls = seen_urls.lock().unwrap();
        assert!(!urls[0].contains("projectId"), "no filter requested: {}", urls[0]);
        assert!(urls[1].contains("projectId=proj-1"), "filter requested: {}", urls[1]);
    }

    #[test]
    fn project_app_breakdown_404_is_ok_empty_not_an_error() {
        let url = fake_server(|_request| (404, "not found".to_string()));
        let mut api = authed_client(url);
        let breakdown = api.fetch_project_app_breakdown("proj-1").expect("ok");
        assert!(breakdown.apps.is_empty());
        assert_eq!(breakdown.total_seconds, 0);
    }

    #[test]
    fn project_app_breakdown_parses_apps_and_the_totals_they_came_from() {
        let url = fake_server(|_request| {
            (
                200,
                r#"{"data": {"apps": [{"appName": "Zoom", "totalSeconds": 1800}],
                             "totalSeconds": 5400, "appCount": 9, "shownSeconds": 1800}}"#
                    .to_string(),
            )
        });
        let mut api = authed_client(url);
        let breakdown = api.fetch_project_app_breakdown("proj-1").expect("ok");
        assert_eq!(breakdown.apps.len(), 1);
        assert_eq!(breakdown.apps[0].app_name, "Zoom");
        assert_eq!(breakdown.apps[0].total_seconds, 1800);
        // The panel needs these to say it is showing a few of many.
        assert_eq!(breakdown.total_seconds, 5400);
        assert_eq!(breakdown.app_count, 9);
    }

    // A server on the previous release still returns a bare array here. Read
    // it as the app list rather than failing the whole panel.
    #[test]
    fn project_app_breakdown_accepts_an_older_servers_bare_array() {
        let url = fake_server(|_request| {
            (200, r#"{"data": [{"appName": "Zoom", "totalSeconds": 1800}]}"#.to_string())
        });
        let mut api = authed_client(url);
        let breakdown = api.fetch_project_app_breakdown("proj-1").expect("ok");
        assert_eq!(breakdown.apps.len(), 1);
        assert_eq!(breakdown.apps[0].app_name, "Zoom");
        assert_eq!(breakdown.total_seconds, 1800);
        assert_eq!(breakdown.app_count, 1);
    }
}

#[cfg(test)]
mod project_budget_percent_tests {
    use super::*;
    use crate::test_support::{fake_jwt, fake_server};

    fn authed_client(api_url: String) -> ApiClient {
        let mut api = ApiClient::new(api_url, "http://127.0.0.1:1".into())
            .expect("HTTP client builds in a test environment");
        api.set_tokens(&fake_jwt(3600), "refresh-token");
        api
    }

    // The actual bug: a project's real spend/target was only ever kept for
    // projects with stop_timers_when_reached on - every other budgeted
    // project's spend was computed by the server, sent over the wire, and
    // then discarded here into a bare `false`. The sidebar's other progress
    // source (task-completion percent) reads 0% until a task is marked
    // done, so a project tracked by budget instead of a checklist showed a
    // flat, misleading 0% no matter how much had actually been spent.
    #[test]
    fn spent_percent_is_kept_even_when_stop_timers_when_reached_is_off() {
        let url = fake_server(|_request| {
            (
                200,
                r#"{"data": [{
                    "project_id": "p1",
                    "spent": 30,
                    "target": 100,
                    "stop_timers_when_reached": false
                }]}"#
                    .to_string(),
            )
        });
        let mut api = authed_client(url);
        let map = api.fetch_project_budgets_map().expect("ok");
        let (exhausted, spent_percent) = map.get("p1").copied().expect("p1 present");
        assert_eq!(exhausted, false, "never exhausted when the project opted out of stopping timers");
        assert_eq!(spent_percent, Some(30.0), "30/100 spent, not thrown away");
    }

    #[test]
    fn spent_percent_is_none_not_zero_when_there_is_no_real_target() {
        let url = fake_server(|_request| {
            (200, r#"{"data": [{"project_id": "p1", "spent": 0, "target": 0}]}"#.to_string())
        });
        let mut api = authed_client(url);
        let map = api.fetch_project_budgets_map().expect("ok");
        let (_, spent_percent) = map.get("p1").copied().expect("p1 present");
        assert_eq!(spent_percent, None, "nothing to divide by is not the same as 0% spent");
    }

    #[test]
    fn exhausted_still_requires_stop_timers_when_reached_and_crossing_the_threshold() {
        let url = fake_server(|_request| {
            (
                200,
                r#"{"data": [{
                    "project_id": "p1",
                    "spent": 95,
                    "target": 100,
                    "stop_timers_when_reached": true,
                    "stop_timers_at_pct": 90
                }]}"#
                    .to_string(),
            )
        });
        let mut api = authed_client(url);
        let map = api.fetch_project_budgets_map().expect("ok");
        let (exhausted, spent_percent) = map.get("p1").copied().expect("p1 present");
        assert_eq!(exhausted, true, "95% >= the 90% stop threshold");
        assert_eq!(spent_percent, Some(95.0));
    }
}
