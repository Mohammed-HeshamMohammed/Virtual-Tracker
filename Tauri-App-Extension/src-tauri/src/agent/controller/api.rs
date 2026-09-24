//! Thin passthroughs to ApiClient. Each takes the shared client lock, makes one
//! call and maps the error to a String for the command layer.

use super::*;

impl AgentController {
    pub fn report_agent_open(&self) -> Result<(), String> {
        let platform = match std::env::consts::OS {
            "windows" => "windows",
            "macos" => "macos",
            "linux" => "linux",
            other => return Err(format!("Unsupported tracker platform: {other}")),
        };
        let readiness = crate::update_readiness::probe();
        self.api
            .lock()
            .report_agent_open(
                crate::constants::APP_VERSION,
                platform,
                !readiness.writable,
                &readiness.install_dir,
            )
            .map_err(|error| error.to_string())
    }

    /// Stops capture immediately, then records it. The local gate is set
    /// first so a failed request cannot leave the member still captured
    /// after they asked not to be.
    pub fn set_private_break(&self, minutes: Option<u32>, reason: &str) -> Result<i64, String> {
        let until = self
            .api
            .lock()
            .set_private_break(minutes, reason)
            .map_err(|error| error.to_string());
        // Nothing is capturing without a running tracker, and a fresh one
        // picks the break up from the server on its first settings poll.
        if let Some(tracker) = self.tracker.lock().as_ref() {
            tracker.gate().set_break(match (minutes, &until) {
                (None, _) => 0,
                (Some(_), Ok(ms)) => *ms,
                // The request failed, but the member still asked to stop.
                (Some(m), Err(_)) => crate::capture::capture_gate::now_plus_minutes_ms(m),
            });
        }
        until
    }

    pub fn capture_status(&self) -> crate::types::CaptureStatus {
        let guard = self.tracker.lock();
        let Some(gate) = guard.as_ref().map(|t| t.gate()) else {
            return crate::types::CaptureStatus::default();
        };
        let state = gate.state();
        crate::types::CaptureStatus {
            blocked: state != crate::capture::capture_gate::CaptureBlock::Allowed,
            reason: state.message().unwrap_or_default().to_string(),
            break_until_ms: gate.break_until_ms(),
        }
    }

    pub fn get_agent_notifications(&self) -> Result<crate::types::AgentNotificationList, String> {
        self.api.lock().fetch_agent_notifications().map_err(|error| error.to_string())
    }

    pub fn mark_agent_notification_read(&self, notification_id: &str) -> Result<(), String> {
        self.api
            .lock()
            .mark_agent_notification_read(notification_id)
            .map_err(|error| error.to_string())
    }

    pub fn reply_to_message_thread(&self, thread_id: &str, body: &str) -> Result<(), String> {
        self.api
            .lock()
            .reply_to_message_thread(thread_id, body)
            .map_err(|error| error.to_string())
    }

    pub fn mark_all_agent_notifications_read(&self) -> Result<(), String> {
        self.api
            .lock()
            .mark_all_agent_notifications_read()
            .map_err(|error| error.to_string())
    }

    pub fn list_projects(&self) -> Result<Vec<crate::types::ProjectInfo>, String> {
        self.api.lock().fetch_viewer_projects()
    }

    pub fn list_tasks(&self, project_id: Option<&str>) -> Result<Vec<AgentTask>, String> {
        self.api.lock().fetch_assigned_tasks(project_id)
    }

    /// Project_id must be a task-based project the viewer can manage (see
    /// ProjectInfo.can_create_tasks) - the server re-checks this regardless of what the UI
    pub fn create_task(
        &self,
        project_id: &str,
        title: &str,
        estimate_hours: Option<f64>,
        description: Option<&str>,
        priority: Option<&str>,
        due_date: Option<&str>,
    ) -> Result<crate::types::CreateTaskResult, String> {
        self.api
            .lock()
            .create_task(project_id, title, estimate_hours, description, priority, due_date)
            .map_err(|e| e.to_string())
    }

    pub fn get_task_time_tracking(&self, task_id: &str) -> Option<crate::types::TaskTimeTracking> {
        if task_id.trim().is_empty() {
            return None;
        }
        self.api.lock().fetch_task_time_tracking(task_id.trim()).ok()
    }

    pub fn get_member_limits(&self, project_id: Option<&str>) -> Option<crate::types::MemberLimits> {
        self.api.lock().fetch_member_limits(project_id).ok()
    }

    /// `None` covers a network/auth error the same as an older backend without this route -
    /// the panels it feeds simply don't render, same convention get_dashboard_summary
    pub fn get_agent_workspace(&self) -> Option<crate::types::AgentWorkspace> {
        match self.api.lock().fetch_agent_workspace() {
            Ok(workspace) => workspace,
            Err(e) => {
                // This used to be silently swallowed (.ok().flatten()), which made "every
                // panel this feeds is just missing" indistinguishable from "nothing is
                log::warn!("Could not load workspace: {e}");
                None
            }
        }
    }

    /// Errors surface as their server message (Err(String)) rather than a silent None -
    /// unlike the read-only panels above, these are writes the user explicitly asked for
    pub fn create_time_entry(
        &self,
        member_id: &str,
        project_id: &str,
        task_id: Option<&str>,
        date: &str,
        duration_seconds: i64,
        description: &str,
    ) -> Result<(), String> {
        self.api
            .lock()
            .create_time_entry(member_id, project_id, task_id, date, duration_seconds, description)
            .map_err(|e| e.to_string())
    }

    pub fn submit_timesheet(&self, period_start: &str, period_end: &str) -> Result<(), String> {
        self.api
            .lock()
            .submit_timesheet(period_start, period_end)
            .map_err(|e| e.to_string())
    }

    pub fn request_time_off(
        &self,
        policy_id: &str,
        start_date: &str,
        end_date: &str,
        note: &str,
    ) -> Result<(), String> {
        self.api
            .lock()
            .request_time_off(policy_id, start_date, end_date, note)
            .map_err(|e| e.to_string())
    }

    /// Empty on any failure - the screenshots panel is a transparency surface, not
    /// something worth surfacing an error banner for.
    pub fn get_my_screenshots(&self, limit: u32, project_id: Option<&str>) -> Vec<crate::types::ScreenshotRef> {
        match self.api.lock().fetch_my_screenshots(limit, project_id) {
            Ok(shots) => shots,
            Err(e) => {
                log::warn!("Could not load screenshots: {e}");
                Vec::new()
            }
        }
    }

    /// Empty on any failure or an older backend without the route - same "transparency
    /// surface, not an error banner" reasoning as get_my_screenshots above.
    pub fn get_project_app_breakdown(&self, project_id: &str) -> crate::types::ProjectAppBreakdown {
        match self.api.lock().fetch_project_app_breakdown(project_id) {
            Ok(breakdown) => breakdown,
            Err(e) => {
                log::warn!("Could not load this project's app breakdown: {e}");
                crate::types::ProjectAppBreakdown::default()
            }
        }
    }

    /// Empty string when the image can't be loaded - the caller renders a placeholder
    /// rather than a broken <img>.
    pub fn get_screenshot_image(&self, screenshot_id: &str) -> String {
        self.api
            .lock()
            .fetch_screenshot_image(screenshot_id)
            .unwrap_or_default()
    }

    pub fn get_task_detail(&self, task_id: &str) -> Option<crate::types::TaskDetail> {
        if task_id.trim().is_empty() {
            return None;
        }
        self.api.lock().fetch_task_detail(task_id.trim()).ok()
    }

    /// `None` covers a network/auth error the same as an older backend without this route
    /// yet - the sidebar widgets it feeds simply don't render rather than showing an error
    pub fn get_dashboard_summary(&self) -> Option<crate::types::DashboardSummary> {
        self.api.lock().fetch_dashboard_summary().ok().flatten()
    }

    /// `None` covers both "network/auth error" and "no Hours-based budget configured on
    /// this project" - the UI treats them identically (no card shown), so there's nothing
    pub fn get_project_budget_status(&self, project_id: &str) -> Option<crate::types::ProjectBudgetStatus> {
        if project_id.trim().is_empty() {
            return None;
        }
        self.api.lock().fetch_project_budget_status(project_id.trim()).ok().flatten()
    }

    pub fn get_member_profile(&self) -> Option<crate::types::MemberProfile> {
        self.api.lock().fetch_member_profile().ok()
    }

    pub fn set_member_timezone(&self, timezone: &str) -> Result<(), String> {
        self.api.lock().update_member_timezone(timezone)?;
        // Cached locally too, same reason theme is: readable synchronously at startup so
        // the picker and header clock show what was chosen last, instead of this machine's
        let mut prefs = self.get_app_settings().preferences;
        prefs.member_timezone = timezone.to_string();
        let _ = self.save_preferences(prefs);
        Ok(())
    }
}
