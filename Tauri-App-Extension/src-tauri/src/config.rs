use std::env;
use std::fs;
use std::path::PathBuf;

use crate::constants::{PROD_API_URL, PROD_WEB_URL};
use crate::prefs::PreferencesStore;

#[derive(Debug, Clone)]
pub struct Settings {
    pub api_url: String,
    pub web_url: String,
    pub auth_port: u16,
    pub store_path: PathBuf,
    pub prefs_path: PathBuf,
    pub url_script_path: PathBuf,
    pub macos_url_script_path: PathBuf,
    pub is_production: bool,
}

impl Settings {
    pub fn load() -> Self {
        // Release builds always use production endpoints.
        // Debug builds also default to production unless VT_* overrides are set.
        load_env_files();

        let is_production = !cfg!(debug_assertions);
        let project_root = project_root();
        let data_dir = app_data_dir(&project_root);
        let _ = fs::create_dir_all(&data_dir);

        let store_path = data_dir.join("agent-store.json");
        let prefs_path = data_dir.join("preferences.json");

        let default_api = PROD_API_URL;
        let default_web = PROD_WEB_URL;

        Self {
            api_url: env::var("VT_API_URL")
                .unwrap_or_else(|_| default_api.into())
                .trim_end_matches('/')
                .to_string(),
            web_url: env::var("VT_WEB_URL")
                .unwrap_or_else(|_| default_web.into())
                .trim_end_matches('/')
                .to_string(),
            auth_port: env::var("VT_AUTH_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(17389),
            store_path,
            prefs_path,
            url_script_path: resolve_script(&project_root, "get-browser-url.ps1"),
            macos_url_script_path: resolve_script(
                &project_root,
                "get-browser-url-macos.applescript",
            ),
            is_production,
        }
    }

    pub fn preferences_store(&self) -> PreferencesStore {
        PreferencesStore::new(self.prefs_path.clone())
    }
}

fn app_data_dir(project_root: &PathBuf) -> PathBuf {
    if cfg!(debug_assertions) {
        return project_root.clone();
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".virtualtracker")
}

fn project_root() -> PathBuf {
    if let Ok(manifest) = env::var("CARGO_MANIFEST_DIR") {
        return PathBuf::from(manifest).join("..");
    }
    env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_script(project_root: &PathBuf, name: &str) -> PathBuf {
    let candidates = [
        project_root.join("scripts").join(name),
        project_root.join(name),
        env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("resources").join(name)))
            .unwrap_or_default(),
    ];
    for path in candidates {
        if path.exists() {
            return path;
        }
    }
    project_root.join("scripts").join(name)
}

fn load_env_files() {
    // Release builds ignore local .env so the packaged app always hits production.
    if !cfg!(debug_assertions) {
        return;
    }
    let root = project_root();
    for name in [".env", ".env.production"] {
        let path = root.join(name);
        if !path.exists() {
            continue;
        }
        if let Ok(text) = fs::read_to_string(&path) {
            for line in text.lines() {
                let text = line.trim();
                if text.is_empty() || text.starts_with('#') || !text.contains('=') {
                    continue;
                }
                let (key, val) = text.split_once('=').unwrap();
                let key = key.trim();
                let val = val.trim().trim_matches('"').trim_matches('\'');
                if !key.is_empty() && env::var_os(key).is_none() {
                    env::set_var(key, val);
                }
            }
        }
    }
}
