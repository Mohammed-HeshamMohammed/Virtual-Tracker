use serde::{Deserialize, Serialize};

/// ACT-4: the raw counters `ActivityMeter::score()` itself is built from,
/// sent alongside the pre-computed `activity_level` so the **server** can
/// recompute or re-weight a score later without an agent release - only
/// `activity_level` used to cross the wire, which left the server with
/// nothing to recompute from. `distinct_key_count` (not `distinct_keys`) and
/// `keystroke_count` (not raw text) deliberately name these as counts, not
/// content - see `activity_event_carries_no_keystroke_content_field` below.
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
        /// Site open at capture time, when the focused window was a browser
        /// and a recent reading exists. Lets the server categorise the capture
        /// by what was actually on screen instead of inferring it from a
        /// separate URL log. Omitted entirely when unknown - never guessed.
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

/// create_task's result: the new task, plus whether the create call also
/// managed to self-assign it (POST /api/tasks/:id/assignments, which
/// explicitly allows the task's own creator - see assign_task_to_self's own
/// doc comment for why that endpoint and not the flat
/// POST /api/task-assignments). Self-assign can still fail on its own (e.g.
/// the member is already at their work-hour limit), so it can fail even
/// when creating the task itself succeeded. When it does, the task exists
/// but won't show up in "Your tasks" (assigned_to-filtered) until someone
/// assigns it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskResult {
    pub task: AgentTask,
    pub self_assigned: bool,
}

/// Whether the agent can actually reach the backend, as distinct from merely
/// holding a token. `Disconnected` is the state that shows the recovery view.
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
    /// The server's project type name. Deliberately not an enum: the backend
    /// owns the set (project-types.js) and the agent only needs has_tasks.
    #[serde(default)]
    pub project_type: String,
    /// Whether this project has a task list at all. Server-derived from the
    /// type. Defaults to true so an older backend that does not send it keeps
    /// the previous task-based behavior rather than hiding the task picker.
    #[serde(default = "default_true")]
    pub has_tasks: bool,
    /// Whether a task must be selected before a timer can start. Defaults to
    /// true (the previous unconditional behavior for normal projects); false
    /// lets a normal project track against the project itself.
    #[serde(default = "default_true")]
    pub require_task_to_track: bool,
    /// Whether stopping a timer on this project prompts for a note.
    #[serde(default)]
    pub require_stop_note: bool,
    /// This project's Hours budget is spent, so no timer can start against
    /// it. These used to be dropped from the list entirely, which rendered
    /// as a bare "No projects to track against yet" with no way to tell an
    /// exhausted budget apart from having no projects at all. Same reasoning
    /// fetch_assigned_tasks already gives for keeping over-limit tasks
    /// visible: explaining why it can't start beats hiding it.
    #[serde(default)]
    pub budget_exhausted: bool,
    /// Real spend / target for this project's own budget, as a 0-100+
    /// percent (can exceed 100 - that's exactly what budget_exhausted
    /// means). `None` when the project has no budget configured, or its
    /// target is 0 (nothing to divide by) - distinct from Some(0.0), a
    /// budget that's real but genuinely untouched so far.
    ///
    /// Exists because the sidebar's other progress source (recentProjects,
    /// task-completion percent) reads 0% for any project with no task
    /// marked "done" yet, which is indistinguishable from a project that
    /// has never been worked on at all - even when its budget shows real
    /// spend. The UI prefers this field over the task-completion one
    /// whenever a project actually has a budget to report.
    #[serde(default)]
    pub budget_spent_percent: Option<f64>,
    /// Server-derived from viewerCanCreateProjectTasks (org admin, or this
    /// member's own project_role = "manager" on this project) - gates the
    /// "+ New task" row action so it only appears where the create call
    /// would actually succeed, instead of every viewer seeing an affordance
    /// that 403s for everyone but managers. Defaults false so an older
    /// backend without this field simply hides the button rather than
    /// showing one that always fails.
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
    /// Idle escalation stage: 0 working, 1 warned (5m), 2 alerted (10m),
    /// 3 stopped for idling (15m, idle time reversed).
    #[serde(default)]
    pub idle_stage: u8,
    #[serde(default)]
    pub active_seconds: u64,
    #[serde(default)]
    pub idle_seconds: u64,
    /// TC-5: the server truncated active_seconds against the task's daily
    /// cap on this sync - the timer is over its allowance and should be
    /// stopped, not left running with a number that's no longer advancing.
    #[serde(default)]
    pub timer_capped: bool,
    /// Same as timer_capped, but for the project's own budget stop-timer
    /// threshold (Budget & Limits tab) instead of a task's daily hour cap.
    #[serde(default)]
    pub budget_capped: bool,
}

/// CF-2: the disclosure notice as shown to the UI, composed server-side from
/// the live monitoring_policy row - the agent never hardcodes or composes
/// this text itself. `requires_acknowledgement` is what gates tracking start.
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

/// Mirrors the web dashboard's per-task time-tracking summary (was shown in the
/// web's floating timer popup — that popup is gone, this is now its home).
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
    /// The portion of estimated_seconds that comes from overtime hours specifically,
    /// broken out so it's visible instead of only ever appearing merged into the total.
    pub overtime_seconds: Option<u64>,
    /// Raw schedule breakdown behind estimated_seconds ("7 days x 8h/day"),
    /// since the multiplied total alone doesn't show the reader how it's built.
    pub working_days: Option<u64>,
    pub hours_per_day: Option<f64>,
    pub overtime_hours_per_day: Option<f64>,
    pub progress_percent: Option<f64>,
    /// Total active seconds worked today across all tasks.
    pub worked_today_seconds: Option<u64>,
    /// Active seconds worked today on this specific task.
    pub worked_today_on_task_seconds: Option<u64>,
    /// Seconds left before the member/task cap (allowance already accounts for
    /// any overtime the org has granted). None means no cap applies.
    pub allowed_remaining_seconds: Option<i64>,
    #[serde(default)]
    pub limit_reached: bool,
    pub allowance_message: Option<String>,
    /// ID-3: the owning project's idle-time settings, fetched fresh on every
    /// task/session transition instead of a hardcoded/org-wide constant - see
    /// PLAN-agent-crash-safe-progress.md. `disable_idle_time = true` means no
    /// active/idle split and no idle escalation for this project at all.
    #[serde(default)]
    pub disable_idle_time: bool,
    #[serde(default = "default_idle_time_seconds")]
    pub idle_time_seconds: u64,
    /// When true, active_seconds/estimated_seconds above are the whole
    /// task's pooled total across every assignee combined, not just this
    /// member's own - see the shared_task_budget column and the identical
    /// field on the backend's getTaskTimeTracking response.
    #[serde(default)]
    pub shared_budget: bool,
}

/// 450s = 7.5 minutes, the same product default `ensure-lookup-schema.js`
/// gives a project on creation - used here only as a deserialization
/// fallback if a response is ever missing the field.
fn default_idle_time_seconds() -> u64 {
    450
}

/// A project's Hours-based budget, resolved for the current viewer -
/// GET /api/projects/:id/budget-status. `None` (the Tauri command returns
/// `Option<ProjectBudgetStatus>`) means no Hours-based budget is configured
/// for this project at all, same as today's silence.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBudgetStatus {
    /// "per_person": remaining is this viewer's own allotment/spend.
    /// "shared": remaining is the whole team's pooled allotment/spend.
    pub scope: String,
    pub cap_seconds: u64,
    pub spent_seconds: u64,
    pub remaining_seconds: u64,
}

/// The viewer's own daily/weekly work-hour limits (People > member > Limits),
/// for the profile view — separate from TaskTimeTracking, which is scoped to
/// one task's allowance rather than the member's overall caps.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemberLimits {
    #[serde(default)]
    pub daily_hours: f64,
    #[serde(default)]
    pub weekly_hours: f64,
    /// If true, this member is scheduled by shifts instead of daily/weekly
    /// caps, so daily_hours/weekly_hours don't apply (matches
    /// memberUsesShiftsForLimits on the backend).
    #[serde(default)]
    pub uses_shifts: bool,
    /// Active seconds already logged today, across every task and project.
    #[serde(default)]
    pub worked_today_seconds: i64,
    /// Active seconds logged so far this rolling week.
    #[serde(default)]
    pub worked_week_seconds: i64,
    /// Seconds left before the binding cap stops the timer. `None` means no
    /// cap applies at all - not "zero left".
    #[serde(default)]
    pub allowed_remaining_seconds: Option<i64>,
    #[serde(default)]
    pub limit_reached: bool,
    /// T5 - how much work is assigned across today's open tasks, a
    /// different question from allowed_remaining_seconds above ("how much
    /// am I still allowed to work" vs "how much work do I have").
    #[serde(default)]
    pub assigned_today: AssignedToday,
    /// Work Time & Limits > "Working days" - false blocks starting/resuming
    /// a timer server-side (People > member > Work Time & Limits). Defaults
    /// true so older backends without this field never falsely block.
    #[serde(default = "default_true")]
    pub working_today: bool,
    /// True when today is only worked because it's a double-clicked
    /// "makeup day" flag, not a regular selected working day.
    #[serde(default)]
    pub is_makeup_day: bool,
    /// Today's active/idle split, the same measure the dashboard grades
    /// activity on. Zeroed on older backends, which the UI reads as
    /// "nothing tracked yet" and hides.
    #[serde(default)]
    pub today_activity: TodayActivity,
    /// Same split as today_activity, scoped to the project the caller asked
    /// about (get_member_limits' project_id argument) instead of every
    /// project - `None` when no project was asked about, or on an older
    /// backend without this field. Feeds the main pane's Activity ring
    /// ("current project"), separate from the sidebar's person-wide ring.
    #[serde(default)]
    pub project_today_activity: Option<TodayActivity>,
}

// ── Agent workspace (GET /api/activity/workspace) ──────────────────────────
// Everything the agent shows beyond the timer itself, resolved per-role
// server-side. Every section but `own` is Option: the backend omits (nulls)
// whichever the viewer isn't entitled to, so the UI renders what arrived and
// carries no role logic of its own.

/// One time-off policy's standing for this member.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeOffBalance {
    /// What a time-off request is filed against - travels with the balance
    /// so the request dialog needs no second fetch.
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
    /// draft | submitted | approved | rejected (the timesheets CHECK set).
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub total_hours: f64,
}

/// Tracked-time earnings at the member's own rate. `hourly_rate` of 0 means
/// no rate is configured (or the viewer may not see it) - the UI hides the
/// card rather than showing an authoritative-looking zero.
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

/// Server-decided permissions for controls the agent renders. Decided
/// there, not from the agent's own copy of the role, so a spoofed local
/// role cannot reveal a control.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCapabilities {
    /// Manager and above only.
    #[serde(default)]
    pub can_log_manual_time: bool,
}

/// One captured screenshot, without its bytes - the image is fetched one at
/// a time via get_screenshot_image.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotRef {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub captured_at: Option<String>,
}

/// The task's own detail, for showing what you're actually meant to be doing
/// while tracking it.
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
    /// Named `own` because `self` is a Rust keyword - the wire field really
    /// is "self", which the serde rename below restores on both sides.
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

/// See PLAN-livesyncandagenttimer.md §11 (T5) for the allocation rules this
/// mirrors from the backend's assigned-today.service.js - demandSeconds is
/// everything due today (including rollover from earlier days);
/// plannedSeconds is the part that fits under the member's own cap;
/// deferredSeconds is what got pushed to later days, never dropped.
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

/// The viewer's own People-page member record (GET /api/members/current) -
/// the same data the web dashboard's Members table shows for this person,
/// not just what's in their Firebase JWT claims.
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
}

/// One day's row out of the web dashboard's own "Weekly trends" chart
/// (GET /api/dashboard/general) - reused rather than re-derived so the
/// agent's chart is never a moment out of sync with the one the member
/// already knows from the web.
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

/// One row out of the web dashboard's "Recent projects" panel - the same
/// per-project progress the member already sees there, not something the
/// agent computes on its own.
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

/// The member's own ("me", never "all" - the agent is a personal tool, not
/// a manager's view) slice of GET /api/dashboard/general - the same payload
/// that fills the web dashboard's own general/personal view.
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

#[cfg(test)]
mod tests {
    // Guards CF-0.3: "No keystroke *content* logging... it must never
    // capture the actual characters typed (that's keylogging, a
    // categorically higher legal risk)." ActivityEvent is the wire format
    // for everything the agent sends the backend - if a future change ever
    // adds a field meant to carry typed text, it has to touch this enum, and
    // this test is what catches it before it ships. Source-scan rather than
    // reflection since Rust has no runtime field enumeration; bounded to the
    // enum's own text so an unrelated field elsewhere named e.g. "content"
    // (there isn't one, but hypothetically) wouldn't false-positive this.
    #[test]
    fn activity_event_carries_no_classification_verdict() {
        // The agent caches the server's classification data locally (see
        // capture/classification_cache.rs). That cache is safe to keep on a
        // machine the member controls *only* because it has no authority:
        // categories are resolved server-side at read time, so editing the
        // file changes what one person's own window displays and nothing else.
        //
        // The moment ActivityEvent grows a category field, that stops being
        // true - the local cache becomes authoritative and therefore worth
        // tampering with. This fails loudly the day someone tries.
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
