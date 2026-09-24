//! Read-only views the tracker shows back to the member - their own screenshots, app
//! breakdown, dashboard summary and the monitoring notice.

use std::sync::Arc;

use crate::run_blocking;
use crate::AppState;

#[tauri::command]
pub async fn get_my_screenshots(
    state: tauri::State<'_, AppState>,
    limit: Option<u32>,
    project_id: Option<String>,
) -> Result<Vec<crate::types::ScreenshotRef>, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_my_screenshots(limit.unwrap_or(12), project_id.as_deref())).await)
}

#[tauri::command]
pub async fn get_project_app_breakdown(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<crate::types::ProjectAppBreakdown, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_project_app_breakdown(&project_id)).await)
}

#[tauri::command]
pub async fn get_screenshot_image(
    state: tauri::State<'_, AppState>,
    screenshot_id: String,
) -> Result<String, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_screenshot_image(&screenshot_id)).await)
}

#[tauri::command]
pub async fn get_dashboard_summary(
    state: tauri::State<'_, AppState>,
) -> Result<Option<crate::types::DashboardSummary>, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_dashboard_summary()).await)
}

#[tauri::command]
pub async fn get_monitoring_notice(state: tauri::State<'_, AppState>) -> Result<Option<crate::types::MonitoringNoticeView>, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_monitoring_notice()).await)
}

#[tauri::command]
pub async fn acknowledge_monitoring_notice(state: tauri::State<'_, AppState>, notice_version: String) -> Result<bool, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.acknowledge_monitoring_notice(&notice_version)).await)
}

/// `minutes = None` ends the break.
#[tauri::command]
pub async fn set_private_break(
    state: tauri::State<'_, AppState>,
    minutes: Option<u32>,
    reason: String,
) -> Result<i64, String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || controller.set_private_break(minutes, &reason)).await
}

#[tauri::command]
pub fn capture_status(state: tauri::State<'_, AppState>) -> crate::types::CaptureStatus {
    state.controller.capture_status()
}
