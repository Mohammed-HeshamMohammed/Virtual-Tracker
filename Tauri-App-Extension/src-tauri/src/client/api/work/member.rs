//! The signed-in member: identity, limits, profile, workspace, dashboard.

use super::*;

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
        // TimerAllowance is what actually gates the start button server-side.
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
            // Explicit null means "no cap", which is not the same as 0 left - only a real
            // number becomes Some(..).
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
            today_day: data.get("todayDay").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            // Absent on an older backend - the week chart then falls back to an empty week
            // rather than failing the whole limits fetch.
            week_days: parse_week_days(data.get("weekDays")),
        })
    }

    /// Everything the agent shows beyond the timer itself (time off, timesheet, earnings,
    /// and - per role - team status, pending approvals, org pulse), in one round trip.
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
            // Was collapsed to a bare ApiError::Network, indistinguishable from a real
            // connection failure - which made a 401 (stale token) or a 500 (real server
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

    /// The viewer's own People-page member record, for the profile view.
    pub fn fetch_member_profile(&mut self) -> Result<crate::types::MemberProfile, ApiError> {
        let body = self.get_json("/api/members/current")?;
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
            // Role_name (from role enrichment) is the human label; role can be a raw
            // id/slug when enrichment didn't attach a name.
            role: {
                let named = str_field("role_name");
                if named.is_empty() { str_field("role") } else { named }
            },
            status: str_field("status"),
            date_added: str_field("dateAdded"),
            phone: str_field("phone"),
            teams: data.get("teams").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
            // /api/members/current returns the member row as-is, so the column name is
            // snake_case; accept the camelCase spelling too rather than depending on which
            timezone: {
                let snake = str_field("timezone");
                if snake.is_empty() { str_field("timeZone") } else { snake }
            },
        })
    }

    /// The same payload GET /api/dashboard/general feeds the web dashboard's own
    /// personal/general view with - only the "me" slice, never "all" (that's the manager
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
