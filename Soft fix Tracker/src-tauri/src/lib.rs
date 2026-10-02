use tauri::Manager;

/// The native minimize / maximize / close buttons, sharing one row with the app's own header.
///
/// Windows keeps drawing and handling those three buttons itself (DWM paints them and
/// `DwmDefWindowProc` hit-tests them), so they keep what the system gives them - the Snap
/// Layouts flyout over maximize, hover / pressed states, the system menu, double-click to
/// maximize. What this module changes is the rest of the bar: the client area is extended up
/// over the old title bar, so the web content fills the whole top row, and the web view gets a
/// hole the size of the three buttons so they show (and receive the mouse) instead of the page.
///
/// Anything that goes wrong - no web-view child window, DWM refusing the button bounds - leaves
/// the window exactly as Windows made it, and the frontend falls back to a header under the
/// normal title bar (`caption_inset` answers `None`).
#[cfg(windows)]
mod caption {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicI32, AtomicIsize, Ordering};
    use std::sync::OnceLock;
    use tauri::{Emitter, Manager};

    type Hwnd = isize;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    struct Margins {
        left: i32,
        right: i32,
        top: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct NcCalcSizeParams {
        rgrc: [Rect; 3],
        lppos: *mut c_void,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetWindowRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
        fn GetClientRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
        fn ClientToScreen(hwnd: Hwnd, point: *mut Point) -> i32;
        fn FindWindowExW(parent: Hwnd, after: Hwnd, class: *const u16, title: *const u16) -> Hwnd;
        fn SetWindowRgn(hwnd: Hwnd, region: isize, redraw: i32) -> i32;
        fn SetWindowPos(hwnd: Hwnd, after: Hwnd, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        fn IsZoomed(hwnd: Hwnd) -> i32;
        fn GetDpiForWindow(hwnd: Hwnd) -> u32;
        fn GetSystemMetricsForDpi(index: i32, dpi: u32) -> i32;
        fn PostMessageW(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> i32;
        fn FillRect(hdc: isize, rect: *const Rect, brush: isize) -> i32;
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn CreateRectRgn(left: i32, top: i32, right: i32, bottom: i32) -> isize;
        fn CombineRgn(dest: isize, a: isize, b: isize, mode: i32) -> i32;
        fn CreateSolidBrush(colour: u32) -> isize;
        fn DeleteObject(object: isize) -> i32;
    }

    #[link(name = "comctl32")]
    extern "system" {
        fn SetWindowSubclass(
            hwnd: Hwnd,
            proc: unsafe extern "system" fn(Hwnd, u32, usize, isize, usize, usize) -> isize,
            id: usize,
            data: usize,
        ) -> i32;
        fn DefSubclassProc(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> isize;
    }

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmDefWindowProc(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize, result: *mut isize) -> i32;
        fn DwmGetWindowAttribute(hwnd: Hwnd, attribute: u32, value: *mut c_void, size: u32) -> i32;
        fn DwmExtendFrameIntoClientArea(hwnd: Hwnd, margins: *const Margins) -> i32;
    }

    const WM_SIZE: u32 = 0x0005;
    const WM_ERASEBKGND: u32 = 0x0014;
    const WM_WINDOWPOSCHANGED: u32 = 0x0047;
    const WM_NCCALCSIZE: u32 = 0x0083;
    const WM_NCHITTEST: u32 = 0x0084;
    const WM_DPICHANGED: u32 = 0x02E0;
    /// WM_APP + 1: "re-fit the hole now" - posted rather than done inline so it runs after
    /// whatever resized the web view for the same change.
    const WM_REFIT: u32 = 0x8001;

    const HTCLIENT: isize = 1;
    const HTTOP: isize = 12;
    const HTTOPLEFT: isize = 13;
    const HTTOPRIGHT: isize = 14;

    const DWMWA_CAPTION_BUTTON_BOUNDS: u32 = 5;
    const SM_CYFRAME: i32 = 33;
    const SM_CXPADDEDBORDER: i32 = 92;
    const RGN_DIFF: i32 = 4;
    // SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
    const FRAME_CHANGED: u32 = 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020;

    /// Top edge of the web view left to Windows so the window can still be resized from the
    /// top. Physical pixels; the web content is not clickable there, which is fine at 5px.
    const TOP_RESIZE_STRIP: i32 = 5;
    /// #0b0f19, the header's own background - what shows through the hole behind the buttons.
    const BACKDROP: u32 = 0x0019_0F0B;

    static MAIN: AtomicIsize = AtomicIsize::new(0);
    static INSET_W: AtomicI32 = AtomicI32::new(0);
    static INSET_H: AtomicI32 = AtomicI32::new(0);
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    fn frame_thickness(hwnd: Hwnd) -> i32 {
        // SAFETY: plain metric queries for a live window.
        unsafe {
            let dpi = GetDpiForWindow(hwnd);
            GetSystemMetricsForDpi(SM_CYFRAME, dpi) + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi)
        }
    }

    fn webview_child(hwnd: Hwnd) -> Hwnd {
        let class: Vec<u16> = "WRY_WEBVIEW\0".encode_utf16().collect();
        // SAFETY: `class` is NUL-terminated and outlives the call.
        unsafe { FindWindowExW(hwnd, 0, class.as_ptr(), std::ptr::null()) }
    }

    /// Cuts the caption-button rectangle (and a thin top resize strip) out of the web view.
    /// Returns the button area's size in physical pixels, or `None` if any step refused.
    fn refit(hwnd: Hwnd) -> Option<(i32, i32)> {
        let child = webview_child(hwnd);
        if child == 0 {
            return None;
        }
        // SAFETY: every out-pointer is a local of the right type; handles are live or checked.
        unsafe {
            let mut buttons = Rect::default();
            if DwmGetWindowAttribute(hwnd, DWMWA_CAPTION_BUTTON_BOUNDS, &mut buttons as *mut Rect as *mut c_void, 16) != 0 {
                return None;
            }
            let mut window = Rect::default();
            let mut client = Rect::default();
            let mut origin = Point { x: 0, y: 0 };
            if GetWindowRect(hwnd, &mut window) == 0 || GetClientRect(child, &mut client) == 0 || ClientToScreen(child, &mut origin) == 0 {
                return None;
            }
            // The bounds are relative to the window's top-left; the region is relative to the
            // web view's. They differ by the invisible side frame.
            let hole = Rect {
                left: window.left + buttons.left - origin.x,
                top: window.top + buttons.top - origin.y,
                right: window.left + buttons.right - origin.x,
                bottom: window.top + buttons.bottom - origin.y,
            };
            let width = client.right - client.left;
            let height = client.bottom - client.top;

            let region = CreateRectRgn(0, 0, width, height);
            let strip = CreateRectRgn(0, 0, width, TOP_RESIZE_STRIP);
            let cut = CreateRectRgn(hole.left, hole.top.max(0), hole.right, hole.bottom);
            CombineRgn(region, region, strip, RGN_DIFF);
            CombineRgn(region, region, cut, RGN_DIFF);
            DeleteObject(strip);
            DeleteObject(cut);
            // The system owns `region` from here on.
            SetWindowRgn(child, region, 1);

            Some((width - hole.left, hole.bottom.max(0)))
        }
    }

    fn publish(hwnd: Hwnd) {
        let Some((width, height)) = refit(hwnd) else { return };
        INSET_W.store(width, Ordering::Relaxed);
        INSET_H.store(height, Ordering::Relaxed);
        if let (Some(app), Some((w, h))) = (APP.get(), inset()) {
            let _ = app.emit("caption-inset", CaptionInset { width: w, height: h });
        }
    }

    #[derive(Clone, serde::Serialize)]
    pub struct CaptionInset {
        pub width: f64,
        pub height: f64,
    }

    /// The caption buttons' size in CSS pixels, or `None` while the native bar is still in use.
    pub fn inset() -> Option<(f64, f64)> {
        let hwnd = MAIN.load(Ordering::Relaxed);
        let (w, h) = (INSET_W.load(Ordering::Relaxed), INSET_H.load(Ordering::Relaxed));
        if hwnd == 0 || w <= 0 || h <= 0 {
            return None;
        }
        // SAFETY: a plain DPI query.
        let scale = f64::from(unsafe { GetDpiForWindow(hwnd) }.max(96)) / 96.0;
        Some((f64::from(w) / scale, f64::from(h) / scale))
    }

    unsafe extern "system" fn subclass_proc(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize, _id: usize, _data: usize) -> isize {
        if msg == WM_NCCALCSIZE {
            if wparam == 0 {
                return DefSubclassProc(hwnd, msg, wparam, lparam);
            }
            // Let Windows size the client area, then take the title bar's rows back: the
            // client area starts where the window starts. A maximized window overshoots the
            // screen by its frame, so there the top edge moves down by that frame.
            let params = lparam as *mut NcCalcSizeParams;
            let top = (*params).rgrc[0].top;
            let result = DefSubclassProc(hwnd, msg, wparam, lparam);
            if result == 0 {
                (*params).rgrc[0].top = if IsZoomed(hwnd) != 0 { top + frame_thickness(hwnd) } else { top };
            }
            return result;
        }

        // The caption buttons are DWM's: it gets first look at everything, hit-testing included.
        let mut handled = 0isize;
        let dwm = DwmDefWindowProc(hwnd, msg, wparam, lparam, &mut handled);
        if dwm != 0 {
            return handled;
        }

        match msg {
            WM_NCHITTEST => {
                let result = DefSubclassProc(hwnd, msg, wparam, lparam);
                if result != HTCLIENT || IsZoomed(hwnd) != 0 {
                    return result;
                }
                // The web view leaves a thin strip along the top uncovered; it is the top
                // resize edge (corners included), since the client area now reaches it.
                let x = i32::from(lparam as i16);
                let y = i32::from((lparam >> 16) as i16);
                let mut window = Rect::default();
                GetWindowRect(hwnd, &mut window);
                if y >= window.top + TOP_RESIZE_STRIP {
                    return result;
                }
                let corner = frame_thickness(hwnd);
                if x < window.left + corner {
                    HTTOPLEFT
                } else if x >= window.right - corner {
                    HTTOPRIGHT
                } else {
                    HTTOP
                }
            }
            WM_ERASEBKGND => {
                let mut area = Rect::default();
                GetClientRect(hwnd, &mut area);
                let brush = CreateSolidBrush(BACKDROP);
                FillRect(wparam as isize, &area, brush);
                DeleteObject(brush);
                1
            }
            WM_SIZE | WM_WINDOWPOSCHANGED | WM_DPICHANGED => {
                let result = DefSubclassProc(hwnd, msg, wparam, lparam);
                PostMessageW(hwnd, WM_REFIT, 0, 0);
                result
            }
            WM_REFIT => {
                publish(hwnd);
                0
            }
            _ => DefSubclassProc(hwnd, msg, wparam, lparam),
        }
    }

    /// Switches the window over. Does nothing (the native bar stays) if the web view or the
    /// button bounds cannot be found.
    pub fn install(window: &tauri::WebviewWindow) {
        let Ok(hwnd) = window.hwnd() else { return };
        let hwnd = hwnd.0 as isize;
        if webview_child(hwnd) == 0 {
            return;
        }
        // SAFETY: bounds query into a local; `hwnd` is this window's live handle.
        let mut probe = Rect::default();
        if unsafe { DwmGetWindowAttribute(hwnd, DWMWA_CAPTION_BUTTON_BOUNDS, &mut probe as *mut Rect as *mut c_void, 16) } != 0 {
            return;
        }
        let _ = APP.set(window.app_handle().clone());
        MAIN.store(hwnd, Ordering::Relaxed);
        // SAFETY: the procedure matches the subclass signature and needs no reference data;
        // SWP_FRAMECHANGED makes Windows ask for the client area again, through it.
        unsafe {
            if SetWindowSubclass(hwnd, subclass_proc, 1, 0) == 0 {
                return;
            }
            // DWM only paints the caption buttons over frame it owns, so hand it the top rows.
            let margins = Margins { left: 0, right: 0, top: probe.bottom.max(1), bottom: 0 };
            DwmExtendFrameIntoClientArea(hwnd, &margins);
            SetWindowPos(hwnd, 0, 0, 0, 0, 0, FRAME_CHANGED);
            PostMessageW(hwnd, WM_REFIT, 0, 0);
        }
    }
}

/// How much room the native caption buttons take at the top-right, in CSS pixels - or `None`
/// while the window still has its ordinary title bar and the header sits below it.
#[tauri::command]
fn caption_inset() -> Option<serde_json::Value> {
    #[cfg(windows)]
    {
        caption::inset().map(|(width, height)| serde_json::json!({ "width": width, "height": height }))
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Paints Windows 11's own title bar in the app's colours, so the native bar and the header
/// under it read as one when the buttons cannot be moved up. Only colours change - the bar, its
/// buttons and everything they do stay Windows'. Older Windows ignores the attributes.
#[cfg(windows)]
fn match_title_bar(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(hwnd: isize, attribute: u32, value: *const c_void, size: u32) -> i32;
    }
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWA_CAPTION_COLOR: u32 = 35;
    const DWMWA_TEXT_COLOR: u32 = 36;
    // COLORREF is 0x00BBGGRR.
    const CAPTION: u32 = 0x0019_0F0B; // #0b0f19, the header's own background
    const TEXT: u32 = 0x00F3_EAE8; // #e8eaf3
    const BORDER: u32 = 0x0041_2B24; // #242b41, the app's panel line

    let Ok(hwnd) = window.hwnd() else { return };
    for (attribute, colour) in [(DWMWA_CAPTION_COLOR, CAPTION), (DWMWA_TEXT_COLOR, TEXT), (DWMWA_BORDER_COLOR, BORDER)] {
        // SAFETY: `hwnd` is this window's live handle and `colour` outlives the call.
        unsafe {
            DwmSetWindowAttribute(hwnd.0 as isize, attribute, &colour as *const u32 as *const c_void, 4);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![caption_inset])
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                match_title_bar(&window);
                caption::install(&window);
            }
            #[cfg(not(windows))]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Soft Fix Tracker");
}
