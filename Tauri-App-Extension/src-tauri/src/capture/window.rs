use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
#[cfg(windows)]
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(any(windows, target_os = "macos"))]
use crate::constants::MAX_URL_LEN;
use crate::constants::URL_SCRIPT_TIMEOUT_SEC;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Suppresses the console window a spawned powershell/cmd process would
/// otherwise flash on screen — this runs silently in the background.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// This whole cluster (through BROWSER_EXES below) backs Windows's own
// get_foreground_window_win/resolve_display_name path specifically - macOS
// gets its display name straight from xcap's app_name instead (see
// get_foreground_window_macos's own comment), and Linux has no window-
// capture backend at all yet (get_foreground_window's #[cfg(not(...))]
// fallback). Real, used code on Windows; genuinely unreachable elsewhere,
// with no test exercising it directly the way browser_hint_from_exe's tests
// do below - hence the explicit allow rather than leaving it to warn.
#[allow(dead_code)]
static DISPLAY_OVERRIDES: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();

#[allow(dead_code)]
fn overrides() -> &'static HashMap<&'static str, &'static str> {
    DISPLAY_OVERRIDES.get_or_init(|| {
        HashMap::from([
            ("code.exe", "VS Code"),
            ("cursor.exe", "Cursor"),
            ("devenv.exe", "Visual Studio"),
            ("explorer.exe", "File Explorer"),
            ("windowsterminal.exe", "Windows Terminal"),
            ("wt.exe", "Windows Terminal"),
            ("powershell.exe", "PowerShell"),
            ("cmd.exe", "Command Prompt"),
            ("winword.exe", "Microsoft Word"),
            ("excel.exe", "Microsoft Excel"),
            ("powerpnt.exe", "PowerPoint"),
            ("python.exe", "Python"),
            ("pythonw.exe", "Python"),
        ])
    })
}

#[allow(dead_code)]
const BROWSER_EXES: &[&str] = &[
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "brave.exe",
    "opera.exe",
    "operagx.exe",
    "vivaldi.exe",
    "waterfox.exe",
    "chromium.exe",
    "iexplore.exe",
    "zen.exe",
];

#[derive(Debug, Clone)]
pub struct ForegroundWindow {
    pub app_name: String,
    pub title: String,
    pub process_name: String,
    /// Full path to the executable. Windows-only; empty elsewhere and on the
    /// paths where the process image name can't be read. Used for app-icon
    /// extraction (capture/app_icon.rs).
    pub exe_path: String,
    // Read back only inside read_browser_url's #[cfg(windows)] branch -
    // always constructed (every get_foreground_window_* branch sets them,
    // hwnd to 0 where there's no such concept), just never read on whatever
    // platform doesn't have a real capture backend.
    #[allow(dead_code)]
    pub hwnd: usize,
    pub is_browser: bool,
    #[allow(dead_code)]
    pub browser_hint: String,
}

pub fn get_foreground_window() -> ForegroundWindow {
    #[cfg(windows)]
    {
        get_foreground_window_win()
    }
    #[cfg(target_os = "macos")]
    {
        get_foreground_window_macos()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        ForegroundWindow {
            app_name: "Unknown".into(),
            title: "Unknown".into(),
            process_name: String::new(),
            exe_path: String::new(),
            hwnd: 0,
            is_browser: false,
            browser_hint: String::new(),
        }
    }
}

/// MAC-2: `xcap::Window` (already a dependency here for screenshot capture,
/// `screen.rs`) does the NSWorkspace/CGWindowListCopyWindowInfo work
/// internally on macOS - see xcap's own `src/macos/impl_window.rs`, which is
/// exactly the approach this function would otherwise have had to hand-roll
/// via raw Objective-C FFI. Reusing it means this integrates an
/// already-shipped, already-compiling-on-other-platforms implementation
/// instead of adding new, unverifiable-from-this-environment FFI code.
///
/// UNVERIFIED: written without any way to compile-check macOS-specific code
/// on this machine (no C toolchain available even for `cargo check --target
/// aarch64-apple-darwin` - Tauri's own macOS build needs `cc` for its
/// Objective-C bridging, which isn't installed here). `xcap::Window`'s API
/// itself is real and documented; this integration has not been built or
/// run on real macOS hardware. Treat as a first draft to validate there.
#[cfg(target_os = "macos")]
fn get_foreground_window_macos() -> ForegroundWindow {
    let unknown = || ForegroundWindow {
        app_name: "Unknown".into(),
        title: "Unknown".into(),
        process_name: String::new(),
        exe_path: String::new(),
        hwnd: 0,
        is_browser: false,
        browser_hint: String::new(),
    };

    let windows = match xcap::Window::all() {
        Ok(w) => w,
        Err(err) => {
            log::warn!("xcap::Window::all() failed: {err}");
            return unknown();
        }
    };
    let Some(focused) = windows.into_iter().find(|w| w.is_focused()) else {
        return unknown();
    };

    let app_name = focused.app_name().to_string();
    let title_raw = focused.title().trim().to_string();
    let title = if title_raw.is_empty() { "Unknown".to_string() } else { title_raw };
    // macOS has no separate exe-vs-display-name split the way Windows does -
    // xcap's app_name() is already the display name ("Google Chrome"), and
    // it's also exactly what get-browser-url-macos.applescript's
    // `tell application "<processName>"` / `tell process "<processName>"`
    // expect as an argument (see tryBrowserByProcess/readFirefoxUrl there).
    let process_name = app_name.clone();
    let browser_hint = browser_hint_from_exe(&app_name.to_lowercase());
    let is_browser = !browser_hint.is_empty();

    ForegroundWindow {
        app_name,
        title,
        process_name,
        // App-icon extraction is Windows-only (capture/app_icon.rs); xcap
        // gives no executable path on macOS anyway.
        exe_path: String::new(),
        // HWND is a Windows-specific concept with no macOS equivalent; the
        // only consumer of this field is #[cfg(windows)]-gated, so 0 here is
        // inert, not a placeholder standing in for something unfetched.
        hwnd: 0,
        is_browser,
        browser_hint,
    }
}

#[cfg(windows)]
fn get_foreground_window_win() -> ForegroundWindow {
    use windows::Win32::Foundation::MAX_PATH;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        let hwnd_val = hwnd.0 as usize;
        let mut title = String::from("Unknown");
        let len = GetWindowTextLengthW(hwnd) + 1;
        if len > 1 {
            let mut buf = vec![0u16; len as usize];
            let written = GetWindowTextW(hwnd, &mut buf);
            if written > 0 {
                title = String::from_utf16_lossy(&buf[..written as usize])
                    .trim()
                    .to_string();
                if title.is_empty() {
                    title = "Unknown".into();
                }
            }
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));

        let mut process_name = String::from("Unknown");
        let mut exe_path = String::new();
        if pid != 0 {
            if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut buf = [0u16; MAX_PATH as usize];
                let mut size = buf.len() as u32;
                if QueryFullProcessImageNameW(
                    handle,
                    PROCESS_NAME_FORMAT(0),
                    windows::core::PWSTR(buf.as_mut_ptr()),
                    &mut size,
                )
                .is_ok()
                {
                    let full_path = String::from_utf16_lossy(&buf[..size as usize]);
                    if let Some(name) = PathBuf::from(full_path.as_str()).file_name() {
                        process_name = name.to_string_lossy().to_string();
                    }
                    exe_path = full_path;
                }
                let _ = windows::Win32::Foundation::CloseHandle(handle);
            }
        }

        let exe_lower = process_name.to_lowercase();
        let is_browser = BROWSER_EXES.iter().any(|b| *b == exe_lower);
        let browser_hint = browser_hint_from_exe(&exe_lower);
        let app_name = resolve_display_name(&process_name, &title);

        ForegroundWindow {
            app_name,
            title,
            process_name,
            exe_path,
            hwnd: hwnd_val,
            is_browser,
            browser_hint,
        }
    }
}

#[allow(dead_code)]
fn resolve_display_name(process_name: &str, title: &str) -> String {
    let key = process_name.to_lowercase();
    if let Some(name) = overrides().get(key.as_str()) {
        return (*name).to_string();
    }
    if key.ends_with(".exe") {
        let stem = key.trim_end_matches(".exe").replace(['.', '_'], " ");
        let titled: String = stem
            .split_whitespace()
            .map(|w| {
                let mut c = w.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
        if !titled.is_empty() {
            return titled;
        }
    }
    if let Some((_, suffix)) = title.rsplit_once(" - ") {
        let suffix = suffix.trim();
        if !suffix.is_empty() && suffix.to_lowercase() != "unknown" {
            return suffix.to_string();
        }
    }
    if process_name.is_empty() {
        "Unknown".into()
    } else {
        process_name.to_string()
    }
}

// Its own tests below call this directly on every platform (deliberately -
// see their comment), so it's never actually dead where it matters; the
// #[allow] is only for the plain non-test lib build, where its real callers
// (get_foreground_window_win/_macos, both #[cfg]-gated) leave it unreachable
// on whichever platform isn't Windows or macOS.
#[allow(dead_code)]
fn browser_hint_from_exe(exe: &str) -> String {
    // "safari" only ever matches a macOS app_name ("Safari"); harmless no-op
    // on Windows, where no process name contains that substring. Kept in this
    // one shared function rather than a second macOS-only copy - CQ-4's
    // "two sources of truth" trap, avoided before it exists.
    if exe.contains("safari") {
        "safari".into()
    } else if exe.contains("chrome") {
        "chrome".into()
    } else if exe.contains("msedge") || exe.contains("edge") {
        "edge".into()
    } else if exe.contains("firefox") {
        "firefox".into()
    } else if exe.contains("brave") {
        "brave".into()
    } else if exe.contains("opera") {
        "opera".into()
    } else if exe.contains("vivaldi") {
        "vivaldi".into()
    } else {
        String::new()
    }
}

// Reachable via read_browser_url's windows/macos branches and app_icon.rs.
#[allow(dead_code)]
pub(crate) fn run_command_timeout(mut command: Command, timeout: Duration) -> Option<String> {
    command.stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = String::new();
                if let Some(mut stdout) = child.stdout.take() {
                    let _ = stdout.read_to_string(&mut out);
                }
                if status.success() {
                    return Some(out);
                }
                return None;
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(40)),
            Err(_) => return None,
        }
    }
}

/// Logs the missing-script warning once per process instead of every poll —
/// it fires on every browser-focused tick otherwise, which is noisy.
#[allow(dead_code)]
static WARNED_MISSING_SCRIPT: std::sync::OnceLock<()> = std::sync::OnceLock::new();

pub fn read_browser_url(
    script_path: &Path,
    macos_script_path: &Path,
    window: &ForegroundWindow,
) -> Option<String> {
    if !window.is_browser {
        return None;
    }
    let timeout = Duration::from_secs(URL_SCRIPT_TIMEOUT_SEC);
    #[cfg(windows)]
    {
        let _ = macos_script_path;

        // Preferred path: in-process UI Automation against a cached address-bar
        // element. No subprocess, and on every tick after the first for a given
        // window, no tree walk either - see capture/uia_url.rs.
        if crate::capture::uia_url::healthy() {
            let url = crate::capture::uia_url::read_url(window.hwnd, timeout);
            if let Some(url) = url {
                return Some(url.chars().take(MAX_URL_LEN).collect());
            }
            // Trust the reader's "no URL here" and skip the subprocess - that
            // is the whole point on a page heavy enough to be a problem.
            if crate::capture::uia_url::healthy() {
                return None;
            }
            log::warn!(
                "URL capture: in-process UIA reader produced nothing in its trial window; falling back to get-browser-url.ps1"
            );
        }

        if !script_path.exists() {
            if WARNED_MISSING_SCRIPT.set(()).is_ok() {
                log::warn!(
                    "URL capture disabled: script not found at {}",
                    script_path.display()
                );
            }
            return None;
        }
        let mut cmd = Command::new("powershell");
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.args([
            "-STA",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &script_path.to_string_lossy(),
        ]);
        if window.hwnd != 0 {
            cmd.args(["-WindowHandle", &window.hwnd.to_string()]);
        }
        let hint = if window.browser_hint.is_empty() {
            browser_hint_from_exe(&window.process_name.to_lowercase())
        } else {
            window.browser_hint.clone()
        };
        if !hint.is_empty() {
            cmd.args(["-BrowserHint", &hint]);
        }
        let Some(stdout) = run_command_timeout(cmd, timeout) else {
            log::warn!("URL capture: get-browser-url.ps1 failed or timed out for {}", window.process_name);
            return None;
        };
        let url = stdout.lines().next().unwrap_or("").trim();
        if url.starts_with("http://") || url.starts_with("https://") {
            return Some(url.chars().take(MAX_URL_LEN).collect());
        }
        log::warn!("URL capture: no URL in script output for {} ({:?})", window.process_name, url);
        None
    }
    #[cfg(target_os = "macos")]
    {
        let _ = script_path;
        if !macos_script_path.exists() {
            if WARNED_MISSING_SCRIPT.set(()).is_ok() {
                log::warn!(
                    "URL capture disabled: script not found at {}",
                    macos_script_path.display()
                );
            }
            return None;
        }
        // get-browser-url-macos.applescript expects (bundleId, processName) -
        // this agent doesn't have a bundle identifier for the focused app
        // (xcap::Window exposes app_name/pid, not bundle id), so bundleId is
        // passed empty. The script's own tryBrowserByBundle("") short-
        // circuits immediately and falls through to tryBrowserByProcess(),
        // which matches on exactly the process_name this agent does have -
        // this was passing process_name for *both* arguments before MAC-2
        // made is_browser true on macOS at all, which is why the mismatch
        // was never reachable/noticed.
        let mut cmd = Command::new("osascript");
        cmd.arg(macos_script_path)
            .arg("")
            .arg(&window.process_name);
        let Some(stdout) = run_command_timeout(cmd, timeout) else {
            log::warn!("URL capture: osascript failed or timed out for {}", window.process_name);
            return None;
        };
        let url = stdout.lines().next().unwrap_or("").trim();
        if url.starts_with("http://") || url.starts_with("https://") {
            return Some(url.chars().take(MAX_URL_LEN).collect());
        }
        None
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (script_path, macos_script_path, timeout, window);
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // browser_hint_from_exe is shared between the Windows path (.exe names)
    // and MAC-2's macOS path (app_name display strings, e.g. "Google
    // Chrome") - both compile and run on this platform since the function
    // itself has no #[cfg], only its callers do. Guards MAC-2's "safari"
    // addition and that it doesn't disturb the existing Windows mappings.

    #[test]
    fn recognizes_macos_app_display_names() {
        assert_eq!(browser_hint_from_exe("safari"), "safari");
        assert_eq!(browser_hint_from_exe("google chrome"), "chrome");
        assert_eq!(browser_hint_from_exe("microsoft edge"), "edge");
        assert_eq!(browser_hint_from_exe("brave browser"), "brave");
    }

    #[test]
    fn still_recognizes_windows_exe_names_unchanged() {
        assert_eq!(browser_hint_from_exe("chrome.exe"), "chrome");
        assert_eq!(browser_hint_from_exe("msedge.exe"), "edge");
        assert_eq!(browser_hint_from_exe("firefox.exe"), "firefox");
        assert_eq!(browser_hint_from_exe("vivaldi.exe"), "vivaldi");
    }

    #[test]
    fn a_non_browser_process_never_matches_safari_by_accident() {
        // "safari" is a substring-only check - confirm it doesn't fire on
        // unrelated names that happen to share letters with real browsers.
        assert_eq!(browser_hint_from_exe("notepad.exe"), "");
        assert_eq!(browser_hint_from_exe("slack.exe"), "");
    }
}
