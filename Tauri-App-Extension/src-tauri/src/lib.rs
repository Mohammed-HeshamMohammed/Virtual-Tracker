mod agent;
mod auth;
mod capture;
mod client;
mod config;
mod constants;
mod prefs;
mod queue;
mod types;
mod util;

use std::sync::Arc;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

use crate::agent::controller::AgentController;
use crate::config::Settings;
use crate::constants::APP_VERSION;
use crate::prefs::UserPreferences;
use crate::types::{
    ActionResult, AgentTask, LinkStatus, ProfileInfo, SessionInfo, SignInResult,
};

struct AppState {
    controller: Arc<AgentController>,
}

#[tauri::command]
fn sign_in(state: tauri::State<'_, AppState>) -> SignInResult {
    state.controller.open_sign_in()
}

#[tauri::command]
fn open_web_app(state: tauri::State<'_, AppState>) {
    state.controller.open_web_app();
}

#[tauri::command]
fn minimize_window(app: AppHandle) -> Result<(), String> {
    let label = app
        .webview_windows()
        .keys()
        .next()
        .cloned()
        .unwrap_or_else(|| "main".into());
    // Prefer focused window; fall back to main.
    if let Some(window) = app.get_webview_window("main") {
        let _ = label;
        window.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn minimize_current(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// The titlebar close button quits the whole app, same as the tray's Quit item -
/// not a hide-to-tray anymore.
#[tauri::command]
fn close_window(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.controller.stop();
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn get_status(state: tauri::State<'_, AppState>) -> String {
    state.controller.status()
}

#[tauri::command]
fn get_version() -> String {
    APP_VERSION.to_string()
}

#[tauri::command]
fn get_profile(state: tauri::State<'_, AppState>) -> ProfileInfo {
    state.controller.get_profile()
}

#[tauri::command]
fn get_link_status(state: tauri::State<'_, AppState>) -> LinkStatus {
    state.controller.get_link_status()
}

#[tauri::command]
fn get_app_settings(state: tauri::State<'_, AppState>) -> crate::prefs::AppSettingsView {
    state.controller.get_app_settings()
}

#[tauri::command]
fn open_log_file(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.controller.open_log_file()
}

#[tauri::command]
fn save_preferences(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    preferences: UserPreferences,
) -> Result<crate::prefs::AppSettingsView, String> {
    state.controller.save_preferences(preferences.clone())?;
    apply_autostart(&app, preferences.launch_at_login)?;
    Ok(state.controller.get_app_settings())
}

#[tauri::command]
fn list_projects(state: tauri::State<'_, AppState>) -> Result<Vec<crate::types::ProjectInfo>, String> {
    state.controller.list_projects()
}

#[tauri::command]
fn list_tasks(
    state: tauri::State<'_, AppState>,
    project_id: Option<String>,
) -> Result<Vec<AgentTask>, String> {
    state.controller.list_tasks(project_id.as_deref())
}

#[tauri::command]
fn get_session(state: tauri::State<'_, AppState>) -> SessionInfo {
    state.controller.get_session()
}

#[tauri::command]
fn get_task_time_tracking(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Option<crate::types::TaskTimeTracking> {
    state.controller.get_task_time_tracking(&task_id)
}

#[tauri::command]
fn start_task_session(state: tauri::State<'_, AppState>, task_id: String) -> ActionResult {
    state.controller.start_task_session(&task_id)
}

#[tauri::command]
fn stop_session(state: tauri::State<'_, AppState>) -> ActionResult {
    state.controller.stop_session()
}

fn apply_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let autostart = app.autolaunch();
    let currently = autostart.is_enabled().unwrap_or(false);
    if enabled && !currently {
        autostart.enable().map_err(|e| e.to_string())?;
    } else if !enabled && currently {
        autostart.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Installed builds run with no attached console, so stderr-only logging (the
/// env_logger default) is invisible — nobody could ever see why a screenshot
/// or URL upload failed. Logs to a file next to the other agent state
/// (agent-store.json etc), and still echoes to stderr for `cargo run`/dev use.
struct TeeWriter {
    file: std::fs::File,
}

impl std::io::Write for TeeWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let _ = std::io::stderr().write_all(buf);
        self.file.write_all(buf)?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        let _ = std::io::stderr().flush();
        self.file.flush()
    }
}

fn init_logging() {
    let data_dir = crate::config::app_data_dir(&crate::config::project_root());
    let _ = std::fs::create_dir_all(&data_dir);
    let log_path = data_dir.join("agent.log");

    // Cap growth — this is a rolling diagnostic log, not an audit trail.
    if let Ok(meta) = std::fs::metadata(&log_path) {
        if meta.len() > 5 * 1024 * 1024 {
            let _ = std::fs::remove_file(&log_path);
        }
    }

    let mut builder = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"));
    if let Ok(file) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        builder.target(env_logger::Target::Pipe(Box::new(TeeWriter { file })));
    }
    let _ = builder.try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    let settings = Settings::load();
    let prefs = settings.preferences_store().load();
    let start_hidden = prefs.start_hidden;
    let launch_at_login = prefs.launch_at_login;
    let controller = AgentController::new(settings);

    tauri::Builder::default()
        // Must be registered first: a second launch hits this instead of running
        // its own app, so only one copy of the agent is ever tracking at once.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            controller: Arc::clone(&controller),
        })
        .invoke_handler(tauri::generate_handler![
            sign_in,
            open_web_app,
            minimize_window,
            minimize_current,
            close_window,
            get_status,
            get_version,
            get_profile,
            get_link_status,
            get_app_settings,
            open_log_file,
            save_preferences,
            list_projects,
            list_tasks,
            get_session,
            get_task_time_tracking,
            start_task_session,
            stop_session,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let status_controller = Arc::clone(&controller);
            status_controller.add_status_listener(Arc::new(move |text| {
                if let Some(window) = handle.get_webview_window("main") {
                    let safe = text.replace('\\', "\\\\").replace('\'', "\\'");
                    let _ = window.eval(&format!(
                        "window.dispatchEvent(new CustomEvent('vt-status', {{ detail: '{safe}' }}));"
                    ));
                }
            }));

            let _ = apply_autostart(app.handle(), launch_at_login);

            controller.start();
            controller.maybe_auto_sign_in();

            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let sign_in_i = MenuItem::with_id(app, "sign_in", "Sign in", true, None::<&str>)?;
            let open_i =
                MenuItem::with_id(app, "open", "Open Virtual Tracker", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &sign_in_i, &open_i, &quit_i])?;

            let tray_controller = Arc::clone(&controller);
            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Virtual Tracker Agent")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "sign_in" => {
                        let _ = tray_controller.open_sign_in();
                    }
                    "open" => tray_controller.open_web_app(),
                    "quit" => {
                        tray_controller.stop();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            let _tray = tray_builder.build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let win = window.clone();
                let close_controller = Arc::clone(&controller);
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        close_controller.stop();
                        win.app_handle().exit(0);
                    }
                });
                if start_hidden {
                    let _ = window.hide();
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
