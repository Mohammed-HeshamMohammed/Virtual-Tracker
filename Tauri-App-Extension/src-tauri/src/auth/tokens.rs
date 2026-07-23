use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

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
        match fs::read_to_string(&self.path) {
            Ok(text) => match serde_json::from_str::<StorePayload>(&text) {
                Ok(data) => (data.id_token, data.refresh_token),
                Err(err) => {
                    log::warn!("Could not read token store: {err}");
                    (String::new(), String::new())
                }
            },
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
        if let Ok(text) = serde_json::to_string_pretty(&payload) {
            if let Err(err) = fs::write(&self.path, text) {
                log::warn!("Could not write token store: {err}");
            }
        }
    }

    pub fn clear(&self) {
        if self.path.exists() {
            let _ = fs::remove_file(&self.path);
        }
    }
}
