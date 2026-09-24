//! Projects, tasks, sessions and the member's own limits and submissions.

use serde::{Deserialize, Serialize};

#[allow(unused_imports)]
use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTask {
    pub id: String,
    pub title: String,
    pub status: String,
    #[serde(default)]
    pub project_id: String,
}

/// Create_task's result: the new task, plus whether the create call also managed to
/// self-assign it (POST /api/tasks/:id/assignments, which explicitly allows the task's own
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskResult {
    pub task: AgentTask,
    pub self_assigned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    /// The server's project type name.
    #[serde(default)]
    pub project_type: String,
    /// Whether this project has a task list at all.
    #[serde(default = "default_true")]
    pub has_tasks: bool,
    /// Whether a task must be selected before a timer can start.
    #[serde(default = "default_true")]
    pub require_task_to_track: bool,
    /// Whether stopping a timer on this project prompts for a note.
    #[serde(default)]
    pub require_stop_note: bool,
    #[serde(default)]
    pub budget_exhausted: bool,
    /// Real spend / target for this project's own budget, as a 0-100+ percent (can exceed
    /// 100 - that's exactly what budget_exhausted means).
    #[serde(default)]
    pub budget_spent_percent: Option<f64>,
    /// Server-derived from viewerCanCreateProjectTasks (org admin, or this member's own
    /// project_role = "manager" on this project) - gates the "+ New task" row action so it
    #[serde(default)]
    pub can_create_tasks: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: Option<String>,
    pub status: String,
    pub task_id: Option<String>,
    pub task_title: Option<String>,
    pub project_id: Option<String>,
    /// Idle escalation stage: 0 working, 1 warned (5m), 2 alerted (10m), 3 stopped for
    /// idling (15m, idle time reversed).
    #[serde(default)]
    pub idle_stage: u8,
    #[serde(default)]
    pub active_seconds: u64,
    #[serde(default)]
    pub idle_seconds: u64,
    #[serde(default)]
    pub timer_capped: bool,
    /// Same as timer_capped, but for the project's own budget stop-timer threshold (Budget
    /// & Limits tab) instead of a task's daily hour cap.
    #[serde(default)]
    pub budget_capped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<SessionInfo>,
}

/// Mirrors the web dashboard's per-task time-tracking summary (was shown in the web's
/// floating timer popup — that popup is gone, this is now its home).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskTimeTracking {
    #[serde(default)]
    pub active_seconds: u64,
    #[serde(default)]
    pub idle_seconds: u64,
    #[serde(default)]
    pub task_status: String,
    pub estimated_seconds: Option<u64>,
    /// The portion of estimated_seconds that comes from overtime hours specifically, broken
    /// out so it's visible instead of only ever appearing merged into the total.
    pub overtime_seconds: Option<u64>,
    /// Raw schedule breakdown behind estimated_seconds ("7 days x 8h/day"), since the
    /// multiplied total alone doesn't show the reader how it's built.
    pub working_days: Option<u64>,
    pub hours_per_day: Option<f64>,
    pub overtime_hours_per_day: Option<f64>,
    pub progress_percent: Option<f64>,
    /// Total active seconds worked today across all tasks.
    pub worked_today_seconds: Option<u64>,
    /// Active seconds worked today on this specific task.
    pub worked_today_on_task_seconds: Option<u64>,
    /// Seconds left before the member/task cap (allowance already accounts for any overtime
    /// the org has granted).
    pub allowed_remaining_seconds: Option<i64>,
    #[serde(default)]
    pub limit_reached: bool,
    pub allowance_message: Option<String>,
    /// The owning project's idle-time settings, fetched fresh on every task/session
    /// transition instead of a hardcoded/org-wide constant - see
    #[serde(default)]
    pub disable_idle_time: bool,
    #[serde(default = "default_idle_time_seconds")]
    pub idle_time_seconds: u64,
    /// When true, active_seconds/estimated_seconds above are the whole task's pooled total
    /// across every assignee combined, not just this member's own - see the
    #[serde(default)]
    pub shared_budget: bool,
}

/// 450s = 7.5 minutes, the same product default `ensure-lookup-schema.js` gives a project
/// on creation - used here only as a deserialization fallback if a response is ever missing
fn default_idle_time_seconds() -> u64 {
    450
}

/// A project's Hours-based budget, resolved for the current viewer - GET
/// /api/projects/:id/budget-status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBudgetStatus {
    /// "per_person": remaining is this viewer's own allotment/spend.
    pub scope: String,
    pub cap_seconds: u64,
    pub spent_seconds: u64,
    pub remaining_seconds: u64,
}

/// The viewer's own daily/weekly work-hour limits (People > member > Limits), for the
/// profile view — separate from TaskTimeTracking, which is scoped to one task's allowance
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemberLimits {
    #[serde(default)]
    pub daily_hours: f64,
    #[serde(default)]
    pub weekly_hours: f64,
    /// If true, this member is scheduled by shifts instead of daily/weekly caps, so
    /// daily_hours/weekly_hours don't apply (matches memberUsesShiftsForLimits on the
    #[serde(default)]
    pub uses_shifts: bool,
    /// Active seconds already logged today, across every task and project.
    #[serde(default)]
    pub worked_today_seconds: i64,
    /// Active seconds logged so far this rolling week.
    #[serde(default)]
    pub worked_week_seconds: i64,
    /// Seconds left before the binding cap stops the timer.
    #[serde(default)]
    pub allowed_remaining_seconds: Option<i64>,
    #[serde(default)]
    pub limit_reached: bool,
    /// T5 - how much work is assigned across today's open tasks, a different question from
    /// allowed_remaining_seconds above ("how much am I still allowed to work" vs "how much
    #[serde(default)]
    pub assigned_today: AssignedToday,
    /// Everything open on this person's plate across every project, with no calendar
    /// applied - "how much work do I hold" to assigned_today's "how much of it does today
    #[serde(default)]
    pub assigned_total: AssignedTotal,
    /// Work Time & Limits > "Working days" - false blocks starting/resuming a timer
    /// server-side (People > member > Work Time & Limits).
    #[serde(default = "default_true")]
    pub working_today: bool,
    /// True when today is only worked because it's a double-clicked "makeup day" flag, not
    /// a regular selected working day.
    #[serde(default)]
    pub is_makeup_day: bool,
    /// Today's active/idle split, the same measure the dashboard grades activity on.
    #[serde(default)]
    pub today_activity: TodayActivity,
    /// Same split as today_activity, scoped to the project the caller asked about
    /// (get_member_limits' project_id argument) instead of every project - `None` when no
    #[serde(default)]
    pub project_today_activity: Option<TodayActivity>,
    /// The member's local today, "YYYY-MM-DD" - which of `week_days` is today.
    #[serde(default)]
    pub today_day: String,
    /// This week, Monday first, from the same rollup as worked_week_seconds.
    #[serde(default)]
    pub week_days: Vec<WeekDay>,
}

/// One day of the member's week - active seconds from the daily rollup, idle seconds from
/// the sessions that started that day.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeekDay {
    #[serde(default)]
    pub day: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub active_seconds: i64,
    #[serde(default)]
    pub idle_seconds: i64,
}

// ── Agent workspace (GET /api/activity/workspace) ────────────────────────── Everything
// the agent shows beyond the timer itself, resolved per-role server-side.

/// One time-off policy's standing for this member.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeOffBalance {
    /// What a time-off request is filed against - travels with the balance so the request
    /// dialog needs no second fetch.
    #[serde(default)]
    pub policy_id: String,
    #[serde(default)]
    pub policy_name: String,
    #[serde(default)]
    pub balance_days: f64,
    #[serde(default)]
    pub entitlement_days: f64,
}

/// The member's most recent timesheet, whatever state it's in.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimesheetStatus {
    #[serde(default)]
    pub period_start: String,
    #[serde(default)]
    pub period_end: String,
    /// Draft | submitted | approved | rejected (the timesheets CHECK set).
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub total_hours: f64,
}

/// Tracked-time earnings at the member's own rate.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EarningsSummary {
    #[serde(default)]
    pub currency: String,
    #[serde(default)]
    pub hourly_rate: f64,
    #[serde(default)]
    pub week_amount: f64,
    #[serde(default)]
    pub month_amount: f64,
}

/// The task's own detail, for showing what you're actually meant to be doing while tracking
/// it.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub due_date: String,
    #[serde(default)]
    pub subtasks: Vec<TaskSubtask>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSubtask {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub completed: bool,
}
