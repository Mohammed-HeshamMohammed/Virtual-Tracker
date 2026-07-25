use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

use crate::constants::{MAX_URL_LEN, URL_SCRIPT_TIMEOUT_SEC};

static DISPLAY_OVERRIDES: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();

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
    pub hwnd: usize,
    pub is_browser: bool,
    pub browser_hint: String,
}

pub fn get_foreground_window() -> ForegroundWindow {
    #[cfg(windows)]
    {
        get_foreground_window_win()
    }
    #[cfg(not(windows))]
    {
        ForegroundWindow {
            app_name: "Unknown".into(),
            title: "Unknown".into(),
            process_name: String::new(),
            hwnd: 0,
            is_browser: false,
            browser_hint: String::new(),
        }
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
            hwnd: hwnd_val,
            is_browser,
            browser_hint,
        }
    }
}

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

fn browser_hint_from_exe(exe: &str) -> String {
    if exe.contains("chrome") {
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

fn run_command_timeout(mut command: Command, timeout: Duration) -> Option<String> {
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
static WARNED_MISSING_SCRIPT: std::sync::OnceLock<()> = std::sync::OnceLock::new();

pub fn read_browser_url(
    script_path: &PathBuf,
    macos_script_path: &PathBuf,
    window: &ForegroundWindow,
) -> Option<String> {
    if !window.is_browser {
        return None;
    }
    let timeout = Duration::from_secs(URL_SCRIPT_TIMEOUT_SEC);
    #[cfg(windows)]
    {
        let _ = macos_script_path;
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
        log::debug!("URL capture: no URL in script output for {} ({:?})", window.process_name, url);
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
        let mut cmd = Command::new("osascript");
        cmd.arg(macos_script_path)
            .arg(&window.process_name)
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
