//! Task reads and writes: the assigned list, creating one, and its detail.

use super::*;

impl ApiClient {
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

    /// Creates a task on a task-based project (POST /api/tasks - gated server-side by
    /// viewerCanCreateProjectTasks, the same check ProjectInfo.can_create_tasks already
    pub fn create_task(
        &mut self,
        project_id: &str,
        title: &str,
        estimate_hours: Option<f64>,
        description: Option<&str>,
        // "low" | "medium" | "high" | "urgent" - PRIORITY_CONFIG's own key set
        // (Dashboard-Web task-constants.tsx).
        priority: Option<&str>,
        // "YYYY-MM-DD".
        due_date: Option<&str>,
    ) -> Result<crate::types::CreateTaskResult, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let create_url = format!("{}/api/tasks", self.api_url);
        let mut create_body = json!({
            "project_id": project_id,
            "title": title,
            "status": "todo",
        });
        // EstimateAssignmentSeconds (task-schedule-math.js) is working_days *
        // (duration_hours_per_day + overtime_hours_per_day) * 3600 - with no start/due date
        if let Some(hours) = estimate_hours.filter(|h| *h > 0.0) {
            create_body["working_days"] = json!(1);
            create_body["duration_hours_per_day"] = json!(hours);
        }
        // Same field names task-api.ts's own outgoing payload uses (description, priority,
        // due_date) - matching the web wizard's wire shape rather than inventing a parallel
        if let Some(d) = description.filter(|d| !d.trim().is_empty()) {
            create_body["description"] = json!(d);
        }
        // Defaults to "medium" server-side when omitted (tasks-postgres.
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

    /// Best-effort - see create_task's own doc comment for why a `false` here is an
    /// expected outcome, not treated as this call's error.
    pub(super) fn assign_task_to_self(&mut self, task_id: &str) -> Result<bool, ApiError> {
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

    /// Per-task time-tracking summary — daily total, task estimate, and any overtime
    /// allowance.
    pub fn fetch_task_time_tracking(
        &mut self,
        task_id: &str,
    ) -> Result<crate::types::TaskTimeTracking, ApiError> {
        let body = self.get_json(&format!("/api/tasks/{}/time-tracking",
            urlencoding::encode(task_id)))?;
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

    /// The open task's own detail - description, priority, due date and subtask checklist -
    /// so "what am I actually meant to be doing" is answerable without opening the web app.
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
            // Trimmed to the date - the column is a timestamp and the UI only ever shows
            // the day.
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
}
