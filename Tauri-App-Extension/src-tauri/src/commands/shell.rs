//! Window, tray and log-file commands. These stay synchronous: they are
//! main-thread UI calls, not network I/O, so `run_blocking` would only add a
//! hop.

use std::sync::Arc;

use crate::run_blocking;
use crate::AppState;
use tauri::Manager;
use tauri::AppHandle;
use crate::TrayStatusState;
use crate::window_layout;

#[tauri::command]
pub fn open_web_app(state: tauri::State<'_, AppState>) {
    state.controller.open_web_app();
}

#[tauri::command]
pub fn minimize_current(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// With "Keep running in tray" on (the default), the titlebar close button
/// only hides the window - tracking keeps running and the tray's Quit item is
/// the real exit. With it off, closing quits, same as before.
/// Stays synchronous: window operations must run on the main thread.
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

/// Pushed from the frontend's own existing 5s session poll (App.tsx's
/// refresh()) rather than driven by a second poller here - see
/// TrayStatusItems's own doc comment for why. A no-op before the tray
/// finishes building (brief startup window) or on Linux (no tray at all).
/// Stays synchronous: MenuItem::set_text/set_enabled are main-thread UI
/// calls, not network I/O - nothing here needs run_blocking.
#[tauri::command]
#[cfg(not(target_os = "linux"))]
pub fn set_tray_status(
    state: tauri::State<'_, TrayStatusState>,
    label: String,
    tracking: bool,
    paused: bool,
    session_open: bool,
) {
    let guard = state.lock().unwrap();
    let Some(items) = guard.as_ref() else { return };
    let _ = items.status.set_text(&label);
    let _ = items.pause.set_enabled(tracking);
    let _ = items.resume.set_enabled(paused);
    let _ = items.stop.set_enabled(session_open);
}

#[tauri::command]
#[cfg(target_os = "linux")]
pub fn set_tray_status(_label: String, _tracking: bool, _paused: bool, _session_open: bool) {}

/// The layout the window is using, so the frontend can arrange itself to
/// match the size the window was given.
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
