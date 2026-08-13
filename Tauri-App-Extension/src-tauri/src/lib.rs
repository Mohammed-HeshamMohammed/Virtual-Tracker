mod agent;
mod auth;
mod capture;
mod client;
mod config;
mod constants;
mod prefs;
mod queue;
#[cfg(test)]
mod test_support;
mod types;
mod util;

use std::sync::Arc;

use tauri::{AppHandle, Manager, WindowEvent};
// tray-icon is a non-Linux-only Cargo feature (see Cargo.toml) - these types
// don't exist in the dependency graph at all when building for Linux.
#[cfg(not(target_os = "linux"))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_deep_link::DeepLinkExt;

use crate::agent::controller::AgentController;
use crate::config::Settings;
use crate::constants::APP_VERSION;
use crate::prefs::UserPreferences;
use crate::types::{
    ActionResult, AgentTask, ConnectionState, LinkStatus, ProfileInfo, ReconnectResult, SessionInfo,
    SignInResult,
};

struct AppState {
    controller: Arc<AgentController>,
}

// Commands that touch the network are declared `#[tauri::command(async)]`.
// A plain `#[tauri::command]` on a non-async fn runs on the main thread, so a
// single blocking HTTP call (15s timeout, 30s for event POSTs, and both can
// queue behind the same ApiClient mutex the tracker holds) freezes the window
// - which is what "Not responding" after a fullscreen game or a sleep/wake
// actually was. Only the commands below that genuinely stay on the main thread
// (window operations) or touch no network are left synchronous.
//
// Marking a command `async` only changes *where* it runs (Tauri dispatches it
// via `async_runtime::spawn`, off the main thread) - it does NOT make blocking
// calls inside it safe. A plain synchronous body run that way still executes
// directly on a tokio worker thread, and this app's blocking `reqwest`
// calls panic there ("Cannot drop a runtime in a context where blocking is
// not allowed") - the same class of crash for every command below that
// touches the network. `run_blocking` is what actually fixes it: it hands the
// blocking body to `spawn_blocking`, tokio's dedicated pool where blocking is
// the expected case.
async fn run_blocking<T, F>(f: F) -> T
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .expect("blocking command task panicked")
}

/// `hint` is an optional `key=value` query pair forwarded to the browser link
/// page - `"provider=google"`/`"provider=apple"` for social sign-in,
/// `"mode=signup"`/`"mode=forgot-password"` for account creation and
/// password reset. All three still link this device, unlike the old
/// plain-`open_web_app` buttons they replace.
// Tauri requires an async command taking a reference input (`State`) to
// return `Result` - these never actually fail at the Rust level (failure is
// already a field inside the returned value), so every `Err` arm below is
// unreachable in practice; `Ok(...)` is just satisfying that constraint.
#[tauri::command]
async fn sign_in(state: tauri::State<'_, AppState>, hint: Option<String>) -> Result<SignInResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.open_sign_in(hint.as_deref())).await)
}

/// In-app email/password sign-in, no browser round-trip. The password is
/// passed straight through to the sign-in call and is never persisted.
#[tauri::command]
async fn sign_in_with_password(
    state: tauri::State<'_, AppState>,
    email: String,
    password: String,
) -> Result<SignInResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.sign_in_with_password(&email, &password)).await)
}

/// In-app account creation, no browser round-trip.
#[tauri::command]
async fn sign_up(
    state: tauri::State<'_, AppState>,
    email: String,
    password: String,
    first_name: String,
    last_name: String,
    phone: String,
) -> Result<SignInResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.sign_up(&email, &password, &first_name, &last_name, &phone)).await)
}

/// In-app "forgot password" request, no browser round-trip.
#[tauri::command]
async fn send_password_reset(
    state: tauri::State<'_, AppState>,
    email: String,
) -> Result<SignInResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.request_password_reset(&email)).await)
}

/// Distinct from sign_in/"Re-link account": ends the session and clears
/// tokens, but does not start a new browser link flow afterward.
#[tauri::command]
async fn sign_out(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.sign_out()).await)
}

#[tauri::command]
fn open_web_app(state: tauri::State<'_, AppState>) {
    state.controller.open_web_app();
}

#[tauri::command]
fn minimize_current(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// With "Keep running in tray" on (the default), the titlebar close button
/// only hides the window - tracking keeps running and the tray's Quit item is
/// the real exit. With it off, closing quits, same as before.
/// Stays synchronous: window operations must run on the main thread.
#[tauri::command]
fn close_window(
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
async fn get_link_status(state: tauri::State<'_, AppState>) -> Result<LinkStatus, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_link_status()).await)
}

#[tauri::command]
fn get_app_settings(state: tauri::State<'_, AppState>) -> crate::prefs::AppSettingsView {
    state.controller.get_app_settings()
}

#[tauri::command]
async fn open_log_file(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || controller.open_log_file()).await
}

#[tauri::command]
fn save_preferences(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    preferences: UserPreferences,
) -> Result<crate::prefs::AppSettingsView, String> {
    state.controller.save_preferences(preferences.clone())?;
    // Autostart registration is best-effort here, same as every other caller
    // of apply_autostart (see lines below) - a registry/OS failure must not
    // report the whole save as failed when the preference itself was already
    // written to disk successfully.
    if let Err(err) = apply_autostart(&app, preferences.launch_at_login) {
        log::warn!("Could not update autostart registration: {err}");
    }
    Ok(state.controller.get_app_settings())
}

#[tauri::command]
async fn list_projects(state: tauri::State<'_, AppState>) -> Result<Vec<crate::types::ProjectInfo>, String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || controller.list_projects()).await
}

#[tauri::command]
async fn list_tasks(
    state: tauri::State<'_, AppState>,
    project_id: Option<String>,
) -> Result<Vec<AgentTask>, String> {
    let controller = Arc::clone(&state.controller);
    run_blocking(move || controller.list_tasks(project_id.as_deref())).await
}

#[tauri::command]
async fn get_session(state: tauri::State<'_, AppState>) -> Result<SessionInfo, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_session()).await)
}

#[tauri::command]
async fn get_task_time_tracking(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<Option<crate::types::TaskTimeTracking>, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_task_time_tracking(&task_id)).await)
}

#[tauri::command]
async fn get_member_limits(state: tauri::State<'_, AppState>) -> Result<Option<crate::types::MemberLimits>, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_member_limits()).await)
}

#[tauri::command]
async fn get_project_budget_status(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<Option<crate::types::ProjectBudgetStatus>, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_project_budget_status(&project_id)).await)
}

#[tauri::command]
async fn get_member_profile(state: tauri::State<'_, AppState>) -> Result<Option<crate::types::MemberProfile>, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_member_profile()).await)
}

#[tauri::command]
async fn start_task_session(state: tauri::State<'_, AppState>, task_id: String) -> Result<ActionResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.start_task_session(&task_id)).await)
}

#[tauri::command]
async fn get_monitoring_notice(state: tauri::State<'_, AppState>) -> Result<Option<crate::types::MonitoringNoticeView>, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_monitoring_notice()).await)
}

#[tauri::command]
async fn acknowledge_monitoring_notice(state: tauri::State<'_, AppState>, notice_version: String) -> Result<bool, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.acknowledge_monitoring_notice(&notice_version)).await)
}

#[tauri::command]
async fn get_connection_state(state: tauri::State<'_, AppState>) -> Result<ConnectionState, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.get_connection_state()).await)
}

#[tauri::command]
async fn reconnect(state: tauri::State<'_, AppState>) -> Result<ReconnectResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.reconnect()).await)
}

#[tauri::command]
async fn start_project_session(state: tauri::State<'_, AppState>, project_id: String) -> Result<ActionResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.start_project_session(&project_id)).await)
}

#[tauri::command]
async fn stop_session(state: tauri::State<'_, AppState>) -> Result<ActionResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.stop_session()).await)
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

/// Shown when the agent can't even build its HTTP client (broken local
/// TLS/cert store) - this happens before any Tauri window exists, and
/// release builds hide the console (`main.rs`'s `windows_subsystem`
/// attribute), so without this the failure would be invisible outside the
/// log file. Reuses the same wide-string WinAPI pattern
/// `util::open_system_browser` already uses elsewhere in this codebase.
#[cfg(windows)]
fn show_startup_error(message: &str) {
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let text = to_wide(&format!(
        "Virtual Tracker could not start:\n\n{message}\n\nCheck the agent log for details."
    ));
    let caption = to_wide("Virtual Tracker");
    unsafe {
        let _ = MessageBoxW(None, PCWSTR(text.as_ptr()), PCWSTR(caption.as_ptr()), MB_OK | MB_ICONERROR);
    }
}

#[cfg(not(windows))]
fn show_startup_error(_message: &str) {}

/// Shown the first time the window is hidden to the tray in a given install,
/// whichever path gets there first - startup with `start_hidden` on, or the
/// close button with "keep running in tray" on. Without this a user who has
/// never seen the tray icon assumes the app failed to open. Reuses the same
/// WinAPI pattern as `show_startup_error`; a no-op elsewhere is an accepted
/// gap rather than a new cross-platform notification dependency.
#[cfg(windows)]
fn show_tray_hidden_notice() {
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONINFORMATION, MB_OK};

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let text = to_wide("Virtual Tracker is still running.\n\nClick the tray icon to reopen it.");
    let caption = to_wide("Virtual Tracker");
    unsafe {
        let _ = MessageBoxW(None, PCWSTR(text.as_ptr()), PCWSTR(caption.as_ptr()), MB_OK | MB_ICONINFORMATION);
    }
}

#[cfg(not(windows))]
fn show_tray_hidden_notice() {}

/// Shows the one-time "still running" notice and flags it shown, exactly once
/// per install - re-reads preferences fresh rather than trusting a value
/// captured at startup, since the close-button path can fire long after.
fn notify_hidden_to_tray_once(controller: &Arc<AgentController>) {
    let mut prefs = controller.get_app_settings().preferences;
    if prefs.tray_notice_shown {
        return;
    }
    prefs.tray_notice_shown = true;
    let _ = controller.save_preferences(prefs);
    show_tray_hidden_notice();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    let settings = Settings::load();
    let prefs = settings.preferences_store().load();
    let start_hidden = prefs.start_hidden;
    let launch_at_login = prefs.launch_at_login;
    let has_launched_before = prefs.has_launched_before;
    let controller = match AgentController::new(settings) {
        Ok(controller) => controller,
        Err(err) => {
            log::error!("Failed to initialize agent controller: {err}");
            show_startup_error(&err);
            return;
        }
    };

    // Taken before `.setup()` moves `controller` wholesale into its closure.
    let exit_controller = Arc::clone(&controller);

    tauri::Builder::default()
        // Must be registered first: a second launch hits this instead of running
        // its own app, so only one copy of the agent is ever tracking at once.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        // Must come right after single-instance: that's what forwards the
        // virtualtracker:// URL a Windows/Linux second-instance launch was
        // spawned with into this plugin's on_open_url listener below.
        .plugin(tauri_plugin_deep_link::init())
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
            sign_in_with_password,
            sign_up,
            send_password_reset,
            sign_out,
            open_web_app,
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
            get_member_limits,
            get_project_budget_status,
            get_member_profile,
            start_task_session,
            get_monitoring_notice,
            acknowledge_monitoring_notice,
            start_project_session,
            get_connection_state,
            reconnect,
            stop_session,
        ])
        .setup(move |app| {
            // Dev builds and Linux have no installer to write the OS-level
            // scheme registration, so the plugin has to do it at runtime.
            // Release Windows/macOS builds get it from the NSIS/Info.plist
            // step the `deep-link` config in tauri.conf.json feeds into.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                let _ = app.deep_link().register_all();
            }

            // The browser tab that finishes a Google/Apple/email link (see
            // `AgentLinkFlow::start`) navigates to virtualtracker://link-complete
            // once it's done. Credentials themselves already arrive via the
            // existing poll/loopback exchange - this only brings the agent
            // window to the front so the user isn't left staring at the browser.
            let deep_link_handle = app.handle().clone();
            app.deep_link().on_open_url(move |_event| {
                show_main_window(&deep_link_handle);
            });

            let handle = app.handle().clone();
            let status_controller = Arc::clone(&controller);
            status_controller.add_status_listener(Arc::new(move |text| {
                if let Some(window) = handle.get_webview_window("main") {
                    // JSON string escaping is a strict subset of valid JS string-literal
                    // escaping, so the serialized value can be embedded directly - handles
                    // quotes, backslashes, and control chars a hand-rolled replace() would miss.
                    if let Ok(json) = serde_json::to_string(&text) {
                        let _ = window.eval(format!(
                            "window.dispatchEvent(new CustomEvent('vt-status', {{ detail: {json} }}));"
                        ));
                    }
                }
            }));

            // Same wiring as vt-status above, on its own event - warnings are
            // the rarer, user-actionable case (e.g. a broken OS credential
            // store) that's meant to surface as a toast, not folded into the
            // routine status stream every view already refetches on.
            let warning_handle = app.handle().clone();
            let warning_controller = Arc::clone(&controller);
            warning_controller.add_warning_listener(Arc::new(move |text| {
                if let Some(window) = warning_handle.get_webview_window("main") {
                    if let Ok(json) = serde_json::to_string(&text) {
                        let _ = window.eval(format!(
                            "window.dispatchEvent(new CustomEvent('vt-warning', {{ detail: {json} }}));"
                        ));
                    }
                }
            }));

            // P10 - forward the raw "changed"/"scope-changed" frame text as-is;
            // it's already JSON, so no re-serialization needed (it's not a Rust
            // string being embedded, it's the literal JSON payload).
            let live_sync_handle = app.handle().clone();
            let live_sync_controller = Arc::clone(&controller);
            live_sync_controller.add_live_sync_listener(Arc::new(move |frame_json: String| {
                if let Some(window) = live_sync_handle.get_webview_window("main") {
                    let _ = window.eval(format!(
                        "window.dispatchEvent(new CustomEvent('vt-live-changed', {{ detail: {frame_json} }}));"
                    ));
                }
            }));

            let _ = apply_autostart(app.handle(), launch_at_login);

            controller.start();
            controller.maybe_auto_sign_in();

            // No tray icon on Linux: see the Cargo.toml comment on the `tauri`
            // dependency for why (RUSTSEC-2024-0429, accepted risk documented
            // in release.yml). "Keep running in tray" still works the same on
            // Linux via the window-hide branch below - there's just no tray
            // click to bring it back; the single-instance relaunch (see the
            // `tauri_plugin_single_instance` registration above) is the way
            // back in on that platform instead.
            #[cfg(not(target_os = "linux"))]
            {
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
                            let _ = tray_controller.open_sign_in(None);
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
            }

            if let Some(window) = app.get_webview_window("main") {
                let win = window.clone();
                let close_controller = Arc::clone(&controller);
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        // Always prevent the default close - either path below
                        // handles the window itself.
                        api.prevent_close();
                        if close_controller.close_to_tray() {
                            let _ = win.hide();
                            notify_hidden_to_tray_once(&close_controller);
                            return;
                        }
                        close_controller.stop();
                        win.app_handle().exit(0);
                    }
                });
                // A first run always shows the window - the user has never
                // seen the tray icon yet and has no reason to look for it.
                if start_hidden && has_launched_before {
                    let _ = window.hide();
                    notify_hidden_to_tray_once(&controller);
                }
                if !has_launched_before {
                    let mut updated = controller.get_app_settings().preferences;
                    updated.has_launched_before = true;
                    let _ = controller.save_preferences(updated);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            // PS-3: flushes the same way an explicit quit/tray-quit already
            // does (controller.stop() -> flush_and_stop_tracker), but on
            // tauri::RunEvent::Exit specifically - which Tauri's event loop
            // emits both for an explicit app.exit() *and* an OS-initiated
            // shutdown/logoff (WM_QUERYENDSESSION on Windows), unlike the
            // window-level CloseRequested handler above, which only ever
            // fires for a user closing the window. Turns an OS shutdown mid-
            // session into a clean stop instead of the unclean-exit case
            // PS-1/PS-2 exist to recover from. Harmless to call twice (an
            // explicit quit already called stop(); this just no-ops on the
            // second call since the tracker's already stopped).
            if let tauri::RunEvent::Exit = event {
                exit_controller.stop();
            }
        });
}
