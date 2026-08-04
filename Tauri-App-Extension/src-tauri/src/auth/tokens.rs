use std::fs;
use std::path::PathBuf;

use keyring::Entry;
use serde::{Deserialize, Serialize};

use crate::auth::dpapi;

// MAC-1: one entry, one machine/user profile - matches the previous
// single-file-per-install model. "tokens" as the username rather than an
// actual account name since this store never held more than one credential
// set at a time.
const KEYRING_SERVICE: &str = "com.virtualtracker.agent";
const KEYRING_USERNAME: &str = "tokens";

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

impl From<StorePayload> for StoredCredentials {
    fn from(data: StorePayload) -> Self {
        Self {
            id_token: data.id_token,
            refresh_token: data.refresh_token,
            device_id: data.device_id,
            agent_secret: data.agent_secret,
        }
    }
}

/// MAC-1/F1: tokens live in the OS credential store (Windows Credential
/// Manager / macOS Keychain / *nix Secret Service) via the `keyring` crate,
/// not a hand-rolled DPAPI-encrypted file. `path` is kept only to locate and
/// migrate a pre-existing file from an install that predates this change -
/// see `load_legacy_file`.
pub struct TokenStore {
    path: PathBuf,
}

impl TokenStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn entry() -> Option<Entry> {
        match Entry::new(KEYRING_SERVICE, KEYRING_USERNAME) {
            Ok(entry) => Some(entry),
            Err(err) => {
                // No usable OS credential store on this platform/session -
                // callers fall back to returning empty credentials on load,
                // and log-and-drop on save, rather than crashing. This should
                // be rare (v1's default store selection covers Windows,
                // macOS, and most *nix desktops) but must degrade, not panic.
                log::warn!("OS credential store unavailable: {err}");
                None
            }
        }
    }

    pub fn load(&self) -> StoredCredentials {
        if let Some(entry) = Self::entry() {
            match entry.get_secret() {
                Ok(secret) => match serde_json::from_slice::<StorePayload>(&secret) {
                    Ok(data) => return data.into(),
                    Err(err) => log::warn!("Could not parse token store from OS credential store: {err}"),
                },
                // NoEntry just means nothing has been saved yet (or the
                // one-time migration below hasn't run) - not an error worth
                // logging on every normal cold start.
                Err(keyring::Error::NoEntry) => {}
                Err(err) => log::warn!("Could not read token store from OS credential store: {err}"),
            }
        }

        // One-time migration: an install from before this change may still
        // have a DPAPI-encrypted (Windows) or plain-JSON token file on disk.
        // Adopt it into the OS keyring and remove the file so this path is
        // taken at most once per install - without it, every existing signed
        // -in user would be silently signed out the first time they update.
        match self.load_legacy_file() {
            Some(credentials) => {
                self.save(&credentials);
                let _ = fs::remove_file(&self.path);
                credentials
            }
            None => StoredCredentials::default(),
        }
    }

    fn load_legacy_file(&self) -> Option<StoredCredentials> {
        if !self.path.exists() {
            return None;
        }
        let bytes = fs::read(&self.path)
            .map_err(|err| log::warn!("Could not read legacy token file: {err}"))
            .ok()?;
        let json_bytes = dpapi::unprotect(&bytes).unwrap_or(bytes);
        serde_json::from_slice::<StorePayload>(&json_bytes)
            .map_err(|err| log::warn!("Could not parse legacy token file: {err}"))
            .ok()
            .map(StoredCredentials::from)
    }

    pub fn save(&self, credentials: &StoredCredentials) {
        let payload = StorePayload {
            id_token: credentials.id_token.clone(),
            refresh_token: credentials.refresh_token.clone(),
            device_id: credentials.device_id.clone(),
            agent_secret: credentials.agent_secret.clone(),
        };
        let Ok(json) = serde_json::to_vec(&payload) else {
            return;
        };
        let Some(entry) = Self::entry() else {
            log::warn!("No OS credential store available; tokens were not persisted");
            return;
        };
        if let Err(err) = entry.set_secret(&json) {
            log::warn!("Could not write token store to OS credential store: {err}");
        }
    }

    pub fn clear(&self) {
        if let Some(entry) = Self::entry() {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(err) => log::warn!("Could not clear token store: {err}"),
            }
        }
        // Also remove a lingering legacy file, if any - a stale plaintext/
        // DPAPI file left on disk after sign-out would defeat the point.
        if self.path.exists() {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Deliberately does NOT touch the real OS credential store (Windows
    // Credential Manager / Keychain / Secret Service) - a live round-trip
    // there under the production KEYRING_SERVICE/KEYRING_USERNAME would risk
    // clobbering a real signed-in session's tokens on whatever machine runs
    // this suite, and a failed assertion mid-test could leave that overwrite
    // in place. What's tested here is the pure migration-parsing logic:
    // load_legacy_file() and the StorePayload -> StoredCredentials mapping,
    // both of which only ever touch a throwaway temp file.

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("vt-token-store-test-{name}-{}.json", std::process::id()))
    }

    #[test]
    fn reads_a_plain_json_legacy_file() {
        let path = temp_path("plain");
        let payload = StorePayload {
            id_token: "id-1".into(),
            refresh_token: "refresh-1".into(),
            device_id: "device-1".into(),
            agent_secret: "secret-1".into(),
        };
        fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();

        let store = TokenStore::new(path.clone());
        let credentials = store.load_legacy_file().expect("legacy file should parse");
        assert_eq!(credentials.id_token, "id-1");
        assert_eq!(credentials.refresh_token, "refresh-1");
        assert_eq!(credentials.device_id, "device-1");
        assert_eq!(credentials.agent_secret, "secret-1");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn a_missing_legacy_file_is_not_an_error() {
        let store = TokenStore::new(temp_path("missing"));
        assert!(store.load_legacy_file().is_none());
    }

    #[test]
    fn a_corrupt_legacy_file_is_treated_as_absent_not_a_crash() {
        let path = temp_path("corrupt");
        fs::write(&path, b"not json at all").unwrap();
        let store = TokenStore::new(path.clone());
        assert!(store.load_legacy_file().is_none());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn a_legacy_store_missing_the_device_fields_still_loads() {
        // Guards the #[serde(default)] on device_id/agent_secret - a file
        // written before device credentials existed must not become
        // unreadable ("discarded as unreadable" is exactly what the comment
        // on StorePayload says this must not do).
        let path = temp_path("pre-device-fields");
        fs::write(&path, br#"{"idToken":"id-1","refreshToken":"refresh-1"}"#).unwrap();
        let store = TokenStore::new(path.clone());
        let credentials = store.load_legacy_file().expect("must still parse without device fields");
        assert_eq!(credentials.id_token, "id-1");
        assert_eq!(credentials.device_id, "", "missing field defaults to empty, not a parse failure");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn store_payload_maps_field_for_field_into_stored_credentials() {
        let payload = StorePayload {
            id_token: "a".into(),
            refresh_token: "b".into(),
            device_id: "c".into(),
            agent_secret: "d".into(),
        };
        let credentials: StoredCredentials = payload.into();
        assert_eq!(credentials.id_token, "a");
        assert_eq!(credentials.refresh_token, "b");
        assert_eq!(credentials.device_id, "c");
        assert_eq!(credentials.agent_secret, "d");
    }
}
