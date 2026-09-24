//! Projects, tasks, sessions and the things a member submits: time entries, timesheets,
//! time-off requests.

use std::sync::Arc;

use crate::run_blocking;
use crate::AppState;
use crate::types::{ActionResult, AgentTask, SessionInfo};

#[tauri::command]
pub async fn list_projects(state: tauri::State<'_, AppState>) -> Result<Vec<crate::types::ProjectInfo>, String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || controller.list_projects()).await
}

#[tauri::command]
pub async fn list_tasks(
    state: tauri::State<'_, AppState>,
    project_id: Option<String>,
) -> Result<Vec<AgentTask>, String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || controller.list_tasks(project_id.as_deref())).await
}

#[tauri::command]
pub async fn create_task(
    state: tauri::State<'_, AppState>,
    project_id: String,
    title: String,
    estimate_hours: Option<f64>,
    description: Option<String>,
    priority: Option<String>,
    due_date: Option<String>,
) -> Result<crate::types::CreateTaskResult, String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || {
        controller.create_task(
            &project_id,
            &title,
            estimate_hours,
            description.as_deref(),
            priority.as_deref(),
            due_date.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn get_session(state: tauri::State<'_, AppState>) -> Result<SessionInfo, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_session()).await)
}

#[tauri::command]
pub async fn get_task_time_tracking(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<Option<crate::types::TaskTimeTracking>, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_task_time_tracking(&task_id)).await)
}

#[tauri::command]
pub async fn get_member_limits(
    state: tauri::State<'_, AppState>,
    project_id: Option<String>,
) -> Result<Option<crate::types::MemberLimits>, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_member_limits(project_id.as_deref())).await)
}

#[tauri::command]
pub async fn get_agent_workspace(
    state: tauri::State<'_, AppState>,
) -> Result<Option<crate::types::AgentWorkspace>, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_agent_workspace()).await)
}

#[tauri::command]
pub async fn create_time_entry(
    state: tauri::State<'_, AppState>,
    member_id: String,
    project_id: String,
    task_id: Option<String>,
    date: String,
    duration_seconds: i64,
    description: String,
) -> Result<(), String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || {
        controller.create_time_entry(
            &member_id,
            &project_id,
            task_id.as_deref(),
            &date,
            duration_seconds,
            &description,
        )
    })
    .await
}

#[tauri::command]
pub async fn submit_timesheet(
    state: tauri::State<'_, AppState>,
    period_start: String,
    period_end: String,
) -> Result<(), String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || controller.submit_timesheet(&period_start, &period_end)).await
}

#[tauri::command]
pub async fn request_time_off(
    state: tauri::State<'_, AppState>,
    policy_id: String,
    start_date: String,
    end_date: String,
    note: String,
) -> Result<(), String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || controller.request_time_off(&policy_id, &start_date, &end_date, &note)).await
}

#[tauri::command]
pub async fn get_task_detail(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<Option<crate::types::TaskDetail>, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_task_detail(&task_id)).await)
}

#[tauri::command]
pub async fn get_project_budget_status(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<Option<crate::types::ProjectBudgetStatus>, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_project_budget_status(&project_id)).await)
}

#[tauri::command]
pub async fn start_task_session(state: tauri::State<'_, AppState>, task_id: String) -> Result<ActionResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.start_task_session(&task_id)).await)
}

#[tauri::command]
pub async fn start_project_session(state: tauri::State<'_, AppState>, project_id: String) -> Result<ActionResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.start_project_session(&project_id)).await)
}

#[tauri::command]
pub async fn stop_session(
    state: tauri::State<'_, AppState>,
    stop_note: Option<String>,
) -> Result<ActionResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.stop_session(stop_note.as_deref())).await)
}

#[tauri::command]
pub async fn pause_session(state: tauri::State<'_, AppState>) -> Result<ActionResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.pause_session()).await)
}

#[tauri::command]
pub async fn resume_session(state: tauri::State<'_, AppState>) -> Result<ActionResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.resume_session()).await)
}

#[tauri::command]
pub async fn is_session_paused(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.is_session_paused()).await)
}
