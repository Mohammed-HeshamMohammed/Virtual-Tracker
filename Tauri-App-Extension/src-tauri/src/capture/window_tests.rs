//! Tests for window.rs.

#[allow(unused_imports)]
use super::*;

#[cfg(test)]
mod tests {
    use super::*;

    // Browser_hint_from_exe now delegates to capture/browsers.rs and returns the browser's
    // UI Automation pane name rather than a short vendor tag - that's what

    #[test]
    fn recognizes_macos_app_display_names() {
        assert_eq!(browser_hint_from_exe("safari"), "Safari");
        assert_eq!(browser_hint_from_exe("google chrome"), "Google Chrome");
        assert_eq!(browser_hint_from_exe("microsoft edge"), "Microsoft Edge");
        assert_eq!(browser_hint_from_exe("brave browser"), "Brave");
        assert_eq!(browser_hint_from_exe("firefox"), "Mozilla Firefox");
    }

    #[test]
    fn still_recognizes_windows_exe_names() {
        assert_eq!(browser_hint_from_exe("chrome.exe"), "Google Chrome");
        assert_eq!(browser_hint_from_exe("msedge.exe"), "Microsoft Edge");
        assert_eq!(browser_hint_from_exe("firefox.exe"), "Mozilla Firefox");
        assert_eq!(browser_hint_from_exe("vivaldi.exe"), "Vivaldi");
        // Browsers the old hardcoded list never covered.
        assert_eq!(browser_hint_from_exe("librewolf.exe"), "LibreWolf");
        assert_eq!(browser_hint_from_exe("arc.exe"), "Arc");
        // The hint is the UIA *pane* name, which isn't always the display name - Whale's
        // window pane is just "Whale".
        assert_eq!(browser_hint_from_exe("whale.exe"), "Whale");
    }

    #[test]
    fn a_non_browser_process_never_matches_by_accident() {
        for exe in ["notepad.exe", "slack.exe", "search.exe", "monarch.exe"] {
            assert_eq!(browser_hint_from_exe(exe), "", "{exe} is not a browser");
        }
    }

    fn win(process_name: &str, app_name: &str, hwnd: usize) -> ForegroundWindow {
        ForegroundWindow {
            app_name: app_name.into(),
            title: "some title".into(),
            process_name: process_name.into(),
            exe_path: String::new(),
            hwnd,
            is_browser: false,
            browser_hint: String::new(),
        }
    }

    // Windows' own chrome kept turning up in Top Apps: opening the Start menu or clicking
    // the search box puts one of these in front, and each was logged as an app by its
    #[test]
    fn windows_own_shell_surfaces_are_not_apps() {
        for exe in [
            "SearchHost.exe",
            "ShellExperienceHost.exe",
            "StartMenuExperienceHost.exe",
            "LockApp.exe",
            "TextInputHost.exe",
            "ShellHost.exe",
        ] {
            assert!(
                win(exe, "Whatever", 42).is_shell_surface(),
                "{exe} should not count as an app"
            );
        }
    }

    // The frame host is only ever a stand-in for the packaged app inside it.
    #[test]
    fn an_unresolved_frame_host_is_not_an_app() {
        assert!(win("ApplicationFrameHost.exe", "Applicationframehost", 42).is_shell_surface());
        assert!(!win("CalculatorApp.exe", "Calculator", 42).is_shell_surface());
    }

    #[test]
    fn a_shell_surface_is_matched_whatever_its_case() {
        assert!(win("searchhost.EXE", "Search", 42).is_shell_surface());
        assert!(win("  LockApp.exe  ", "Lock", 42).is_shell_surface());
    }

    #[test]
    fn real_apps_are_never_mistaken_for_shell_surfaces() {
        for exe in [
            "code.exe",
            "chrome.exe",
            "explorer.exe",
            "spotify.exe",
            "hubstaffclient.exe",
        ] {
            assert!(
                !win(exe, "App", 42).is_shell_surface(),
                "{exe} is a real app"
            );
        }
    }

    // Packaged apps resolve to executables named for their package, which the generic
    // title-caser turns into "Calculatorapp" and "Snippingtool".
    #[test]
    fn packaged_apps_get_the_name_people_know_them_by() {
        assert_eq!(
            resolve_display_name("CalculatorApp.exe", "Calculator"),
            "Calculator"
        );
        assert_eq!(
            resolve_display_name("SnippingTool.exe", "Snip"),
            "Snipping Tool"
        );
        assert_eq!(
            resolve_display_name("HubstaffClient.exe", "Hubstaff"),
            "Hubstaff"
        );
        assert_eq!(
            resolve_display_name("Acrobat.exe", "Acrobat"),
            "Adobe Acrobat"
        );
    }

    // An executable nobody has an override for still reads as a name rather than a filename
    // - that path is unchanged.
    #[test]
    fn an_unknown_executable_still_title_cases_its_own_name() {
        assert_eq!(
            resolve_display_name("some_new_tool.exe", "x"),
            "Some New Tool"
        );
    }

    #[test]
    fn a_real_window_is_identified() {
        assert!(win("code.exe", "VS Code", 42).is_identified());
    }

    #[test]
    fn the_unknown_sentinel_is_not_an_app() {
        assert!(!win("Unknown", "Unknown", 42).is_identified());
        assert!(!win("unknown", "Unknown", 42).is_identified());
        assert!(!win("Unknown", "Some App", 42).is_identified());
        assert!(!win("code.exe", "Unknown", 42).is_identified());
    }

    #[test]
    fn a_process_we_could_not_name_is_not_an_app() {
        assert!(!win("", "", 42).is_identified());
        assert!(!win("   ", "VS Code", 42).is_identified());
    }

    // No foreground window at all - the desktop between alt-tabs, or the lock screen.
    #[cfg(windows)]
    #[test]
    fn no_foreground_window_is_not_an_app() {
        assert!(!win("code.exe", "VS Code", 0).is_identified());
    }
}
