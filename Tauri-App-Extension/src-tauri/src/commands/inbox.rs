//! The tracker's own notification inbox, including replying to a message from the Owner.

use std::sync::Arc;

use crate::run_blocking;
use crate::AppState;

#[tauri::command]
pub async fn get_agent_notifications(
    state: tauri::State<'_, AppState>,
) -> Result<crate::types::AgentNotificationList, String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || controller.get_agent_notifications()).await
}

#[tauri::command]
pub async fn reply_to_message_thread(
    state: tauri::State<'_, AppState>,
    thread_id: String,
    body: String,
) -> Result<(), String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || controller.reply_to_message_thread(&thread_id, &body)).await
}

#[tauri::command]
pub async fn mark_agent_notification_read(
    state: tauri::State<'_, AppState>,
    notification_id: String,
) -> Result<(), String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || controller.mark_agent_notification_read(&notification_id)).await
}

#[tauri::command]
pub async fn mark_all_agent_notifications_read(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || controller.mark_all_agent_notifications_read()).await
}
