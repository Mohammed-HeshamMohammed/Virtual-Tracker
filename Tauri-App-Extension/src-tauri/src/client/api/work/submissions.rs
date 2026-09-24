//! What the member submits: time entries, timesheets, time off.

use super::*;

impl ApiClient {
    /// Logs time that was never tracked live.
    pub fn create_time_entry(
        &mut self,
        member_id: &str,
        project_id: &str,
        task_id: Option<&str>,
        date: &str,
        duration_seconds: i64,
        description: &str,
    ) -> Result<(), ApiError> {
        // Empty member_id means "me".
        let resolved_member = if member_id.trim().is_empty() {
            self.fetch_viewer_member_id()
                .ok_or_else(|| ApiError::Rejected("Could not resolve your member profile".into()))?
        } else {
            member_id.to_string()
        };
        let mut body = json!({
            "member_id": resolved_member,
            "project_id": project_id,
            "date": date,
            "duration": duration_seconds,
            "description": description,
            "billable": true,
            "status": "pending",
            "start_time": serde_json::Value::Null,
            "end_time": serde_json::Value::Null,
        });
        if let Some(tid) = task_id.filter(|t| !t.trim().is_empty()) {
            body["task_id"] = json!(tid);
        }
        self.post_ok("/api/time-entries", &body, "Could not save the time entry")
    }

    /// Submits the viewer's own timesheet for a period.
    pub fn submit_timesheet(&mut self, period_start: &str, period_end: &str) -> Result<(), ApiError> {
        let body = json!({ "periodStart": period_start, "periodEnd": period_end });
        self.post_ok("/api/timesheets/submit", &body, "Could not submit the timesheet")
    }

    /// Files a time-off request for the viewer against one of their policies.
    pub fn request_time_off(
        &mut self,
        policy_id: &str,
        start_date: &str,
        end_date: &str,
        note: &str,
    ) -> Result<(), ApiError> {
        let body = json!({
            "policyId": policy_id,
            "startDate": start_date,
            "endDate": end_date,
            "note": note,
        });
        self.post_ok("/api/time-off/requests", &body, "Could not submit the request")
    }
}
