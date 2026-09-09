//! App-icon extraction. Windows-only: shells out to `get-app-icon.ps1`, which
//! renders the executable's associated icon to a 32x32 PNG and prints it as a
//! `data:image/png;base64,…` line. Everything else is a no-op — the UI falls
//! back to a coloured letter tile, exactly as before this existed.

use std::path::Path;
use std::time::Duration;

use crate::constants::{APP_ICON_SCRIPT_TIMEOUT_SEC, MAX_APP_ICON_LEN};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Returns a `data:image/png;base64,…` string for the given executable's icon,
/// or `None` if it can't be read (non-Windows, missing script, missing exe,
/// script failure, or an implausibly large result).
pub fn read_app_icon(script_path: &Path, exe_path: &str) -> Option<String> {
    if exe_path.is_empty() {
        return None;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};

        if !script_path.exists() {
            return None;
        }
        let mut cmd = Command::new("powershell");
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.stdout(Stdio::piped()).stderr(Stdio::null());
        cmd.args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &script_path.to_string_lossy(),
            "-ExePath",
            exe_path,
        ]);
        let out = crate::capture::window::run_command_timeout(
            cmd,
            Duration::from_secs(APP_ICON_SCRIPT_TIMEOUT_SEC),
        )?;
        let line = out.lines().next().unwrap_or("").trim();
        if line.starts_with("data:image/png;base64,")
            && line.len() > "data:image/png;base64,".len()
            && line.len() <= MAX_APP_ICON_LEN
        {
            return Some(line.to_string());
        }
        None
    }
    #[cfg(not(windows))]
    {
        let _ = script_path;
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn empty_exe_path_is_none() {
        assert_eq!(read_app_icon(&PathBuf::from("whatever.ps1"), ""), None);
    }

    #[test]
    fn missing_script_is_none() {
        assert_eq!(
            read_app_icon(&PathBuf::from("does-not-exist-get-app-icon.ps1"), "C:\\Windows\\explorer.exe"),
            None
        );
    }
}
