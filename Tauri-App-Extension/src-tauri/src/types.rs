use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySignal {
    pub keystroke_count: u64,
    pub distinct_key_count: u32,
    pub mouse_distance_px: u64,
    pub injected_event_count: u64,
    pub active_seconds_in_window: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ActivityEvent {
    #[serde(rename = "screenshot")]
    Screenshot {
        #[serde(rename = "imageData")]
        image_data: String,
        #[serde(rename = "appName")]
        app_name: String,
        #[serde(rename = "pageTitle")]
        page_title: String,
        #[serde(rename = "activityLevel")]
        activity_level: u32,
        /// Site open at capture time, when the focused window was a browser and a recent
        /// reading exists.
        #[serde(skip_serializing_if = "Option::is_none")]
        url: Option<String>,
        #[serde(flatten)]
        signal: ActivitySignal,
    },
    #[serde(rename = "app")]
    App {
        #[serde(rename = "appName")]
        app_name: String,
        #[serde(rename = "pageTitle")]
        page_title: String,
        #[serde(rename = "durationSeconds")]
        duration_seconds: u64,
        /// A `data:image/png;base64,…` icon for this app, sent at most once per distinct
        /// app per agent run.
        #[serde(rename = "appIcon", skip_serializing_if = "Option::is_none")]
        app_icon: Option<String>,
        #[serde(flatten)]
        signal: ActivitySignal,
    },
    #[serde(rename = "url")]
    Url {
        url: String,
        #[serde(rename = "pageTitle")]
        page_title: String,
        #[serde(rename = "durationSeconds")]
        duration_seconds: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInfo {
    pub signed_in: bool,
    #[serde(default)]
    pub link_pending: bool,
    pub name: String,
    #[serde(default)]
    pub email: String,
    pub avatar_url: String,
    pub server_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkStatus {
    pub connected: bool,
    pub server_label: String,
    pub status: String,
}

/// Answer to "can an update install here without an administrator?" - see
/// update_install_readiness in lib.rs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallReadiness {
    /// The install directory is writable by this user, so the installer can run unattended.
    pub writable: bool,
    /// Shown to the user when it is not, so they can tell their admin where.
    pub install_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignInResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl SignInResult {
    pub fn failed(error: &str) -> Self {
        Self {
            success: false,
            error: Some(error.to_string()),
        }
    }
}

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

/// Whether the agent can actually reach the backend, as distinct from merely holding a
/// token.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    Connected,
    Disconnected,
    SignedOut,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectResult {
    pub success: bool,
    /// True only when recovery genuinely needs a browser link again.
    pub needs_relink: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
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

/// The disclosure notice as shown to the UI, composed server-side from the live
/// monitoring_policy row - the agent never hardcodes or composes this text itself.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringNoticeView {
    pub version: String,
    pub text: String,
    pub requires_acknowledgement: bool,
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

/// One captured screenshot, without its bytes - the image is fetched one at a time via
/// get_screenshot_image.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotRef {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub captured_at: Option<String>,
}

/// One app's share of this week's tracked time on a single project - the task-less
/// counterpart to a task's progress bar: "what have I actually been doing here" instead of
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAppTime {
    #[serde(default)]
    pub app_name: String,
    #[serde(default)]
    pub total_seconds: u64,
}

/// The week's top apps together with what they were drawn from.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAppBreakdown {
    #[serde(default)]
    pub apps: Vec<ProjectAppTime>,
    /// Every app in the week, not just the ones listed.
    #[serde(default)]
    pub total_seconds: u64,
    /// How many distinct apps that total covers.
    #[serde(default)]
    pub app_count: u32,
    /// The sum of `apps` alone, so the gap is stated rather than inferred.
    #[serde(default)]
    pub shown_seconds: u64,
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

fn default_true() -> bool {
    true
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

/// The viewer's own People-page member record (GET /api/members/current) - the same data
/// the web dashboard's Members table shows for this person, not just what's in their
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemberProfile {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub avatar_url: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub date_added: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub teams: u32,
    /// The member's own IANA zone (`members.timezone`) - the calendar every day-boundary
    /// decision for this person is resolved in, and the fallback a project's own zone
    #[serde(default)]
    pub timezone: String,
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentNotification {
    pub id: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub target_version: Option<String>,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub read: bool,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentNotificationList {
    #[serde(default)]
    pub notifications: Vec<AgentNotification>,
    #[serde(default)]
    pub unread_count: u32,
}

#[cfg(test)]
mod tests {
    // Guards CF-0.3: "No keystroke *content* logging... it must never capture the
    // actual characters typed (that's keylogging, a categorically higher legal risk)."
    // ActivityEvent is the wire format for everything the agent sends the backend - if
    // a future change ever adds a field meant to carry typed text, it has to touch this
    // enum, and this test is what catches it before it ships.
    #[test]
    fn activity_event_carries_no_classification_verdict() {
        // The agent caches the server's classification data locally (see
        // capture/classification_cache.rs).
        let source = include_str!("types.rs");
        let start = source.find("pub enum ActivityEvent").expect("ActivityEvent enum must exist");
        let end = start + source[start..].find("
}").expect("ActivityEvent enum must close") + 2;
        let enum_source = &source[start..end];

        for forbidden in ["category", "classification", "productive", "verdict"] {
            assert!(
                !enum_source.contains(&format!("{forbidden}:")),
                "ActivityEvent must never carry a '{forbidden}' field - the server resolves                  categories at read time, and an agent-supplied verdict would make the local                  classification cache authoritative and worth tampering with"
            );
        }
    }

    #[test]
    fn activity_event_carries_no_keystroke_content_field() {
        let source = include_str!("types.rs");
        let start = source.find("pub enum ActivityEvent").expect("ActivityEvent enum must exist");
        // "\n}" rather than "\n}\n" so this doesn't depend on LF vs CRLF line endings.
        let end = start + source[start..].find("\n}").expect("ActivityEvent enum must close") + 2;
        let enum_source = &source[start..end];

        for forbidden in ["keys", "keystrokes", "text", "characters", "content", "typed"] {
            assert!(
                !enum_source.contains(&format!("{forbidden}:")),
                "ActivityEvent must never carry a '{forbidden}' field - that's keylogging, not activity metering"
            );
        }
    }
}

#[cfg(test)]
mod queue_compat_tests {
    use super::*;

    /// An agent that queued events before `url` existed must still be able to read its own
    /// backlog after auto-updating.
    #[test]
    fn a_pre_url_screenshot_event_still_deserializes() {
        let old = r#"{"type":"screenshot","imageData":"data:image/jpeg;base64,AAA",
            "appName":"Google Chrome","pageTitle":"x","activityLevel":42,
            "keystrokeCount":1,"distinctKeyCount":1,"mouseDistancePx":0,
            "injectedEventCount":0,"activeSecondsInWindow":15}"#;
        let parsed: Result<ActivityEvent, _> = serde_json::from_str(old);
        assert!(parsed.is_ok(), "old queued event must still parse: {parsed:?}");
    }

    /// The other direction: a manual downgrade leaves a new-format backlog for an older
    /// binary.
    #[test]
    fn an_unknown_future_field_is_ignored_not_rejected() {
        let future = r#"{"type":"screenshot","imageData":"d","appName":"a","pageTitle":"p",
            "activityLevel":1,"url":"https://example.com","somethingAddedLater":true,
            "keystrokeCount":0,"distinctKeyCount":0,"mouseDistancePx":0,
            "injectedEventCount":0,"activeSecondsInWindow":0}"#;
        let parsed: Result<ActivityEvent, _> = serde_json::from_str(future);
        assert!(parsed.is_ok(), "unknown fields must be ignored: {parsed:?}");
    }

    /// A round trip through the exact shape queue.rs writes.
    #[test]
    fn a_screenshot_with_a_url_round_trips() {
        let event = ActivityEvent::Screenshot {
            image_data: "d".into(),
            app_name: "Google Chrome".into(),
            page_title: "p".into(),
            activity_level: 50,
            url: Some("https://github.com/x".into()),
            signal: ActivitySignal::default(),
        };
        let json = serde_json::to_string(&event).expect("serialize");
        assert!(json.contains("\"url\""), "url must survive serialization: {json}");
        let back: ActivityEvent = serde_json::from_str(&json).expect("deserialize");
        match back {
            ActivityEvent::Screenshot { url, .. } => {
                assert_eq!(url.as_deref(), Some("https://github.com/x"));
            }
            _ => panic!("wrong variant"),
        }
    }
}
