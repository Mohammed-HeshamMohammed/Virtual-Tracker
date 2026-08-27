use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

fn default_true() -> bool {
    true
}

/// Every field carries its own `serde(default)`. Without it, adding a field
/// here makes every preferences.json written by an older build fail to
/// deserialize - and `load()` falls back to `unwrap_or_default()`, silently
/// wiping the user's other settings. Per-field defaults let old files load as
/// written, with only the new key filled in.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPreferences {
    /// Launch the agent when Windows starts.
    #[serde(default = "default_true")]
    pub launch_at_login: bool,
    /// Start hidden in the tray instead of showing the window.
    #[serde(default)]
    pub start_hidden: bool,
    /// Automatically open the browser sign-in flow when nothing is stored.
    #[serde(default = "default_true")]
    pub auto_sign_in: bool,
    /// Closing the window hides it in the tray instead of quitting the agent.
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    /// Set after the first successful startup. `start_hidden` only applies once
    /// this is true - a fresh install always shows the window on first launch,
    /// since the user has never seen the tray icon yet.
    #[serde(default)]
    pub has_launched_before: bool,
    /// Set the first time the window is hidden to the tray in this install, so
    /// the "still running" notice is shown once and never repeated.
    #[serde(default)]
    pub tray_notice_shown: bool,
    /// "system" | "light" | "dark". Lives here rather than in the webview's
    /// localStorage so it survives a reinstall like every other preference,
    /// and so the window can be painted before the first React render.
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_theme() -> String {
    "system".to_string()
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            launch_at_login: true,
            start_hidden: false,
            auto_sign_in: true,
            close_to_tray: true,
            has_launched_before: false,
            tray_notice_shown: false,
            theme: default_theme(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsView {
    pub version: String,
    pub preferences: UserPreferences,
    pub log_path: String,
}

pub struct PreferencesStore {
    path: PathBuf,
}

impl PreferencesStore {
    pub fn new(path: PathBuf) -> Self {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        Self { path }
    }

    pub fn load(&self) -> UserPreferences {
        if !self.path.exists() {
            // Write the defaults back immediately so the file actually exists
            // again after being deleted, instead of only reappearing once the
            // user happens to toggle a setting.
            let defaults = UserPreferences::default();
            let _ = self.save(&defaults);
            return defaults;
        }
        match fs::read_to_string(&self.path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
            Err(_) => UserPreferences::default(),
        }
    }

    pub fn save(&self, prefs: &UserPreferences) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let text = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
        fs::write(&self.path, text).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::UserPreferences;

    /// A preferences.json written before `closeToTray` existed must keep every
    /// setting the user actually chose. This is the one regression that would
    /// silently destroy their configuration, so it is pinned here.
    #[test]
    fn loads_preferences_written_before_close_to_tray_existed() {
        let old = r#"{"launchAtLogin":false,"startHidden":true,"autoSignIn":false}"#;
        let prefs: UserPreferences = serde_json::from_str(old).expect("old file must still parse");

        assert!(!prefs.launch_at_login);
        assert!(prefs.start_hidden);
        assert!(!prefs.auto_sign_in);
        // Only the missing key falls back to its default.
        assert!(prefs.close_to_tray);
    }

    /// Fresh installs get auto sign-in on; an existing file that says otherwise
    /// still wins (covered above).
    #[test]
    fn defaults_enable_auto_sign_in_and_close_to_tray() {
        let prefs = UserPreferences::default();
        assert!(prefs.auto_sign_in);
        assert!(prefs.close_to_tray);
        assert!(!prefs.start_hidden);
    }
}
