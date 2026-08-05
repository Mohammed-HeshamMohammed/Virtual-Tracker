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
    /// "normal" (work is tracked against tasks) or "calling" (no tasks - the
    /// timer runs against the project itself).
    #[serde(default)]
    pub project_type: String,
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
}

/// 450s = 7.5 minutes, the same product default `ensure-lookup-schema.js`
/// gives a project on creation - used here only as a deserialization
/// fallback if a response is ever missing the field.
fn default_idle_time_seconds() -> u64 {
    450
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
