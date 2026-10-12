//! The window's three shapes - Full, Focus and Easy - and the tray icon that launches them.
//!
//! Focus is a small always-on-top timer for people who just want to track; Easy is a roomy,
//! large-text version for people who want the basics without the whole app. The tray icon (found
//! under the hidden icons next to the clock) opens Soft Fix in any of the three, and closing the
//! window only hides it there while "keep running in the tray" is on, so it can be launched again
//! without starting over.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Window, WindowEvent, WebviewWindow,
};

static KEEP_IN_TRAY: AtomicBool = AtomicBool::new(true);
static FOCUS_ON_TOP: AtomicBool = AtomicBool::new(true);

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ViewMode {
    Full,
    Focus,
    Easy,
}

impl ViewMode {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "full" => Some(Self::Full),
            "focus" => Some(Self::Focus),
            "easy" => Some(Self::Easy),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::Focus => "focus",
            Self::Easy => "easy",
        }
    }
}

/// Where the full window was before it shrank, so going back to Full puts it back there.
struct SavedFull {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
}

static CURRENT: Mutex<ViewMode> = Mutex::new(ViewMode::Full);
static SAVED: Mutex<Option<SavedFull>> = Mutex::new(None);

const FULL_SIZE: (f64, f64) = (1440.0, 900.0);
const FULL_MIN: (f64, f64) = (1100.0, 700.0);
const FOCUS_SIZE: (f64, f64) = (380.0, 640.0);
const FOCUS_MIN: (f64, f64) = (340.0, 480.0);
const EASY_SIZE: (f64, f64) = (900.0, 780.0);
const EASY_MIN: (f64, f64) = (640.0, 560.0);
/// Space kept between the Focus window and the screen edge.
const EDGE: f64 = 16.0;

/// Parks the Focus window in the bottom-right corner of the screen's work area.
fn dock_bottom_right(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor().map(|found| found.or_else(|| window.primary_monitor().ok().flatten())) else {
        let _ = window.center();
        return;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let width = (FOCUS_SIZE.0 * scale).round() as i32;
    let height = (FOCUS_SIZE.1 * scale).round() as i32;
    let margin = (EDGE * scale).round() as i32;
    let x = area.position.x + area.size.width as i32 - width - margin;
    let y = area.position.y + area.size.height as i32 - height - margin;
    let _ = window.set_position(PhysicalPosition::new(x.max(area.position.x), y.max(area.position.y)));
}

/// Gives the window the size, floor, position and stacking of `mode`.
pub fn apply(window: &WebviewWindow, mode: ViewMode) {
    let previous = *CURRENT.lock().unwrap();
    if previous == mode {
        // Already there; only Focus has something that can change (stay on top or not).
        if mode == ViewMode::Focus {
            let _ = window.set_always_on_top(FOCUS_ON_TOP.load(Ordering::Relaxed));
        }
        return;
    }
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    }
    if previous == ViewMode::Full {
        if let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) {
            *SAVED.lock().unwrap() = Some(SavedFull { position, size });
        }
    }
    // The floor of the old shape would stop the new one being smaller; lift it, resize, pin the new floor.
    let _ = window.set_min_size(None::<LogicalSize<f64>>);
    match mode {
        ViewMode::Full => {
            match SAVED.lock().unwrap().take() {
                Some(saved) => {
                    let _ = window.set_size(saved.size);
                    let _ = window.set_position(saved.position);
                }
                None => {
                    let _ = window.set_size(LogicalSize::new(FULL_SIZE.0, FULL_SIZE.1));
                    let _ = window.center();
                }
            }
            let _ = window.set_min_size(Some(LogicalSize::new(FULL_MIN.0, FULL_MIN.1)));
            let _ = window.set_always_on_top(false);
        }
        ViewMode::Focus => {
            let _ = window.set_size(LogicalSize::new(FOCUS_SIZE.0, FOCUS_SIZE.1));
            let _ = window.set_min_size(Some(LogicalSize::new(FOCUS_MIN.0, FOCUS_MIN.1)));
            dock_bottom_right(window);
            let _ = window.set_always_on_top(FOCUS_ON_TOP.load(Ordering::Relaxed));
        }
        ViewMode::Easy => {
            let _ = window.set_size(LogicalSize::new(EASY_SIZE.0, EASY_SIZE.1));
            let _ = window.set_min_size(Some(LogicalSize::new(EASY_MIN.0, EASY_MIN.1)));
            let _ = window.center();
            let _ = window.set_always_on_top(false);
        }
    }
    *CURRENT.lock().unwrap() = mode;
}

/// Brings the main window back from the tray or the taskbar and puts it in front.
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Opens Soft Fix in `mode` from the tray: shapes the window, shows it, and tells the page.
fn launch(app: &AppHandle, mode: ViewMode) {
    if let Some(window) = app.get_webview_window("main") {
        apply(&window, mode);
    }
    show_main(app);
    let _ = app.emit("view-mode", mode.as_str());
}

/// Adds the tray icon: click to open, right-click for Full / Focus / Easy and Quit.
pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Soft Fix", true, None::<&str>)?;
    let focus = MenuItem::with_id(app, "focus", "Focus mode", true, None::<&str>)?;
    let easy = MenuItem::with_id(app, "easy", "Easy mode", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Soft Fix", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &focus, &easy, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut tray = TrayIconBuilder::with_id("soft-fix")
        .tooltip("Soft Fix")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => launch(app, ViewMode::Full),
            "focus" => launch(app, ViewMode::Focus),
            "easy" => launch(app, ViewMode::Easy),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    tray.build(app)?;
    Ok(())
}

/// Closing the main window hides it to the tray while that setting is on.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" && KEEP_IN_TRAY.load(Ordering::Relaxed) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

/// The page asks for a shape (from its own buttons, or after the tray changed it).
#[tauri::command]
pub fn set_view_mode(window: WebviewWindow, mode: String) {
    if let Some(mode) = ViewMode::parse(&mode) {
        apply(&window, mode);
    }
}

/// The two settings the native side has to know about, kept in step with the page's.
#[tauri::command]
pub fn sync_shell_prefs(window: WebviewWindow, keep_in_tray: bool, focus_on_top: bool) {
    KEEP_IN_TRAY.store(keep_in_tray, Ordering::Relaxed);
    FOCUS_ON_TOP.store(focus_on_top, Ordering::Relaxed);
    if *CURRENT.lock().unwrap() == ViewMode::Focus {
        let _ = window.set_always_on_top(focus_on_top);
    }
}
