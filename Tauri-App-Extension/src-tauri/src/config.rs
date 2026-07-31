use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::constants::{PROD_API_URL, PROD_AUTH_URL, PROD_WEB_URL};
use crate::prefs::PreferencesStore;

#[derive(Debug, Clone)]
pub struct Settings {
    pub api_url: String,
    pub web_url: String,
    /// Auth-Backend, not the dashboard API - see PROD_AUTH_URL.
    pub auth_url: String,
    pub auth_port: u16,
    pub store_path: PathBuf,
    pub prefs_path: PathBuf,
    pub queue_path: PathBuf,
    pub log_path: PathBuf,
    pub url_script_path: PathBuf,
    pub macos_url_script_path: PathBuf,
}

impl Settings {
    pub fn load() -> Self {
        // Release builds always use production endpoints.
        // Debug builds also default to production unless VT_* overrides are set.
        load_env_files();

        let project_root = project_root();
        let data_dir = app_data_dir(&project_root);
        let _ = fs::create_dir_all(&data_dir);

        let store_path = data_dir.join("agent-store.json");
        let prefs_path = data_dir.join("preferences.json");
        let queue_path = data_dir.join("pending-events.jsonl");
        let log_path = data_dir.join("agent.log");

        let default_api = PROD_API_URL;
        let default_web = PROD_WEB_URL;

        let url_script_path = resolve_script(&project_root, "get-browser-url.ps1");
        let macos_url_script_path = resolve_script(&project_root, "get-browser-url-macos.applescript");
        log::info!(
            "URL script resolved to {} (exists: {})",
            url_script_path.display(),
            url_script_path.exists()
        );

        Self {
            api_url: env::var("VT_API_URL")
                .unwrap_or_else(|_| default_api.into())
                .trim_end_matches('/')
                .to_string(),
            web_url: env::var("VT_WEB_URL")
                .unwrap_or_else(|_| default_web.into())
                .trim_end_matches('/')
                .to_string(),
            auth_url: resolve_auth_url(),
            auth_port: env::var("VT_AUTH_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(17389),
            store_path,
            prefs_path,
            queue_path,
            log_path,
            url_script_path,
            macos_url_script_path,
        }
    }

    pub fn preferences_store(&self) -> PreferencesStore {
        PreferencesStore::new(self.prefs_path.clone())
    }
}

/// `VT_AUTH_URL` exists for pointing a dev build at a local Auth-Backend
/// (`http://127.0.0.1:5712`). A release build only honours it over HTTPS -
/// email, password and tokens go to this host, so a plaintext override in a
/// shipped build is not a configuration choice, it is an attack.
fn resolve_auth_url() -> String {
    pick_auth_url(
        &env::var("VT_AUTH_URL").unwrap_or_default(),
        cfg!(debug_assertions),
    )
}

/// Split out from the environment read so the rule itself is testable.
fn pick_auth_url(configured: &str, debug_build: bool) -> String {
    let configured = configured.trim().trim_end_matches('/');
    if configured.is_empty() {
        return PROD_AUTH_URL.to_string();
    }
    if !debug_build && !configured.starts_with("https://") {
        log::warn!("Ignoring non-HTTPS VT_AUTH_URL in a release build");
        return PROD_AUTH_URL.to_string();
    }
    configured.to_string()
}

#[cfg(test)]
mod tests {
    use super::{pick_auth_url, PROD_AUTH_URL};

    #[test]
    fn no_override_uses_production_auth_backend() {
        assert_eq!(pick_auth_url("", false), PROD_AUTH_URL);
        assert_eq!(pick_auth_url("   ", true), PROD_AUTH_URL);
    }

    #[test]
    fn dev_builds_may_point_at_a_local_auth_backend() {
        assert_eq!(
            pick_auth_url("http://127.0.0.1:5712/", true),
            "http://127.0.0.1:5712"
        );
    }

    #[test]
    fn release_builds_refuse_a_plaintext_override() {
        // Credentials and tokens go to this host - a shipped build must not be
        // talked into sending them over HTTP by an environment variable.
        assert_eq!(pick_auth_url("http://evil.example", false), PROD_AUTH_URL);
        assert_eq!(
            pick_auth_url("https://staging-auth.example", false),
            "https://staging-auth.example"
        );
    }
}

pub fn app_data_dir(project_root: &Path) -> PathBuf {
    if cfg!(debug_assertions) {
        return project_root.to_path_buf();
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".virtualtracker")
}

pub fn project_root() -> PathBuf {
    if let Ok(manifest) = env::var("CARGO_MANIFEST_DIR") {
        return PathBuf::from(manifest).join("..");
    }
    env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_script(project_root: &Path, name: &str) -> PathBuf {
    let exe_dir = env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf()));
    let candidates = [
        // Dev build: CARGO_MANIFEST_DIR/../scripts/<name>.
        project_root.join("scripts").join(name),
        project_root.join(name),
        // Release build: tauri.conf.json declares the resource as
        // "../scripts/<name>" (relative to src-tauri) — NSIS/MSI preserve that
        // leading ".." literally as an "_up_" folder next to the exe. Confirmed
        // from an actual installed build: <installdir>\_up_\scripts\<name>.
        exe_dir
            .as_ref()
            .map(|d| d.join("_up_").join("scripts").join(name))
            .unwrap_or_default(),
        // Older guesses, kept in case a future bundler version changes this.
        exe_dir
            .as_ref()
            .map(|d| d.join("resources").join("scripts").join(name))
            .unwrap_or_default(),
        exe_dir
            .as_ref()
            .map(|d| d.join("resources").join(name))
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
