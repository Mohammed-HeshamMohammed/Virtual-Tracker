use tauri::Manager;

/// Paints Windows 11's own title bar in the app's colours, so the native bar and the toolbar
/// under it read as one header. Only colours change - the bar, its buttons and everything
/// they do stay Windows'. Older Windows ignores the attributes and keeps its default bar.
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
    const CAPTION: u32 = 0x0019_0F0B; // #0b0f19, the toolbar's own background
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
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                match_title_bar(&window);
            }
            #[cfg(not(windows))]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Soft Fix Tracker");
}
