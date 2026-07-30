use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::auth::dpapi;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorePayload {
    id_token: String,
    refresh_token: String,
    // Device credential; defaulted so stores written before it existed still
    // load instead of being discarded as unreadable.
    #[serde(default)]
    device_id: String,
    #[serde(default)]
    agent_secret: String,
}

/// Everything the agent persists between launches.
#[derive(Debug, Default, Clone)]
pub struct StoredCredentials {
    pub id_token: String,
    pub refresh_token: String,
    pub device_id: String,
    pub agent_secret: String,
}

pub struct TokenStore {
    path: PathBuf,
}

impl TokenStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> StoredCredentials {
        if !self.path.exists() {
            return StoredCredentials::default();
        }
        let bytes = match fs::read(&self.path) {
            Ok(b) => b,
            Err(err) => {
                log::warn!("Could not read token store: {err}");
                return StoredCredentials::default();
            }
        };
        // Current format is DPAPI-encrypted; fall back to reading it as plain
        // JSON for stores written before encryption-at-rest was added.
        let json_bytes = dpapi::unprotect(&bytes).unwrap_or(bytes);
        match serde_json::from_slice::<StorePayload>(&json_bytes) {
            Ok(data) => StoredCredentials {
                id_token: data.id_token,
                refresh_token: data.refresh_token,
                device_id: data.device_id,
                agent_secret: data.agent_secret,
            },
            Err(err) => {
                log::warn!("Could not read token store: {err}");
                StoredCredentials::default()
            }
        }
    }

    pub fn save(&self, credentials: &StoredCredentials) {
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let payload = StorePayload {
            id_token: credentials.id_token.clone(),
            refresh_token: credentials.refresh_token.clone(),
            device_id: credentials.device_id.clone(),
            agent_secret: credentials.agent_secret.clone(),
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
