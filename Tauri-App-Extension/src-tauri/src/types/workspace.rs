//! The workspace and dashboard views the tracker renders back to the member.

use serde::{Deserialize, Serialize};

#[allow(unused_imports)]
use super::*;

/// The viewer's own standing - present for every role that can sign in.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSelf {
    #[serde(default)]
    pub time_off: Vec<TimeOffBalance>,
    #[serde(default)]
    pub timesheet: Option<TimesheetStatus>,
    #[serde(default)]
    pub earnings: EarningsSummary,
}

/// One member of a team the viewer leads.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberStatus {
    #[serde(default)]
    pub member_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub tracking_now: bool,
    #[serde(default)]
    pub on_break: bool,
    #[serde(default)]
    pub active_seconds_today: i64,
}

/// Present only for a viewer flagged `is_lead` on at least one team.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTeam {
    #[serde(default)]
    pub team_count: i64,
    #[serde(default)]
    pub members: Vec<TeamMemberStatus>,
    #[serde(default)]
    pub tracking_now_count: i64,
    #[serde(default)]
    pub not_started_count: i64,
    #[serde(default)]
    pub total_active_seconds_today: i64,
}

/// Present only for a management role.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceApprovals {
    #[serde(default)]
    pub pending_count: i64,
}

/// Present only for an org-admin role (Super Manager and up).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePulse {
    #[serde(default)]
    pub total_active_seconds_today: i64,
    #[serde(default)]
    pub tracking_now_count: i64,
    #[serde(default)]
    pub members_worked_today_count: i64,
}

/// Server-decided permissions for controls the agent renders.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCapabilities {
    /// Manager and above only.
    #[serde(default)]
    pub can_log_manual_time: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkspace {
    /// Named `own` because `self` is a Rust keyword - the wire field really is "self",
    /// which the serde rename below restores on both sides.
    #[serde(rename = "self", default)]
    pub own: WorkspaceSelf,
    #[serde(default)]
    pub team: Option<WorkspaceTeam>,
    #[serde(default)]
    pub approvals: Option<WorkspaceApprovals>,
    #[serde(default)]
    pub pulse: Option<WorkspacePulse>,
    #[serde(default)]
    pub capabilities: WorkspaceCapabilities,
}

/// Active vs idle seconds for a day - the ratio behind the activity meter.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TodayActivity {
    #[serde(default)]
    pub active_seconds: i64,
    #[serde(default)]
    pub idle_seconds: i64,
}


#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AssignedTodayByProjectType {
    #[serde(default)]
    pub normal: i64,
    #[serde(default)]
    pub calling: i64,
}

/// See PLAN-livesyncandagenttimer.md §11 (T5) for the allocation rules this mirrors from
/// the backend's assigned-today.service.js - demandSeconds is everything due today
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AssignedToday {
    #[serde(default)]
    pub demand_seconds: i64,
    #[serde(default)]
    pub planned_seconds: i64,
    #[serde(default)]
    pub deferred_seconds: i64,
    #[serde(default)]
    pub rollover_seconds: i64,
    #[serde(default)]
    pub task_count: i64,
    #[serde(default)]
    pub by_project_type: AssignedTodayByProjectType,
}

/// The un-scheduled counterpart to AssignedToday: every open assignment in every unarchived
/// project, whether it is due today, overdue, or not started yet.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AssignedTotal {
    #[serde(default)]
    pub assigned_seconds: i64,
    #[serde(default)]
    pub worked_seconds: i64,
    #[serde(default)]
    pub remaining_seconds: i64,
    #[serde(default)]
    pub task_count: i64,
    #[serde(default)]
    pub project_count: i64,
}

/// One day's row out of the web dashboard's own "Weekly trends" chart (GET
/// /api/dashboard/general) - reused rather than re-derived so the agent's chart is never a
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyActivityDay {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub active_hours: f64,
    #[serde(default)]
    pub idle_hours: f64,
}

/// One row out of the web dashboard's "Recent projects" panel - the same per-project
/// progress the member already sees there, not something the agent computes on its own.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecentProjectSummary {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub progress: f64,
    #[serde(default)]
    pub member_count: u32,
}

/// The member's own ("me", never "all" - the agent is a personal tool, not a manager's
/// view) slice of GET /api/dashboard/general - the same payload that fills the web
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    #[serde(default)]
    pub activity_week_percent: f64,
    #[serde(default)]
    pub weekly_activity: Vec<WeeklyActivityDay>,
    #[serde(default)]
    pub recent_projects: Vec<RecentProjectSummary>,
}
