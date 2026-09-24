use std::time::Duration;

use serde_json::{json, Value};

use super::{ApiClient, ApiError};
use crate::constants::HTTP_TIMEOUT_SEC;

mod member;
mod projects;
mod screenshots;
mod submissions;
mod tasks;

impl ApiClient {



















}

fn parse_week_days(node: Option<&Value>) -> Vec<crate::types::WeekDay> {
    node.cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

/// Parses the `assignedToday` block on GET /api/activity/limits (T5,
/// PLAN-livesyncandagenttimer.md §11).
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

/// Parses the `assignedTotal` block on GET /api/activity/limits.
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
#[path = "tests.rs"]
mod work_tests;
