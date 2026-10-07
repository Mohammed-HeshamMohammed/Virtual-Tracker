//! Tells the agent when the computer is about to sleep or shut down.
//!
//! Nothing else does. The agent used to find out only when its own process was asked to
//! exit, which a shutdown or a sleep does not do, so the session stayed open on the server
//! and was still counting when the computer came back. A hidden top-level window is used
//! because message-only windows are not sent the broadcast messages below.

use std::sync::{Arc, OnceLock};

/// Called on the watcher's own thread with `"suspend"` or `"shutdown"`. It has only a few
/// seconds before Windows moves on, so it should do one quick thing.
pub type PowerCallback = Arc<dyn Fn(&'static str) + Send + Sync>;

static CALLBACK: OnceLock<PowerCallback> = OnceLock::new();

#[cfg(windows)]
pub fn watch(on_power: PowerCallback) {
    if CALLBACK.set(on_power).is_err() {
        return;
    }
    let _ = std::thread::Builder::new().name("vt-power-events".into()).spawn(run_window);
}

#[cfg(not(windows))]
pub fn watch(_on_power: PowerCallback) {}

/// What a power message means for the session, kept apart from the Windows plumbing so it
/// can be tested.
pub fn reason_for(message: u32, wparam: usize) -> Option<&'static str> {
    const WM_POWERBROADCAST: u32 = 0x0218;
    const WM_ENDSESSION: u32 = 0x0016;
    const PBT_APMSUSPEND: usize = 0x0004;
    match message {
        // Sleep or hibernate is about to happen.
        WM_POWERBROADCAST if wparam == PBT_APMSUSPEND => Some("suspend"),
        // wparam is whether the session really is ending; a cancelled shutdown sends false.
        WM_ENDSESSION if wparam != 0 => Some("shutdown"),
        _ => None,
    }
}

#[cfg(windows)]
fn run_window() {
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, TranslateMessage,
        CW_USEDEFAULT, MSG, WINDOW_EX_STYLE, WNDCLASSW, WS_OVERLAPPED,
    };

    unsafe extern "system" fn wndproc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if let Some(reason) = reason_for(message, wparam.0) {
            if let Some(callback) = CALLBACK.get() {
                callback(reason);
            }
        }
        // WM_QUERYENDSESSION / WM_POWERBROADCAST both want TRUE: never veto.
        match message {
            0x0011 | 0x0218 => LRESULT(1),
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    unsafe {
        let Ok(instance) = GetModuleHandleW(None) else {
            return;
        };
        let class = WNDCLASSW {
            lpfnWndProc: Some(wndproc),
            hInstance: instance.into(),
            lpszClassName: w!("VirtualTrackerPowerEvents"),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            return;
        }
        // Never shown: it exists only to be sent the power messages.
        let Ok(hwnd) = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("VirtualTrackerPowerEvents"),
            w!("Virtual Tracker power events"),
            WS_OVERLAPPED,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            0,
            0,
            None,
            None,
            instance,
            None,
        ) else {
            return;
        };
        let _ = hwnd;
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sleep_and_a_real_shutdown_stop_the_session() {
        assert_eq!(reason_for(0x0218, 0x0004), Some("suspend"));
        assert_eq!(reason_for(0x0016, 1), Some("shutdown"));
    }

    #[test]
    fn a_cancelled_shutdown_and_a_resume_do_not() {
        assert_eq!(reason_for(0x0016, 0), None);
        assert_eq!(reason_for(0x0218, 0x0012), None, "resume-automatic is not a stop");
        assert_eq!(reason_for(0x0001, 0x0004), None);
    }
}
