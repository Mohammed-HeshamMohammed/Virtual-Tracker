//! What the app knows about itself and the signed-in member - version, update readiness,
//! profile, preferences, connection state.

use std::sync::Arc;

use crate::run_blocking;
use crate::AppState;
use tauri::Manager;
use crate::types::{ConnectionState, LinkStatus, ProfileInfo, ReconnectResult, UpdateInstallReadiness};
use tauri::AppHandle;
use crate::APP_VERSION;
use crate::apply_autostart;
use crate::window_layout;
use crate::prefs::UserPreferences;

#[tauri::command]
pub fn get_version() -> String {
    APP_VERSION.to_string()
}

/// Whether applying an update would need an administrator prompt.
#[tauri::command]
pub fn update_install_readiness() -> UpdateInstallReadiness {
    crate::update_readiness::probe()
}

#[tauri::command]
pub async fn report_agent_open(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || controller.report_agent_open()).await
}

#[tauri::command]
pub fn get_profile(state: tauri::State<'_, AppState>) -> ProfileInfo {
    state.controller.get_profile()
}

#[tauri::command]
pub async fn get_link_status(state: tauri::State<'_, AppState>) -> Result<LinkStatus, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_link_status()).await)
}

#[tauri::command]
pub fn get_app_settings(app: AppHandle, state: tauri::State<'_, AppState>) -> crate::prefs::AppSettingsView {
    let mut view = state.controller.get_app_settings();
    // The stored preference records what the member asked for; this reports
    // what is actually registered. They diverge whenever registration was
    // refused, and showing the request back as though it had succeeded is how
    // "Start at login" looked switched on for machines it had never started.
    //
    // Either mechanism counts: apply_autostart falls back to the Run key when
    // the scheduled task cannot be registered, and checking only the task
    // would report those machines as off while they do start.
    #[cfg(windows)]
    {
        use tauri_plugin_autostart::ManagerExt;
        view.preferences.launch_at_login =
            crate::autostart_task::is_enabled() || app.autolaunch().is_enabled().unwrap_or(false);
    }
    #[cfg(not(windows))]
    let _ = app;
    view
}

#[tauri::command]
pub fn save_preferences(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    preferences: UserPreferences,
) -> Result<crate::prefs::AppSettingsView, String> {
    let previous = state.controller.get_app_settings().preferences;
    state.controller.save_preferences(preferences.clone())?;
    // Only the two settings that decide the window's size move it - saving anything else
    // must not resize it or snap it back to the centre.
    if previous.layout != preferences.layout || previous.show_insights != preferences.show_insights {
        if let Some(window) = app.get_webview_window("main") {
            window_layout::apply(&window, &preferences.layout, preferences.show_insights, true);
        }
    }
    // Autostart registration is best-effort here, same as every other caller of
    // apply_autostart (see lines below) - a registry/OS failure must not report the whole
    if let Err(err) = apply_autostart(&app, preferences.launch_at_login) {
        log::warn!("Could not update autostart registration: {err}");
    }
    Ok(state.controller.get_app_settings())
}

#[tauri::command]
pub async fn get_member_profile(state: tauri::State<'_, AppState>) -> Result<Option<crate::types::MemberProfile>, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_member_profile()).await)
}

#[tauri::command]
pub async fn set_member_timezone(state: tauri::State<'_, AppState>, timezone: String) -> Result<(), String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || controller.set_member_timezone(&timezone)).await
}

#[tauri::command]
pub async fn get_connection_state(state: tauri::State<'_, AppState>) -> Result<ConnectionState, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_connection_state()).await)
}

#[tauri::command]
pub async fn reconnect(state: tauri::State<'_, AppState>) -> Result<ReconnectResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.reconnect()).await)
}

#[cfg(test)]
mod tests {
    /// The probe must answer for the directory the app actually runs from, and must answer
    /// *something* rather than panicking - an update decision that throws is an update that
    #[test]
    fn update_install_readiness_reports_the_real_install_directory() {
        let readiness = super::update_install_readiness();
        assert!(
            !readiness.install_dir.is_empty(),
            "the install directory must be reported so a blocked update can name it"
        );
        // The test binary's own directory is writable, so this is the "installs silently"
        // answer.
        assert!(readiness.writable);
    }
}
