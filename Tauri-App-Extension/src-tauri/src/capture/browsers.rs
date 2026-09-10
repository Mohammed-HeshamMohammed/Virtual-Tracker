//! One table of everything the agent knows about browsers.
//!
//! This used to be spread across four places that had each drifted to a
//! different, incomplete list: `BROWSER_EXES` and `browser_hint_from_exe` in
//! window.rs, `$browserPaneNames` in get-browser-url.ps1, the omnibox ids in
//! uia_url.rs, and `isBrowserAppName` on the backend. Adding a browser meant
//! remembering all four, so in practice a browser was "supported" by whichever
//! subset someone had thought to update.
//!
//! Everything browser-shaped now resolves from `BROWSERS`: foreground
//! detection, the display name, the UI Automation pane name, which omnibox
//! selectors to try, and where the history database lives.

use std::path::PathBuf;

/// What a browser is built on. Decides the omnibox selectors and the shape of
/// the history database - the two things that vary by engine rather than by
/// vendor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    /// Chrome, Edge, Brave, Opera, Vivaldi, Arc, Yandex, Whale...
    Chromium,
    /// Firefox, Waterfox, LibreWolf, Zen...
    Gecko,
    /// Safari and IE - detected so we don't mistake them for non-browsers,
    /// but neither exposes anything we can read on Windows.
    Other,
}

/// Where a browser keeps its profile data, relative to a Windows base dir.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileBase {
    /// `%LOCALAPPDATA%`
    Local,
    /// `%APPDATA%` (roaming)
    Roaming,
    /// No readable profile on this platform.
    None,
}

pub struct Browser {
    /// Executable names, lowercased. Several browsers ship more than one.
    pub exes: &'static [&'static str],
    /// Human name, and what `resolve_display_name` should report.
    pub display_name: &'static str,
    /// The `Name` of the browser's own UI Automation pane, used to scope the
    /// address-bar search away from page content.
    pub pane_name: &'static str,
    pub engine: Engine,
    pub profile_base: ProfileBase,
    /// Directory under `profile_base` holding the profile(s).
    pub profile_dir: &'static str,
}

/// Every browser the agent recognises. Order matters only for the first-match
/// exe lookup, and no exe appears twice.
pub const BROWSERS: &[Browser] = &[
    Browser {
        exes: &["chrome.exe"],
        display_name: "Google Chrome",
        pane_name: "Google Chrome",
        engine: Engine::Chromium,
        profile_base: ProfileBase::Local,
        profile_dir: r"Google\Chrome\User Data",
    },
    Browser {
        exes: &["msedge.exe"],
        display_name: "Microsoft Edge",
        pane_name: "Microsoft Edge",
        engine: Engine::Chromium,
        profile_base: ProfileBase::Local,
        profile_dir: r"Microsoft\Edge\User Data",
    },
    Browser {
        exes: &["brave.exe"],
        display_name: "Brave",
        pane_name: "Brave",
        engine: Engine::Chromium,
        profile_base: ProfileBase::Local,
        profile_dir: r"BraveSoftware\Brave-Browser\User Data",
    },
    Browser {
        exes: &["vivaldi.exe"],
        display_name: "Vivaldi",
        pane_name: "Vivaldi",
        engine: Engine::Chromium,
        profile_base: ProfileBase::Local,
        profile_dir: r"Vivaldi\User Data",
    },
    Browser {
        exes: &["chromium.exe"],
        display_name: "Chromium",
        pane_name: "Chromium",
        engine: Engine::Chromium,
        profile_base: ProfileBase::Local,
        profile_dir: r"Chromium\User Data",
    },
    // Opera keeps profiles directly under a roaming per-channel folder rather
    // than the usual "User Data/<Profile>" layout.
    Browser {
        exes: &["opera.exe", "launcher.exe"],
        display_name: "Opera",
        pane_name: "Opera",
        engine: Engine::Chromium,
        profile_base: ProfileBase::Roaming,
        profile_dir: r"Opera Software\Opera Stable",
    },
    Browser {
        exes: &["operagx.exe"],
        display_name: "Opera GX",
        pane_name: "Opera GX",
        engine: Engine::Chromium,
        profile_base: ProfileBase::Roaming,
        profile_dir: r"Opera Software\Opera GX Stable",
    },
    Browser {
        exes: &["arc.exe"],
        display_name: "Arc",
        pane_name: "Arc",
        engine: Engine::Chromium,
        profile_base: ProfileBase::Local,
        profile_dir: r"Packages\TheBrowserCompany.Arc_ykqwq191bcr7j\LocalCache\Local\Arc\User Data",
    },
    Browser {
        exes: &["yandex.exe", "browser.exe"],
        display_name: "Yandex Browser",
        pane_name: "Yandex",
        engine: Engine::Chromium,
        profile_base: ProfileBase::Local,
        profile_dir: r"Yandex\YandexBrowser\User Data",
    },
    Browser {
        exes: &["whale.exe"],
        display_name: "Naver Whale",
        pane_name: "Whale",
        engine: Engine::Chromium,
        profile_base: ProfileBase::Local,
        profile_dir: r"Naver\Naver Whale\User Data",
    },
    Browser {
        exes: &["firefox.exe"],
        display_name: "Mozilla Firefox",
        pane_name: "Mozilla Firefox",
        engine: Engine::Gecko,
        profile_base: ProfileBase::Roaming,
        profile_dir: r"Mozilla\Firefox",
    },
    Browser {
        exes: &["waterfox.exe"],
        display_name: "Waterfox",
        pane_name: "Waterfox",
        engine: Engine::Gecko,
        profile_base: ProfileBase::Roaming,
        profile_dir: r"Waterfox",
    },
    Browser {
        exes: &["librewolf.exe"],
        display_name: "LibreWolf",
        pane_name: "LibreWolf",
        engine: Engine::Gecko,
        profile_base: ProfileBase::Roaming,
        profile_dir: r"librewolf",
    },
    Browser {
        exes: &["zen.exe"],
        display_name: "Zen Browser",
        pane_name: "Zen Browser",
        engine: Engine::Gecko,
        profile_base: ProfileBase::Roaming,
        profile_dir: r"zen",
    },
    Browser {
        exes: &["iexplore.exe"],
        display_name: "Internet Explorer",
        pane_name: "Internet Explorer",
        engine: Engine::Other,
        profile_base: ProfileBase::None,
        profile_dir: "",
    },
    // macOS only - matched on xcap's app_name rather than an exe.
    Browser {
        exes: &["safari"],
        display_name: "Safari",
        pane_name: "Safari",
        engine: Engine::Other,
        profile_base: ProfileBase::None,
        profile_dir: "",
    },
];

/// Address-bar automation ids, by engine. Chromium's omnibox and Firefox's
/// urlbar are the only two shapes that actually exist across this list.
pub fn omnibox_automation_ids(engine: Engine) -> &'static [&'static str] {
    match engine {
        Engine::Chromium => &[
            "Omnibox",
            "OmniboxViewViews",
            "addressEditBox",
            "addressbarEdit",
            "view_1012",
            "view_1011",
            "searchbox",
            "search_box",
            "edit_2",
        ],
        Engine::Gecko => &["urlbar-input", "urlbar"],
        Engine::Other => &[],
    }
}

/// Accessible names for the same control, for builds exposing no usable id.
pub fn omnibox_names(engine: Engine) -> &'static [&'static str] {
    match engine {
        Engine::Chromium => &[
            "Address and search bar",
            "Address bar",
            "Search or enter web address",
            "Search or type a URL",
            "Search or enter an address",
            "Location",
        ],
        Engine::Gecko => &[
            "Search with Google or enter address",
            "Search with DuckDuckGo or enter address",
            "Search with Bing or enter address",
            "Enter search or web address",
            "Search or enter address",
            "Address bar",
        ],
        Engine::Other => &[],
    }
}

/// Every automation id and name across all engines - what to search when the
/// browser isn't recognised but the window still looks like one.
pub fn all_omnibox_automation_ids() -> Vec<&'static str> {
    let mut out = omnibox_automation_ids(Engine::Chromium).to_vec();
    out.extend_from_slice(omnibox_automation_ids(Engine::Gecko));
    out
}

pub fn all_omnibox_names() -> Vec<&'static str> {
    let mut out = omnibox_names(Engine::Chromium).to_vec();
    for name in omnibox_names(Engine::Gecko) {
        if !out.contains(name) {
            out.push(name);
        }
    }
    out
}

/// Look a browser up by executable (Windows) or display name (macOS, where
/// xcap gives "Google Chrome" rather than an exe).
pub fn lookup(process_or_app_name: &str) -> Option<&'static Browser> {
    let key = process_or_app_name.trim().to_lowercase();
    if key.is_empty() {
        return None;
    }
    if let Some(browser) = BROWSERS
        .iter()
        .find(|b| b.exes.iter().any(|exe| *exe == key))
    {
        return Some(browser);
    }
    // macOS / display-name form: "Google Chrome", "Brave Browser", "Firefox".
    //
    // Whole words only, never a substring: a plain `contains` matched
    // "search.exe" against Arc and "monarch.exe" against Arc too, quietly
    // turning unrelated apps into browsers.
    if key.len() < 3 {
        return None;
    }
    BROWSERS.iter().find(|b| {
        let display = b.display_name.to_lowercase();
        key == display
            || key.starts_with(&format!("{display} "))
            || display.split_whitespace().any(|word| word == key)
    })
}

/// Whether this window belongs to something we treat as a browser at all.
pub fn is_browser(process_or_app_name: &str) -> bool {
    lookup(process_or_app_name).is_some()
}

/// Short engine/vendor tag handed to get-browser-url.ps1 so it can try the
/// right pane first. Empty for anything unrecognised.
pub fn browser_hint(process_or_app_name: &str) -> String {
    lookup(process_or_app_name)
        .map(|b| b.pane_name.to_string())
        .unwrap_or_default()
}

/// Every pane name, most-likely-first when a hint is supplied.
pub fn pane_names(hint: &str) -> Vec<&'static str> {
    let mut names: Vec<&'static str> = Vec::with_capacity(BROWSERS.len());
    if let Some(browser) = lookup(hint) {
        names.push(browser.pane_name);
    }
    for browser in BROWSERS {
        if !names.contains(&browser.pane_name) {
            names.push(browser.pane_name);
        }
    }
    names
}

/// Profile directories that may contain a history database for this browser,
/// newest-looking first. Empty when the browser keeps nothing readable, or off
/// Windows.
pub fn history_profile_dirs(browser: &Browser) -> Vec<PathBuf> {
    let base = match browser.profile_base {
        ProfileBase::Local => dirs::data_local_dir(),
        ProfileBase::Roaming => dirs::data_dir(),
        ProfileBase::None => None,
    };
    let Some(base) = base else {
        return Vec::new();
    };
    let root = base.join(browser.profile_dir.replace('\\', std::path::MAIN_SEPARATOR_STR));
    if !root.is_dir() {
        return Vec::new();
    }

    let mut dirs_out = Vec::new();
    match browser.engine {
        Engine::Chromium => {
            // Opera-style: the history sits directly in the channel folder.
            if root.join("History").is_file() {
                dirs_out.push(root.clone());
            }
            // Chrome-style: Default, "Profile 1", "Profile 2", ...
            if let Ok(entries) = std::fs::read_dir(&root) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() && path.join("History").is_file() {
                        dirs_out.push(path);
                    }
                }
            }
        }
        Engine::Gecko => {
            let profiles = root.join("Profiles");
            if let Ok(entries) = std::fs::read_dir(&profiles) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() && path.join("places.sqlite").is_file() {
                        dirs_out.push(path);
                    }
                }
            }
        }
        Engine::Other => {}
    }
    dirs_out
}

/// The history database filename for this engine.
pub fn history_file_name(engine: Engine) -> Option<&'static str> {
    match engine {
        Engine::Chromium => Some("History"),
        Engine::Gecko => Some("places.sqlite"),
        Engine::Other => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_exe_is_claimed_by_exactly_one_browser() {
        let mut seen: Vec<&str> = Vec::new();
        for browser in BROWSERS {
            for exe in browser.exes {
                assert!(
                    !seen.contains(exe),
                    "{exe} is claimed by more than one browser"
                );
                assert_eq!(*exe, exe.to_lowercase(), "{exe} must be lowercase");
                seen.push(exe);
            }
        }
    }

    #[test]
    fn the_mainstream_browsers_are_all_recognised() {
        for exe in [
            "chrome.exe",
            "msedge.exe",
            "firefox.exe",
            "brave.exe",
            "opera.exe",
            "operagx.exe",
            "vivaldi.exe",
            "chromium.exe",
            "arc.exe",
            "whale.exe",
            "waterfox.exe",
            "librewolf.exe",
            "zen.exe",
        ] {
            assert!(is_browser(exe), "{exe} should be a browser");
        }
    }

    #[test]
    fn lookup_is_case_insensitive_and_takes_macos_display_names() {
        assert_eq!(lookup("CHROME.EXE").unwrap().display_name, "Google Chrome");
        assert_eq!(lookup("Google Chrome").unwrap().display_name, "Google Chrome");
        assert_eq!(lookup("Safari").unwrap().display_name, "Safari");
        assert_eq!(lookup("Brave Browser").unwrap().display_name, "Brave");
    }

    #[test]
    fn non_browsers_are_not_matched() {
        for name in [
            "notepad.exe",
            "slack.exe",
            "code.exe",
            "",
            "   ",
            "explorer.exe",
            // Substring matching used to turn all of these into browsers:
            // "search"/"monarch" contain "arc", "operator" contains "opera".
            "search.exe",
            "monarch.exe",
            "operator.exe",
            "researchtool.exe",
        ] {
            assert!(!is_browser(name), "{name} must not be treated as a browser");
        }
    }

    #[test]
    fn macos_short_app_names_still_resolve() {
        // xcap reports "Firefox", not "Mozilla Firefox".
        assert_eq!(lookup("Firefox").unwrap().display_name, "Mozilla Firefox");
        assert_eq!(lookup("Chrome").unwrap().display_name, "Google Chrome");
        assert_eq!(lookup("Edge").unwrap().display_name, "Microsoft Edge");
        assert_eq!(lookup("Zen").unwrap().display_name, "Zen Browser");
    }

    #[test]
    fn engines_carry_the_right_omnibox_selectors() {
        assert!(omnibox_automation_ids(Engine::Chromium).contains(&"Omnibox"));
        assert!(omnibox_automation_ids(Engine::Gecko).contains(&"urlbar-input"));
        assert!(omnibox_automation_ids(Engine::Other).is_empty());
        // The union is what an unrecognised browser gets searched with.
        assert!(all_omnibox_automation_ids().contains(&"urlbar-input"));
        assert!(all_omnibox_automation_ids().contains(&"Omnibox"));
        assert!(all_omnibox_names().iter().any(|n| n.contains("Google")));
    }

    #[test]
    fn a_hint_puts_its_own_pane_first_without_dropping_the_rest() {
        let names = pane_names("firefox.exe");
        assert_eq!(names[0], "Mozilla Firefox");
        assert!(names.contains(&"Google Chrome"));
        assert_eq!(
            names.len(),
            names.iter().collect::<std::collections::HashSet<_>>().len(),
            "no duplicate pane names"
        );
        // An unknown hint still yields the full list.
        assert!(pane_names("notabrowser.exe").contains(&"Mozilla Firefox"));
    }

    /// get-browser-url.ps1 is standalone PowerShell and can't import this
    /// table, so it carries its own copy. This is the thing that stops the two
    /// drifting apart again - adding a browser here and forgetting the script
    /// is exactly how the lists ended up different in the first place.
    #[test]
    fn script_pane_names_match_the_registry() {
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("scripts")
            .join("get-browser-url.ps1");
        let text = std::fs::read_to_string(&script)
            .unwrap_or_else(|e| panic!("read {}: {e}", script.display()));

        for browser in BROWSERS {
            assert!(
                text.contains(&format!("\"{}\"", browser.pane_name)),
                "get-browser-url.ps1 is missing pane name {:?} - add it to $browserPaneNames",
                browser.pane_name
            );
        }
        for id in all_omnibox_automation_ids() {
            assert!(
                text.contains(&format!("\"{id}\"")),
                "get-browser-url.ps1 is missing automation id {id:?} - add it to $knownIds"
            );
        }
        for name in all_omnibox_names() {
            assert!(
                text.contains(&format!("\"{name}\"")),
                "get-browser-url.ps1 is missing address-bar name {name:?} - add it to $addressBarNames"
            );
        }
    }

    #[test]
    fn history_layout_is_defined_for_every_readable_engine() {
        for browser in BROWSERS {
            match browser.engine {
                Engine::Chromium | Engine::Gecko => {
                    assert!(history_file_name(browser.engine).is_some());
                    assert_ne!(browser.profile_base, ProfileBase::None, "{}", browser.display_name);
                    assert!(!browser.profile_dir.is_empty(), "{}", browser.display_name);
                }
                Engine::Other => {
                    assert!(history_file_name(browser.engine).is_none());
                }
            }
        }
    }
}
