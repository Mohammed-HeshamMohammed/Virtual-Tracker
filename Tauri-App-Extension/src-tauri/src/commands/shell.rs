//! Window, tray and log-file commands.

use std::sync::Arc;

use crate::run_blocking;
use crate::AppState;
use tauri::Manager;
use tauri::AppHandle;
use crate::window_layout;

#[tauri::command]
pub fn open_web_app(state: tauri::State<'_, AppState>) {
    state.controller.open_web_app();
}

#[tauri::command]
pub fn minimize_current(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// With "Keep running in tray" on (the default), the titlebar close button only hides the
/// window - tracking keeps running and the tray's Quit item is the real exit.
#[tauri::command]
pub fn close_window(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if state.controller.close_to_tray() {
        window.hide().map_err(|e| e.to_string())?;
        return Ok(());
    }
    state.controller.stop();
    app.exit(0);
    Ok(())
}

/// Pushed from the frontend's own existing 5s session poll (App.tsx's effect) rather than
/// driven by a second poller here. The tray menu window (tray_menu.rs) renders from it.
#[tauri::command]
pub fn set_tray_status(
    app: AppHandle,
    label: String,
    tracking: bool,
    paused: bool,
    session_open: bool,
    signed_in: bool,
) {
    crate::tray_menu::set_state(
        &app,
        crate::tray_menu::TrayState { label, tracking, paused, session_open, signed_in },
    );
}

/// The layout the window is using, so the frontend can arrange itself to match the size the
/// window was given.
#[tauri::command]
pub fn get_window_layout(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> window_layout::WindowLayout {
    let prefs = state.controller.get_app_settings().preferences;
    match app.get_webview_window("main") {
        Some(window) => window_layout::current(&window, &prefs.layout, prefs.show_insights),
        None => window_layout::resolve(&prefs.layout, prefs.show_insights, None),
    }
}

#[tauri::command]
pub async fn open_log_file(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || controller.open_log_file()).await
}
