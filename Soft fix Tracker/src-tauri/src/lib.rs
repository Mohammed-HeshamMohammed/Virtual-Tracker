mod shell;

/// The window has no native title bar (`decorations: false` in `tauri.conf.json`): the app's own
/// header is the title bar and draws the minimize / maximize / close buttons itself
/// (`WindowControls.tsx`), so they share its height, background and theme. Dragging, double-click
/// to maximize and edge resizing come from Tauri / tao.
///
/// The one thing a page-drawn button can't do alone is Windows 11's Snap Layouts flyout, which
/// Windows shows when the pointer rests on whatever answers a hit test with "maximize button".
/// The web view swallows hit tests, so `snap` lays an invisible native window over the maximize
/// button that answers for it, and reports hover / pressed back so the page can still style it.
#[cfg(windows)]
mod snap {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
    use std::sync::OnceLock;
    use tauri::{Emitter, Manager};

    type Hwnd = isize;

    #[repr(C)]
    struct WndClassExW {
        size: u32,
        style: u32,
        wnd_proc: unsafe extern "system" fn(Hwnd, u32, usize, isize) -> isize,
        class_extra: i32,
        window_extra: i32,
        instance: isize,
        icon: isize,
        cursor: isize,
        background: isize,
        menu_name: *const u16,
        class_name: *const u16,
        icon_small: isize,
    }

    #[repr(C)]
    struct TrackMouse {
        size: u32,
        flags: u32,
        hwnd: Hwnd,
        hover_time: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn RegisterClassExW(class: *const WndClassExW) -> u16;
        fn CreateWindowExW(
            ex_style: u32,
            class: *const u16,
            name: *const u16,
            style: u32,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            parent: Hwnd,
            menu: isize,
            instance: isize,
            param: *const c_void,
        ) -> Hwnd;
        fn DefWindowProcW(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> isize;
        fn SetWindowPos(hwnd: Hwnd, after: Hwnd, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        fn SetLayeredWindowAttributes(hwnd: Hwnd, key: u32, alpha: u8, flags: u32) -> i32;
        fn TrackMouseEvent(track: *mut TrackMouse) -> i32;
        fn PostMessageW(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> i32;
        fn GetAncestor(hwnd: Hwnd, flags: u32) -> Hwnd;
        fn IsZoomed(hwnd: Hwnd) -> i32;
        fn GetDpiForWindow(hwnd: Hwnd) -> u32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(name: *const u16) -> isize;
    }

    const WM_ERASEBKGND: u32 = 0x0014;
    const WM_MOUSEACTIVATE: u32 = 0x0021;
    const WM_NCHITTEST: u32 = 0x0084;
    const WM_NCMOUSEMOVE: u32 = 0x00A0;
    const WM_NCLBUTTONDOWN: u32 = 0x00A1;
    const WM_NCLBUTTONUP: u32 = 0x00A2;
    const WM_SYSCOMMAND: u32 = 0x0112;
    const WM_NCMOUSELEAVE: u32 = 0x02A2;

    const HTMAXBUTTON: isize = 9;
    const MA_NOACTIVATE: isize = 3;
    const SC_MAXIMIZE: usize = 0xF030;
    const SC_RESTORE: usize = 0xF120;
    const GA_ROOT: u32 = 2;
    const TME_LEAVE: u32 = 0x0002;
    const TME_NONCLIENT: u32 = 0x0010;

    const WS_CHILD: u32 = 0x4000_0000;
    const WS_VISIBLE: u32 = 0x1000_0000;
    const WS_CLIPSIBLINGS: u32 = 0x0400_0000;
    const WS_EX_NOACTIVATE: u32 = 0x0800_0000;
    const WS_EX_LAYERED: u32 = 0x0008_0000;
    const LWA_ALPHA: u32 = 0x0000_0002;
    const HWND_TOP: Hwnd = 0;
    // SWP_NOACTIVATE | SWP_SHOWWINDOW
    const PLACE_FLAGS: u32 = 0x0010 | 0x0040;

    static OVERLAY: AtomicIsize = AtomicIsize::new(0);
    static HOVER: AtomicBool = AtomicBool::new(false);
    static PRESSED: AtomicBool = AtomicBool::new(false);
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Tells the page, as `[hover, pressed]`, so it can style the button it drew underneath.
    fn set_state(hover: bool, pressed: bool) {
        let changed = HOVER.swap(hover, Ordering::Relaxed) != hover || PRESSED.swap(pressed, Ordering::Relaxed) != pressed;
        if changed {
            if let Some(app) = APP.get() {
                let _ = app.emit("snap-button", (hover, pressed));
            }
        }
    }

    unsafe extern "system" fn overlay_proc(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> isize {
        match msg {
            WM_NCHITTEST => HTMAXBUTTON,
            WM_NCMOUSEMOVE => {
                let mut track = TrackMouse { size: std::mem::size_of::<TrackMouse>() as u32, flags: TME_LEAVE | TME_NONCLIENT, hwnd, hover_time: 0 };
                TrackMouseEvent(&mut track);
                set_state(true, PRESSED.load(Ordering::Relaxed));
                // Windows starts its flyout timer from the default handling of this message.
                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
            WM_NCMOUSELEAVE => {
                set_state(false, false);
                0
            }
            WM_NCLBUTTONDOWN => {
                set_state(true, true);
                0
            }
            WM_NCLBUTTONUP => {
                let was_pressed = PRESSED.load(Ordering::Relaxed);
                set_state(true, false);
                if was_pressed {
                    let top = GetAncestor(hwnd, GA_ROOT);
                    let command = if IsZoomed(top) != 0 { SC_RESTORE } else { SC_MAXIMIZE };
                    PostMessageW(top, WM_SYSCOMMAND, command, 0);
                }
                0
            }
            WM_MOUSEACTIVATE => MA_NOACTIVATE,
            WM_ERASEBKGND => 1,
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    fn create(parent: Hwnd) -> Hwnd {
        let class_name = wide("SoftFixSnapOverlay");
        // SAFETY: plain window-class and window creation on the thread that owns `parent`;
        // every pointer outlives its call, and registering the same class twice just fails.
        unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let class = WndClassExW {
                size: std::mem::size_of::<WndClassExW>() as u32,
                style: 0,
                wnd_proc: overlay_proc,
                class_extra: 0,
                window_extra: 0,
                instance,
                icon: 0,
                cursor: 0,
                background: 0,
                menu_name: std::ptr::null(),
                class_name: class_name.as_ptr(),
                icon_small: 0,
            };
            RegisterClassExW(&class);
            let hwnd = CreateWindowExW(
                WS_EX_LAYERED | WS_EX_NOACTIVATE,
                class_name.as_ptr(),
                std::ptr::null(),
                WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
                0,
                0,
                0,
                0,
                parent,
                0,
                instance,
                std::ptr::null(),
            );
            if hwnd != 0 {
                // Nearly fully transparent but still hit-testable: the page's own button shows
                // through, this window only answers the pointer.
                SetLayeredWindowAttributes(hwnd, 0, 1, LWA_ALPHA);
            }
            hwnd
        }
    }

    /// Puts the overlay over the maximize button. `x`, `y`, `width`, `height` are the button's
    /// box in CSS pixels, relative to the web view (which fills the window).
    pub fn place(window: &tauri::WebviewWindow, x: f64, y: f64, width: f64, height: f64) {
        let Ok(parent) = window.hwnd() else { return };
        let parent = parent.0 as isize;
        let _ = APP.set(window.app_handle().clone());
        let mut overlay = OVERLAY.load(Ordering::Relaxed);
        if overlay == 0 {
            overlay = create(parent);
            if overlay == 0 {
                return;
            }
            OVERLAY.store(overlay, Ordering::Relaxed);
        }
        // SAFETY: a plain DPI query and a move of a window this module created.
        unsafe {
            let scale = f64::from(GetDpiForWindow(parent).max(96)) / 96.0;
            SetWindowPos(
                overlay,
                HWND_TOP,
                (x * scale).round() as i32,
                (y * scale).round() as i32,
                (width * scale).round() as i32,
                (height * scale).round() as i32,
                PLACE_FLAGS,
            );
        }
    }
}

/// Tells the host where the page drew its maximize button, so Windows 11 can show Snap Layouts
/// over it. A no-op on other platforms.
#[tauri::command]
fn snap_button_rect(window: tauri::WebviewWindow, x: f64, y: f64, width: f64, height: f64) {
    #[cfg(windows)]
    {
        let target = window.clone();
        let _ = window.run_on_main_thread(move || snap::place(&target, x, y, width, height));
    }
    #[cfg(not(windows))]
    let _ = (window, x, y, width, height);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Launching Soft Fix again (from the Start menu, say) brings the running one forward
        // instead of starting a second copy next to the tray icon.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| shell::show_main(app)))
        .invoke_handler(tauri::generate_handler![
            snap_button_rect,
            shell::set_view_mode,
            shell::sync_shell_prefs
        ])
        .on_window_event(shell::on_window_event)
        .setup(|app| {
            shell::build_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Soft Fix Tracker");
}
