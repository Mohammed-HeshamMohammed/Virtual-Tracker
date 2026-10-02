//! The tray icon's right-click menu.
//!
//! The operating system's own menu cannot be styled, so right-clicking the tray icon opens a
//! small frameless window instead, drawn by the same frontend as the rest of the app (see
//! `src/TrayMenu.tsx`). It is created once, hidden, at startup so the first click is instant,
//! and hides itself the moment it loses focus - which is what a native menu does when you
//! click anywhere else.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

use crate::{run_blocking, show_main_window, AppState};

pub const LABEL: &str = "tray-menu";

/// Logical width. Includes the transparent margin the card's drop shadow is drawn in.
const WIDTH: f64 = 264.0;
const DEFAULT_HEIGHT: f64 = 340.0;
const MIN_HEIGHT: f64 = 120.0;
const MAX_HEIGHT: f64 = 640.0;
/// Space left between the menu and the edge of the work area, in physical pixels.
const EDGE_GAP: f64 = 4.0;
/// Clicking the tray icon while the menu is open first takes focus away from the menu (which
/// hides it) and then delivers the click - without this the click would reopen it at once.
const REOPEN_GUARD: Duration = Duration::from_millis(300);

/// What the menu needs to show, pushed from the frontend's own session poll (App.tsx).
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayState {
    pub label: String,
    pub tracking: bool,
    pub paused: bool,
    pub session_open: bool,
    pub signed_in: bool,
}

struct Inner {
    state: TrayState,
    height: f64,
    cursor: Option<PhysicalPosition<f64>>,
    hidden_at: Option<Instant>,
}

pub struct TrayMenu {
    inner: Mutex<Inner>,
}

impl Default for TrayMenu {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                state: TrayState { label: "Not tracking".into(), ..TrayState::default() },
                height: DEFAULT_HEIGHT,
                cursor: None,
                hidden_at: None,
            }),
        }
    }
}

/// Creates the (hidden) menu window. Not called on Linux, which has no tray icon.
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    app.manage(TrayMenu::default());
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("My Virtual Tracker")
        .inner_size(WIDTH, DEFAULT_HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .build()?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            hide(&handle);
        }
    });
    Ok(())
}

pub fn hide(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    let _ = window.hide();
    if let Some(menu) = app.try_state::<TrayMenu>() {
        menu.inner.lock().unwrap().hidden_at = Some(Instant::now());
    }
}

/// Opens the menu next to where the tray icon was clicked.
pub fn open_at(app: &AppHandle, cursor: PhysicalPosition<f64>) {
    let Some(menu) = app.try_state::<TrayMenu>() else { return };
    let Some(window) = app.get_webview_window(LABEL) else { return };
    let height = {
        let mut inner = menu.inner.lock().unwrap();
        if inner.hidden_at.is_some_and(|at| at.elapsed() < REOPEN_GUARD) {
            return;
        }
        inner.cursor = Some(cursor);
        inner.height
    };
    place(app, &window, cursor, height);
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit_to(LABEL, "tray-opened", ());
}

/// Puts the window beside the click, kept inside the area the taskbar leaves free: above the
/// taskbar when the icon is at the bottom, below the top bar when it is at the top.
fn place(app: &AppHandle, window: &WebviewWindow, cursor: PhysicalPosition<f64>, height: f64) {
    let monitor = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let scale = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    let _ = window.set_size(LogicalSize::new(WIDTH, height));
    let w = (WIDTH * scale).round();
    let h = (height * scale).round();

    let (left, top, right, bottom) = match &monitor {
        Some(m) => {
            let area = m.work_area();
            let l = f64::from(area.position.x);
            let t = f64::from(area.position.y);
            (l, t, l + f64::from(area.size.width), t + f64::from(area.size.height))
        }
        None => (0.0, 0.0, cursor.x + w, cursor.y + h),
    };

    // Native menus open to the right of and below the click, flipping when they would not fit.
    let mut x = if cursor.x + w > right - EDGE_GAP { cursor.x - w } else { cursor.x };
    let lower_half = cursor.y > top + (bottom - top) / 2.0;
    let mut y = if lower_half { cursor.y - h } else { cursor.y };
    x = x.min(right - w - EDGE_GAP).max(left + EDGE_GAP);
    y = y.min(bottom - h - EDGE_GAP).max(top + EDGE_GAP);
    let _ = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

pub fn set_state(app: &AppHandle, state: TrayState) {
    let Some(menu) = app.try_state::<TrayMenu>() else { return };
    menu.inner.lock().unwrap().state = state.clone();
    let _ = app.emit_to(LABEL, "tray-status", state);
}

#[tauri::command]
pub fn get_tray_state(menu: tauri::State<'_, TrayMenu>) -> TrayState {
    menu.inner.lock().unwrap().state.clone()
}

/// The frontend reports how tall its content is, so the window is exactly as tall as the menu.
#[tauri::command]
pub fn tray_menu_resize(app: AppHandle, menu: tauri::State<'_, TrayMenu>, height: f64) {
    if !height.is_finite() {
        return;
    }
    let height = height.clamp(MIN_HEIGHT, MAX_HEIGHT).ceil();
    let cursor = {
        let mut inner = menu.inner.lock().unwrap();
        if (inner.height - height).abs() < 0.5 {
            return;
        }
        inner.height = height;
        inner.cursor
    };
    let Some(window) = app.get_webview_window(LABEL) else { return };
    match cursor {
        Some(cursor) if window.is_visible().unwrap_or(false) => place(&app, &window, cursor, height),
        _ => {
            let _ = window.set_size(LogicalSize::new(WIDTH, height));
        }
    }
}

/// What a menu row does. The menu closes first, so the app it opens is not left behind it.
#[tauri::command]
pub async fn tray_action(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    action: String,
) -> Result<(), String> {
    hide(&app);
    let controller = std::sync::Arc::clone(&state.controller);
    match action.as_str() {
        "close" => {}
        "open_app" => show_main_window(&app),
        "open_dashboard" => run_blocking(move || controller.open_web_app()).await,
        "sign_in" => {
            run_blocking(move || {
                let _ = controller.open_sign_in(None);
            })
            .await
        }
        // No stop-note prompt here: that is a form inside the main window. Stopping from the
        // tray ends the session without a note, as it always has.
        "pause" => {
            run_blocking(move || {
                let _ = controller.pause_session();
            })
            .await
        }
        "resume" => {
            run_blocking(move || {
                let _ = controller.resume_session();
            })
            .await
        }
        "stop" => {
            run_blocking(move || {
                let _ = controller.stop_session(None);
            })
            .await
        }
        "quit" => {
            controller.stop();
            app.exit(0);
        }
        other => return Err(format!("unknown tray action: {other}")),
    }
    Ok(())
}
