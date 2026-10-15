mod agent;
mod auth;
mod capture;
mod client;
mod config;
mod constants;
mod buzz;
mod notify;
mod mini_mode;
mod ui_watchdog;
mod power_events;
mod prefs;
mod queue;
mod tray_menu;
#[cfg(test)]
mod test_support;
mod types;
mod autostart_task;
mod update_readiness;
mod util;
mod window_layout;

use std::sync::Arc;

use tauri::{AppHandle, Manager, WindowEvent};
// Tray-icon is a non-Linux-only Cargo feature (see Cargo.toml) - these types don't exist in
// the dependency graph at all when building for Linux.
#[cfg(not(target_os = "linux"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_deep_link::DeepLinkExt;

use crate::agent::controller::AgentController;
use crate::config::Settings;
use crate::constants::APP_VERSION;


pub mod commands;

pub struct AppState {
    controller: Arc<AgentController>,
}

// Commands that touch the network are declared `#[tauri::command(async)]`.
pub(crate) async fn run_blocking<T, F>(f: F) -> T
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .expect("blocking command task panicked")
}




















































/// What the app was called before it became My Virtual Tracker.
const LEGACY_PRODUCT_NAME: &str = "Virtual Tracker Agent";

/// Removes the start-at-login entry registered under the old product name.
fn remove_legacy_autostart(app: &AppHandle) {
    if app.package_info().name == LEGACY_PRODUCT_NAME {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let mut builder = auto_launch::AutoLaunchBuilder::new();
    builder.set_app_name(LEGACY_PRODUCT_NAME);
    builder.set_app_path(&exe.display().to_string());
    #[cfg(target_os = "macos")]
    builder.set_use_launch_agent(true);
    if let Ok(entry) = builder.build() {
        if entry.disable().is_ok() {
            log::info!("Removed the start-at-login entry left under the name {LEGACY_PRODUCT_NAME}");
        }
    }
}

/// On Windows this prefers a scheduled task over the Run key, because a Run
/// entry cannot start a requireAdministrator binary at all - see
/// autostart_task.rs. The Run key is still cleared or written as a fallback,
/// so a machine where task registration is refused ends up no worse off than
/// before rather than with no autostart at all.
pub(crate) fn apply_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let autostart = app.autolaunch();

    #[cfg(windows)]
    {
        let task_result = if enabled { autostart_task::enable() } else { autostart_task::disable() };
        match task_result {
            Ok(()) => {
                // The Run entry is dead weight once the task exists: it shows
                // in Task Manager's Startup tab as an app that never starts.
                if autostart.is_enabled().unwrap_or(false) {
                    let _ = autostart.disable();
                }
                return Ok(());
            }
            Err(err) => {
                log::warn!("[autostart] scheduled task unavailable, falling back to the Run key: {err}");
            }
        }
    }

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

/// Installed builds run with no attached console, so stderr-only logging (the env_logger
/// default) is invisible — nobody could ever see why a screenshot or URL upload failed.
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

    // Cap growth - this is a rolling diagnostic log, not an audit trail. The
    // oversized file is kept as agent.log.1 rather than deleted: it reaches
    // the cap by something going repeatedly wrong, so discarding it outright
    // threw away the evidence at precisely the moment it became interesting.
    //
    // Only checked at startup, which is enough while the cap is the only
    // concern: a long-running agent is bounded by how much it can say, and
    // what it was saying 5 MB of is the thing worth fixing instead.
    if let Ok(meta) = std::fs::metadata(&log_path) {
        if meta.len() > 5 * 1024 * 1024 {
            let previous = log_path.with_extension("log.1");
            if std::fs::rename(&log_path, &previous).is_err() {
                let _ = std::fs::remove_file(&log_path);
            }
        }
    }

    let mut builder = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"));
    if let Ok(file) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        builder.target(env_logger::Target::Pipe(Box::new(TeeWriter { file })));
    }
    let _ = builder.try_init();
}

/// Shown when the agent can't even build its HTTP client (broken local TLS/cert store)
#[cfg(windows)]
fn show_startup_error(message: &str) {
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let text = to_wide(&format!(
        "My Virtual Tracker could not start:\n\n{message}\n\nCheck the agent log for details."
    ));
    let caption = to_wide("My Virtual Tracker");
    unsafe {
        let _ = MessageBoxW(None, PCWSTR(text.as_ptr()), PCWSTR(caption.as_ptr()), MB_OK | MB_ICONERROR);
    }
}

#[cfg(not(windows))]
fn show_startup_error(_message: &str) {}

/// Shown the first time the window is hidden to the tray in a given install, whichever path
/// gets there first - startup with `start_hidden` on, or the close button with "keep
#[cfg(windows)]
fn show_tray_hidden_notice() {
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONINFORMATION, MB_OK};

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let text = to_wide("My Virtual Tracker is still running.\n\nClick the tray icon to reopen it.");
    let caption = to_wide("My Virtual Tracker");
    unsafe {
        let _ = MessageBoxW(None, PCWSTR(text.as_ptr()), PCWSTR(caption.as_ptr()), MB_OK | MB_ICONINFORMATION);
    }
}

#[cfg(not(windows))]
fn show_tray_hidden_notice() {}

/// Shows the one-time "still running" notice and flags it shown, exactly once per install -
/// re-reads preferences fresh rather than trusting a value captured at startup, since the
fn notify_hidden_to_tray_once(controller: &Arc<AgentController>) {
    let mut prefs = controller.get_app_settings().preferences;
    if prefs.tray_notice_shown {
        return;
    }
    prefs.tray_notice_shown = true;
    let _ = controller.save_preferences(prefs);
    show_tray_hidden_notice();
}

/// CommandOrControl+Shift+P - Pause/Resume toggle.
fn pause_resume_shortcut() -> tauri_plugin_global_shortcut::Shortcut {
    tauri_plugin_global_shortcut::Shortcut::new(
        Some(tauri_plugin_global_shortcut::Modifiers::SHIFT | tauri_plugin_global_shortcut::Modifiers::CONTROL),
        tauri_plugin_global_shortcut::Code::KeyP,
    )
}

/// CommandOrControl+Shift+X - Stop.
fn stop_shortcut() -> tauri_plugin_global_shortcut::Shortcut {
    tauri_plugin_global_shortcut::Shortcut::new(
        Some(tauri_plugin_global_shortcut::Modifiers::SHIFT | tauri_plugin_global_shortcut::Modifiers::CONTROL),
        tauri_plugin_global_shortcut::Code::KeyX,
    )
}

/// The one thing that confirms a global shortcut actually landed - it fires while some
/// other app is focused by definition, so there's no toast/tray label on screen to
/// notice otherwise. Best-effort: a notification failure here must never surface as if
/// the action itself failed.
fn notify_shortcut_action(app: &AppHandle, action: &str) {
    notify::show(app, "My Virtual Tracker", &format!("{action} tracking"));
}

/// The update feed this build asks. The legacy build (Windows 7, 8 and 8.1) has its own,
/// so it can never be handed a modern build, which would not start on those systems.
fn updater_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry, tauri_plugin_updater::Config> {
    let builder = tauri_plugin_updater::Builder::new();
    #[cfg(all(feature = "legacy-windows", not(feature = "modern")))]
    let builder = builder.target("windows-legacy");
    builder.build()
}

/// The legacy build (Windows 7, 8 and 8.1) ships its own WebView2 109 in a folder next to
/// the program (tauri.legacy.conf.json), because those systems cannot install one. Tauri is
/// meant to point WebView2 at it from that config, but the setting did not survive into the
/// optimised program, so it is done here as well: before any window exists, and only when the
/// folder is really there and nothing else has chosen a runtime.
#[cfg(all(windows, feature = "legacy-windows", not(feature = "modern")))]
fn use_bundled_webview2() {
    const FOLDER: &str = "webview2-fixed-runtime";
    if std::env::var_os("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER").is_some() {
        return;
    }
    let Some(dir) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|parent| parent.join(FOLDER))) else {
        return;
    };
    if dir.join("msedgewebview2.exe").is_file() {
        std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &dir);
    } else {
        log::error!("The bundled WebView2 is missing from {}", dir.display());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();
    #[cfg(all(windows, feature = "legacy-windows", not(feature = "modern")))]
    use_bundled_webview2();

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
    // Sleep and shutdown do not ask this process to exit, so they are heard separately and
    // close the session before the computer goes away.
    let power_controller = Arc::clone(&controller);
    power_events::watch(Arc::new(move |reason| power_controller.stop_for_power(reason)));
    // Same reason: the global-shortcut handler below is registered as part of the plugin
    // chain, before `.setup()` runs.
    let shortcut_controller = Arc::clone(&controller);

    let builder = tauri::Builder::default();
    // Windows 10/11 toasts; the legacy build shows its notifications itself (notify.rs).
    #[cfg(feature = "modern")]
    let builder = builder.plugin(tauri_plugin_notification::init());

    builder
        // Must be registered first: a second launch hits this instead of running its own
        // app, so only one copy of the agent is ever tracking at once.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        // Must come right after single-instance: that's what forwards the virtualtracker://
        // URL a Windows/Linux second-instance launch was spawned with into this plugin's
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(updater_plugin())
        .plugin(tauri_plugin_process::init())
        // System-wide, so Pause/Resume/Stop work while some other app is focused - the tray
        // menu (set_tray_status et al.) needs a click to even see, this needs neither.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        return;
                    }
                    if shortcut == &pause_resume_shortcut() {
                        let (action, result) = if shortcut_controller.is_session_paused() {
                            ("Resumed", shortcut_controller.resume_session())
                        } else {
                            ("Paused", shortcut_controller.pause_session())
                        };
                        if result.success {
                            notify_shortcut_action(app, action);
                        }
                    } else if shortcut == &stop_shortcut() {
                        let result = shortcut_controller.stop_session(None);
                        if result.success {
                            notify_shortcut_action(app, "Stopped");
                        }
                    }
                })
                .build(),
        )
        .manage(buzz::BuzzState::default())
        .manage(AppState {
            controller: Arc::clone(&controller),
        })
        .invoke_handler(tauri::generate_handler![
            notify::show_notification,
            client::api::report_local_timezone,
            commands::auth::sign_in,
            commands::auth::sign_in_with_password,
            commands::auth::sign_up,
            commands::auth::send_password_reset,
            commands::auth::sign_out,
            commands::shell::open_web_app,
            commands::shell::minimize_current,
            commands::shell::close_window,
            commands::app_info::get_version,
            commands::app_info::update_install_readiness,
            commands::app_info::report_agent_open,
            commands::inbox::get_agent_notifications,
            commands::inbox::mark_agent_notification_read,
            commands::inbox::reply_to_message_thread,
            commands::inbox::mark_all_agent_notifications_read,
            commands::shell::set_tray_status,
            tray_menu::get_tray_state,
            tray_menu::tray_menu_resize,
            tray_menu::tray_action,
            commands::app_info::get_profile,
            commands::app_info::get_link_status,
            commands::app_info::get_app_settings,
            commands::shell::get_window_layout,
            commands::shell::open_log_file,
            commands::app_info::save_preferences,
            commands::work::list_projects,
            commands::work::list_tasks,
            commands::work::create_task,
            commands::work::get_session,
            commands::work::get_task_time_tracking,
            commands::work::get_member_limits,
            commands::work::get_agent_workspace,
            commands::work::create_time_entry,
            commands::work::submit_timesheet,
            commands::work::request_time_off,
            commands::insights::get_my_screenshots,
            commands::insights::get_project_app_breakdown,
            commands::insights::get_screenshot_image,
            commands::work::get_task_detail,
            commands::work::get_project_budget_status,
            commands::app_info::get_member_profile,
            commands::app_info::set_member_timezone,
            commands::insights::get_dashboard_summary,
            commands::insights::set_private_break,
            commands::insights::list_capture_screens,
            commands::insights::capture_status,
            commands::insights::get_my_capture_summary,
            commands::insights::list_my_exclusions,
            commands::insights::add_my_exclusion,
            commands::insights::remove_my_exclusion,
            commands::work::start_task_session,
            commands::insights::get_monitoring_notice,
            commands::insights::acknowledge_monitoring_notice,
            commands::work::start_project_session,
            commands::app_info::get_connection_state,
            commands::app_info::reconnect,
            commands::work::stop_session,
            commands::work::pause_session,
            commands::work::resume_session,
            commands::work::is_session_paused,
            commands::work::start_break,
            buzz::buzz_take,
            buzz::buzz_dismiss,
            commands::work::is_session_on_break,
            ui_watchdog::ui_heartbeat,
            commands::shell::set_mini_mode,
        ])
        .setup(move |app| {
            // Registration is separate from the handler wired into the plugin above - the
            // handler fires for a shortcut whether or not it happens to be one of these
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                let _ = app.global_shortcut().register(pause_resume_shortcut());
                let _ = app.global_shortcut().register(stop_shortcut());
            }

            // Dev builds and Linux have no installer to write the OS-level scheme
            // registration, so the plugin has to do it at runtime.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                let _ = app.deep_link().register_all();
            }

            // The browser tab that finishes a Google/Apple/email link (see
            // `AgentLinkFlow::start`) navigates to virtualtracker://link-complete once it's
            let deep_link_handle = app.handle().clone();
            app.deep_link().on_open_url(move |_event| {
                show_main_window(&deep_link_handle);
            });

            let handle = app.handle().clone();
            let status_controller = Arc::clone(&controller);
            status_controller.add_status_listener(Arc::new(move |text| {
                // A break ending on its own (its time ran out, or a private break expired) is
                // announced the way a buzz is - on the desktop, not only inside the window.
                if text.starts_with("Break ended") {
                    buzz::show(
                        &handle,
                        buzz::Buzz::notice("Break is over", "Your timer is running again. Back to it!"),
                    );
                }
                if let Some(window) = handle.get_webview_window("main") {
                    // JSON string escaping is a strict subset of valid JS string-literal
                    // escaping, so the serialized value can be embedded directly - handles
                    if let Ok(json) = serde_json::to_string(&text) {
                        let _ = window.eval(format!(
                            "window.dispatchEvent(new CustomEvent('vt-status', {{ detail: {json} }}));"
                        ));
                    }
                }
            }));

            // Same wiring as vt-status above, on its own event - warnings are the rarer,
            // user-actionable case (e.g.
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

            // P10 - forward the raw "changed"/"scope-changed" frame text as-is; it's
            // already JSON, so no re-serialization needed (it's not a Rust string being
            let live_sync_handle = app.handle().clone();
            let live_sync_controller = Arc::clone(&controller);
            live_sync_controller.add_live_sync_listener(Arc::new(move |frame_json: String| {
                // A buzz is drawn in its own window, not handed to the page.
                if let Some(buzz) = buzz::parse(&frame_json) {
                    buzz::show(&live_sync_handle, buzz);
                    return;
                }
                if let Some(window) = live_sync_handle.get_webview_window("main") {
                    let _ = window.eval(format!(
                        "window.dispatchEvent(new CustomEvent('vt-live-changed', {{ detail: {frame_json} }}));"
                    ));
                }
            }));

            ui_watchdog::start(app.handle().clone());

            remove_legacy_autostart(app.handle());
            // Off the setup path: registering the scheduled task spawns
            // schtasks.exe, and setup() runs before the window is shown, so
            // doing it inline would hold the whole launch behind a subprocess
            // that has nothing to do with starting up.
            {
                let autostart_handle = app.handle().clone();
                std::thread::spawn(move || {
                    if let Err(err) = apply_autostart(&autostart_handle, launch_at_login) {
                        log::warn!("[autostart] could not apply the start-at-login setting: {err}");
                    }
                });
            }

            controller.start();
            controller.maybe_auto_sign_in();

            // No tray icon on Linux: see the Cargo.toml comment on the `tauri` dependency
            // for why (RUSTSEC-2024-0429, accepted risk documented in release.yml).
            #[cfg(not(target_os = "linux"))]
            {
                // Right-click opens our own menu window (tray_menu.rs) instead of the OS menu,
                // which cannot be styled; left-click still just shows the app.
                tray_menu::create(app.handle())?;

                let mut tray_builder = TrayIconBuilder::new()
                    .tooltip("My Virtual Tracker")
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button,
                            button_state: MouseButtonState::Up,
                            position,
                            ..
                        } = event
                        {
                            match button {
                                MouseButton::Left => show_main_window(tray.app_handle()),
                                MouseButton::Right => tray_menu::open_at(tray.app_handle(), position),
                                _ => {}
                            }
                        }
                    });
                if let Some(icon) = app.default_window_icon().cloned() {
                    tray_builder = tray_builder.icon(icon);
                }
                let _tray = tray_builder.build(app)?;
            }

            if let Some(window) = app.get_webview_window("main") {
                // Sized before anything is drawn, so a small screen never shows the
                // standard window running off its bottom edge.
                let layout_prefs = controller.get_app_settings().preferences;
                let layout = window_layout::apply(&window, &layout_prefs.layout, layout_prefs.show_insights, false);
                log::info!(
                    "Window layout: {:?} ({}x{}, side column {}, preference {})",
                    layout.kind,
                    layout.width,
                    layout.height,
                    layout.side_column,
                    layout_prefs.layout
                );

                let win = window.clone();
                let close_controller = Arc::clone(&controller);
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        // Always prevent the default close - either path below handles the
                        // window itself.
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
                // A first run always shows the window - the user has never seen the tray
                // icon yet and has no reason to look for it.
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
            // Flushes the same way an explicit quit/tray-quit already does
            // (controller.stop() -> flush_and_stop_tracker), but on tauri::RunEvent::Exit
            if let tauri::RunEvent::Exit = event {
                exit_controller.stop();
            }
        });
}

