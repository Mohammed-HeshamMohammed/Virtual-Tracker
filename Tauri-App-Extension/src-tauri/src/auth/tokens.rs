use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::auth::dpapi;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorePayload {
    id_token: String,
    refresh_token: String,
}

pub struct TokenStore {
    path: PathBuf,
}

impl TokenStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> (String, String) {
        if !self.path.exists() {
            return (String::new(), String::new());
        }
        let bytes = match fs::read(&self.path) {
            Ok(b) => b,
            Err(err) => {
                log::warn!("Could not read token store: {err}");
                return (String::new(), String::new());
            }
        };
        // Current format is DPAPI-encrypted; fall back to reading it as plain
        // JSON for stores written before encryption-at-rest was added.
        let json_bytes = dpapi::unprotect(&bytes).unwrap_or(bytes);
        match serde_json::from_slice::<StorePayload>(&json_bytes) {
            Ok(data) => (data.id_token, data.refresh_token),
            Err(err) => {
                log::warn!("Could not read token store: {err}");
                (String::new(), String::new())
            }
        }
    }

    pub fn save(&self, id_token: &str, refresh_token: &str) {
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let payload = StorePayload {
            id_token: id_token.to_string(),
            refresh_token: refresh_token.to_string(),
        };
        let Ok(json) = serde_json::to_vec(&payload) else {
            return;
        };
        // Encrypt at rest when DPAPI is available (Windows); otherwise write
        // plain JSON same as before rather than losing the tokens entirely.
        let bytes = dpapi::protect(&json).unwrap_or(json);
        if let Err(err) = fs::write(&self.path, bytes) {
            log::warn!("Could not write token store: {err}");
        }
    }

    pub fn clear(&self) {
        if self.path.exists() {
            let _ = fs::remove_file(&self.path);
        }
    }
}
