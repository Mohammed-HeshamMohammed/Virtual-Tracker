//! Start-at-login on Windows, via a scheduled task rather than the Run key.
//!
//! build.rs embeds a `requireAdministrator` manifest, so every launch of this
//! app needs elevation. Windows runs `HKCU\...\Run` entries in the user's
//! ordinary, unelevated token at logon and deliberately does **not** raise a
//! UAC prompt for them - a logon that prompted once per startup entry would be
//! unusable. A Run entry pointing at a requireAdministrator binary therefore
//! fails with ERROR_ELEVATION_REQUIRED (740) and nothing starts, silently.
//!
//! That is what `tauri-plugin-autostart` writes, so "Start at login" has been
//! registering an entry that cannot work. The symptom is not an error: it is
//! an agent that is simply never running after a reboot.
//!
//! A scheduled task with `RunLevel=HighestAvailable` is the supported way to
//! start an elevated program at logon without a prompt. Registering one needs
//! elevation, which this process already has by virtue of the same manifest
//! that created the problem.

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Task Scheduler folder. The prefix keeps these out of the root listing,
/// where they would sit among Windows' own tasks.
pub const TASK_FOLDER: &str = "\\My Virtual Tracker";

/// One task per user, because the Run key this replaces was per-user (HKCU)
/// and a shared machine has to keep working. Registration needs `/F`, so a
/// single fixed name would mean the second person to sign in silently
/// overwrote the first person's task with one triggered by their own logon -
/// turning autostart off for user one with nothing to show for it.
pub fn task_name(user_id: &str) -> String {
    // Backslash separates Task Scheduler folders, so a DOMAIN\user name has to
    // lose it or the task lands in a folder named after the domain instead.
    format!("{TASK_FOLDER}\\Start at login ({})", user_id.replace('\\', "-"))
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The task definition. Written as XML rather than assembled from `schtasks`
/// flags because `/RL HIGHEST` combined with a logon trigger is not
/// expressible on the command line for an arbitrary user, and because XML is
/// the only form that can set `StartWhenAvailable` and disable the battery
/// conditions - a laptop on battery would otherwise refuse to start the task,
/// which for a time tracker means it silently does not run all day.
pub fn task_xml(exe_path: &str, user_id: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Starts My Virtual Tracker when {user} signs in.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>{user}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>false</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{exe}</Command>
    </Exec>
  </Actions>
</Task>
"#,
        user = xml_escape(user_id),
        exe = xml_escape(exe_path),
    )
}

/// The five predefined XML entities. A Windows account name can legitimately
/// contain `&` (rare but valid in a domain form), and an install path can
/// contain one easily - unescaped, either produces XML the Task Scheduler
/// rejects with a parse error that says nothing about the cause.
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Nanosecond component for the staging filename, so two runs - or a
/// recycled pid - cannot collide on a path that create_new then refuses.
#[cfg(windows)]
fn now_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

#[cfg(windows)]
fn current_user_id() -> Result<String, String> {
    // USERDOMAIN\USERNAME rather than USERNAME alone: a logon trigger with a
    // bare name fails to resolve on a domain-joined machine.
    let user = std::env::var("USERNAME").map_err(|_| "USERNAME is not set".to_string())?;
    match std::env::var("USERDOMAIN") {
        Ok(domain) if !domain.is_empty() => Ok(format!("{domain}\\{user}")),
        _ => Ok(user),
    }
}

#[cfg(windows)]
fn run_schtasks(args: &[&str]) -> Result<(), String> {
    let output = std::process::Command::new("schtasks.exe")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("could not run schtasks: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    // schtasks writes its diagnostics to stdout as often as to stderr.
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
    Err(format!("schtasks failed ({}): {detail}", output.status))
}

#[cfg(windows)]
pub fn enable() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("cannot locate the tracker: {e}"))?;
    let user = current_user_id()?;
    let xml = task_xml(&exe.to_string_lossy(), &user);

    // UTF-16LE with a BOM: schtasks /XML rejects UTF-8 outright, and the
    // declaration above says UTF-16 regardless of what the bytes are.
    let mut bytes = vec![0xFF, 0xFE];
    for unit in xml.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }

    // create_new rather than write: this process is elevated, and the path is
    // predictable, so an existing file at it could be a symlink pointing
    // somewhere an unelevated caller could not write to themselves. Refusing
    // to open anything that already exists closes that without needing to
    // reason about who can write to the temp directory.
    let dir = std::env::temp_dir();
    let path = dir.join(format!("vt-autostart-{}-{:x}.xml", std::process::id(), now_nanos()));
    {
        use std::io::Write;
        let mut file = std::fs::File::create_new(&path)
            .map_err(|e| format!("cannot stage the task definition: {e}"))?;
        file.write_all(&bytes).map_err(|e| format!("cannot stage the task definition: {e}"))?;
    }

    let result =
        run_schtasks(&["/Create", "/TN", &task_name(&user), "/XML", &path.to_string_lossy(), "/F"]);
    let _ = std::fs::remove_file(&path);
    remember(result.is_ok());
    result
}

#[cfg(windows)]
pub fn disable() -> Result<(), String> {
    let user = current_user_id()?;
    match run_schtasks(&["/Delete", "/TN", &task_name(&user), "/F"]) {
        Ok(()) => {
            remember(false);
            Ok(())
        }
        // Deleting a task that was never registered is the desired end state,
        // not a failure - turning the setting off twice must not report an error.
        Err(e) if e.contains("cannot find") || e.contains("does not exist") => {
            remember(false);
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// Cached because every read costs a `schtasks.exe` process - cheap once,
/// wasteful three times over during startup, which is when the frontend asks.
/// Registration is the only thing that changes the answer, and it goes
/// through enable/disable below, so the cache cannot go stale behind us.
#[cfg(windows)]
static TASK_REGISTERED: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(UNKNOWN);

#[cfg(windows)]
const UNKNOWN: u8 = 0;
#[cfg(windows)]
const REGISTERED: u8 = 1;
#[cfg(windows)]
const ABSENT: u8 = 2;

#[cfg(windows)]
fn remember(registered: bool) {
    TASK_REGISTERED.store(
        if registered { REGISTERED } else { ABSENT },
        std::sync::atomic::Ordering::Relaxed,
    );
}

#[cfg(windows)]
pub fn is_enabled() -> bool {
    match TASK_REGISTERED.load(std::sync::atomic::Ordering::Relaxed) {
        REGISTERED => true,
        ABSENT => false,
        _ => {
            let found = current_user_id()
                .map(|user| run_schtasks(&["/Query", "/TN", &task_name(&user)]).is_ok())
                .unwrap_or(false);
            remember(found);
            found
        }
    }
}

#[cfg(not(windows))]
pub fn enable() -> Result<(), String> {
    Err("scheduled-task autostart is Windows-only".to_string())
}

#[cfg(not(windows))]
pub fn disable() -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub fn is_enabled() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_task_runs_elevated_at_logon() {
        let xml = task_xml(r"C:\Program Files\My Virtual Tracker\app.exe", "PC\\user");
        // HighestAvailable is the entire point: without it the task starts the
        // app unelevated and the requireAdministrator manifest refuses it,
        // which is exactly the Run-key failure this replaces.
        assert!(xml.contains("<RunLevel>HighestAvailable</RunLevel>"));
        assert!(xml.contains("<LogonTrigger>"));
        assert!(xml.contains("<UserId>PC\\user</UserId>"));
    }

    #[test]
    fn a_laptop_on_battery_still_starts_the_tracker() {
        // Task Scheduler defaults both of these to true. A time tracker that
        // silently does not run whenever the machine is unplugged would look
        // exactly like the bug this module is fixing.
        let xml = task_xml("app.exe", "user");
        assert!(xml.contains("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>"));
        assert!(xml.contains("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>"));
    }

    #[test]
    fn the_task_never_times_out() {
        // The default execution time limit is 72 hours, after which Task
        // Scheduler would terminate a tracker that had simply been running.
        let xml = task_xml("app.exe", "user");
        assert!(xml.contains("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"));
        assert!(xml.contains("<AllowHardTerminate>false</AllowHardTerminate>"));
    }

    #[test]
    fn a_second_logon_does_not_start_a_second_tracker() {
        let xml = task_xml("app.exe", "user");
        assert!(xml.contains("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>"));
    }

    #[test]
    fn ampersands_in_a_path_or_user_are_escaped() {
        // "C:\Program Files\R&D\app.exe" is a perfectly ordinary path and
        // produces XML the Task Scheduler rejects if passed through raw.
        let xml = task_xml(r"C:\R&D\app.exe", "DOM&AIN\\user");
        assert!(xml.contains(r"C:\R&amp;D\app.exe"));
        assert!(xml.contains("DOM&amp;AIN\\user"));
        assert!(!xml.contains("R&D"));
    }

    #[test]
    fn every_predefined_entity_is_escaped() {
        assert_eq!(xml_escape(r#"&<>"'"#), "&amp;&lt;&gt;&quot;&apos;");
        // Ampersand first, or the escapes of the other four get re-escaped
        // into &amp;lt; and the definition is wrong in a way that still parses.
        assert_eq!(xml_escape("<&>"), "&lt;&amp;&gt;");
    }

    #[test]
    fn the_task_lives_in_its_own_folder() {
        assert!(task_name("user").starts_with("\\My Virtual Tracker\\"));
    }

    #[test]
    fn two_users_on_one_machine_get_two_tasks() {
        // Registration passes /F, so a shared name would mean the second
        // person to sign in overwrote the first person's task and quietly
        // turned their autostart off.
        assert_ne!(task_name(r"PC\alice"), task_name(r"PC\bob"));
    }

    #[test]
    fn a_domain_qualified_name_does_not_nest_the_task_under_the_domain() {
        // Backslash is the folder separator: left in, DOMAIN\user would put
        // the task in a folder named after the domain instead of ours.
        let name = task_name(r"DOMAIN\user");
        assert_eq!(name.matches('\\').count(), 2, "only our own two folder separators");
        assert!(name.contains("DOMAIN-user"));
    }
}
