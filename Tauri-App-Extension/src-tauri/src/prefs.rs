use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPreferences {
    /// Launch the agent when Windows starts.
    pub launch_at_login: bool,
    /// Start hidden in the tray instead of showing the window.
    pub start_hidden: bool,
    /// Automatically open the browser sign-in flow when not linked.
    pub auto_sign_in: bool,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            launch_at_login: true,
            start_hidden: false,
            auto_sign_in: false,
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
