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

/// Suppresses the console window a spawned powershell/cmd process would otherwise flash on
/// screen — this runs silently in the background.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// This cluster backs Windows's own get_foreground_window_win/resolve_display_name path
// specifically - macOS gets its display name straight from xcap's app_name instead (see
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
            // Packaged (Store) apps, now that they resolve past ApplicationFrameHost: their
            // executables are named for the package, which title-cases into things like
            ("calculatorapp.exe", "Calculator"),
            ("calculator.exe", "Calculator"),
            ("spotify.exe", "Spotify"),
            ("whatsapp.exe", "WhatsApp"),
            ("snippingtool.exe", "Snipping Tool"),
            ("screenclippinghost.exe", "Snipping Tool"),
            ("systemsettings.exe", "Settings"),
            ("photos.exe", "Photos"),
            ("hubstaffclient.exe", "Hubstaff"),
            ("acrobat.exe", "Adobe Acrobat"),
            ("acrord32.exe", "Adobe Acrobat Reader"),
            ("teams.exe", "Microsoft Teams"),
            ("ms-teams.exe", "Microsoft Teams"),
            ("outlook.exe", "Microsoft Outlook"),
            ("olk.exe", "Microsoft Outlook"),
            ("notepad.exe", "Notepad"),
            ("mspaint.exe", "Paint"),
        ])
    })
}

// Browser detection and naming now come from capture/browsers.rs - one table instead of a
// list here, another in the PowerShell script, and a third in uia_url.rs, each of which had

#[derive(Debug, Clone)]
pub struct ForegroundWindow {
    pub app_name: String,
    pub title: String,
    pub process_name: String,
    /// Full path to the executable.
    pub exe_path: String,
    // Read back only inside read_browser_url's #[cfg(windows)] branch - always constructed
    // (every get_foreground_window_* branch sets them, hwnd to 0 where there's no such
    #[allow(dead_code)]
    pub hwnd: usize,
    pub is_browser: bool,
    #[allow(dead_code)]
    pub browser_hint: String,
}

/// The name used when the foreground window could not be identified at all.
pub const UNIDENTIFIED: &str = "Unknown";

/// Windows' own shell surfaces, which are chrome rather than programs: the Start menu, the
/// search flyout, the lock screen, the touch keyboard, the notification centre, and the
const SHELL_SURFACES: &[&str] = &[
    "applicationframehost.exe",
    "lockapp.exe",
    "searchapp.exe",
    "searchhost.exe",
    "searchui.exe",
    "shellexperiencehost.exe",
    "shellhost.exe",
    "startmenuexperiencehost.exe",
    "textinputhost.exe",
    "windowsinternal.composableshell.experiences.textinput.inputapp.exe",
];

impl ForegroundWindow {
    /// Whether we actually know what the member was looking at.
    pub fn is_identified(&self) -> bool {
        if self.hwnd == 0 && cfg!(windows) {
            return false;
        }
        let process = self.process_name.trim();
        if process.is_empty() || process.eq_ignore_ascii_case(UNIDENTIFIED) {
            return false;
        }
        let app = self.app_name.trim();
        !app.is_empty() && !app.eq_ignore_ascii_case(UNIDENTIFIED)
    }

    /// Whether this is one of Windows' own shell surfaces rather than an app the member
    /// chose to use.
    pub fn is_shell_surface(&self) -> bool {
        let process = self.process_name.trim().to_lowercase();
        SHELL_SURFACES.contains(&process.as_str())
    }
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

/// MAC-2: `xcap::Window` (already a dependency here for screenshot capture, `screen.rs`)
/// does the NSWorkspace/CGWindowListCopyWindowInfo work internally on macOS - see xcap's
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
    // MacOS has no separate exe-vs-display-name split the way Windows does - xcap's
    // app_name() is already the display name ("Google Chrome"), and it's also exactly what
    let process_name = app_name.clone();
    let browser_hint = browser_hint_from_exe(&app_name.to_lowercase());
    let is_browser = !browser_hint.is_empty();

    ForegroundWindow {
        app_name,
        title,
        process_name,
        // App-icon extraction is Windows-only (capture/app_icon.rs); xcap gives no
        // executable path on macOS anyway.
        exe_path: String::new(),
        // HWND is a Windows-specific concept with no macOS equivalent; the only consumer of
        // this field is #[cfg(windows)]-gated, so 0 here is inert, not a placeholder
        hwnd: 0,
        is_browser,
        browser_hint,
    }
}

/// The window class a packaged (Store/UWP) app's real window carries, inside the frame
/// `ApplicationFrameHost.exe` draws around it.
#[cfg(windows)]
const CORE_WINDOW_CLASS: &str = "Windows.UI.Core.CoreWindow";

#[cfg(windows)]
struct CoreWindowSearch {
    host_pid: u32,
    found_pid: u32,
}

/// Looks for the frame's real occupant: a CoreWindow child belonging to some other process.
#[cfg(windows)]
unsafe extern "system" fn core_window_probe(
    child: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::BOOL {
    use windows::Win32::Foundation::BOOL;
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetWindowThreadProcessId};

    let search = &mut *(lparam.0 as *mut CoreWindowSearch);
    let mut class = [0u16; 128];
    let written = GetClassNameW(child, &mut class);
    if written > 0 {
        let name = String::from_utf16_lossy(&class[..written as usize]);
        if name == CORE_WINDOW_CLASS {
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(child, Some(&mut pid));
            if pid != 0 && pid != search.host_pid {
                search.found_pid = pid;
                return BOOL(0);
            }
        }
    }
    BOOL(1)
}

/// The process actually behind a packaged app's window.
#[cfg(windows)]
unsafe fn packaged_app_pid(host: windows::Win32::Foundation::HWND, host_pid: u32) -> Option<u32> {
    use windows::Win32::Foundation::LPARAM;
    use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

    let mut search = CoreWindowSearch {
        host_pid,
        found_pid: 0,
    };
    let _ = EnumChildWindows(
        host,
        Some(core_window_probe),
        LPARAM(&mut search as *mut CoreWindowSearch as isize),
    );
    (search.found_pid != 0).then_some(search.found_pid)
}

/// `(file name, full path)` of a pid's executable.
#[cfg(windows)]
unsafe fn process_image_for_pid(pid: u32) -> Option<(String, String)> {
    use windows::Win32::Foundation::MAX_PATH;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    if pid == 0 {
        return None;
    }
    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut buf = [0u16; MAX_PATH as usize];
    let mut size = buf.len() as u32;
    let read = QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_FORMAT(0),
        windows::core::PWSTR(buf.as_mut_ptr()),
        &mut size,
    )
    .is_ok();
    let _ = windows::Win32::Foundation::CloseHandle(handle);
    if !read {
        return None;
    }
    let full_path = String::from_utf16_lossy(&buf[..size as usize]);
    let name = PathBuf::from(full_path.as_str())
        .file_name()
        .map(|name| name.to_string_lossy().to_string())?;
    Some((name, full_path))
}

#[cfg(windows)]
fn get_foreground_window_win() -> ForegroundWindow {
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

        let mut process_name = String::from(UNIDENTIFIED);
        let mut exe_path = String::new();
        if let Some((name, path)) = process_image_for_pid(pid) {
            process_name = name;
            exe_path = path;
        }

        // A packaged app hides behind the frame host that draws it; ask the frame's
        // children who is really in there.
        if process_name.eq_ignore_ascii_case("ApplicationFrameHost.exe") {
            if let Some(real_pid) = packaged_app_pid(hwnd, pid) {
                if let Some((name, path)) = process_image_for_pid(real_pid) {
                    process_name = name;
                    exe_path = path;
                }
            }
        }

        let exe_lower = process_name.to_lowercase();
        let is_browser = crate::capture::browsers::is_browser(&exe_lower);
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

// Its own tests below call this directly on every platform (deliberately - see their
// comment), so it's never actually dead where it matters; the #[allow] is only for the
#[allow(dead_code)]
fn browser_hint_from_exe(exe: &str) -> String {
    crate::capture::browsers::browser_hint(exe)
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

/// Logs the missing-script warning once per process instead of every poll — it fires on
/// every browser-focused tick otherwise, which is noisy.
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

        // Preferred path: in-process UI Automation against a cached address-bar element.
        if crate::capture::uia_url::healthy() {
            let url = crate::capture::uia_url::read_url(window.hwnd, timeout);
            if let Some(url) = url {
                return Some(url.chars().take(MAX_URL_LEN).collect());
            }
            if crate::capture::uia_url::healthy() {
                return url_from_history(window);
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
            return url_from_history(window);
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
            return url_from_history(window);
        };
        let url = stdout.lines().next().unwrap_or("").trim();
        if url.starts_with("http://") || url.starts_with("https://") {
            return Some(url.chars().take(MAX_URL_LEN).collect());
        }
        log::warn!("URL capture: no URL in script output for {} ({:?})", window.process_name, url);
        url_from_history(window)
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
        // Get-browser-url-macos.applescript expects (bundleId, processName) - this agent
        // doesn't have a bundle identifier for the focused app (xcap::Window exposes
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


/// Last resort when nothing could read the address bar live: ask the browser's own history
/// what URL it recorded for the page title we can see.
#[cfg(windows)]
fn url_from_history(window: &ForegroundWindow) -> Option<String> {
    let url = crate::capture::history::lookup_url_by_title(&window.process_name, &window.title)?;
    log::debug!(
        "URL capture: resolved {} from browser history by page title",
        window.process_name
    );
    Some(url.chars().take(MAX_URL_LEN).collect())
}

#[cfg(test)]
#[path = "window_tests.rs"]
mod window_tests;
