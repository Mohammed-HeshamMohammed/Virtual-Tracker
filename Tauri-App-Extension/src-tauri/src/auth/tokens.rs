use std::fs;
use std::path::PathBuf;

use keyring::Entry;
use serde::{Deserialize, Serialize};

use crate::auth::dpapi;

// MAC-1: one entry, one machine/user profile - matches the previous single-file-per-install
// model.
const KEYRING_SERVICE: &str = "com.virtualtracker.agent";
#[cfg_attr(test, allow(dead_code))]
const KEYRING_USERNAME: &str = "tokens";

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorePayload {
    id_token: String,
    refresh_token: String,
    // Device credential; defaulted so stores written before it existed still load instead
    // of being discarded as unreadable.
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

fn payload_json(credentials: &StoredCredentials) -> Vec<u8> {
    serde_json::to_vec(&StorePayload {
        id_token: credentials.id_token.clone(),
        refresh_token: credentials.refresh_token.clone(),
        device_id: credentials.device_id.clone(),
        agent_secret: credentials.agent_secret.clone(),
    })
    .unwrap_or_default()
}

/// MAC-1/F1: tokens live in the OS credential store (Windows Credential Manager / macOS
/// Keychain / *nix Secret Service) via the `keyring` crate, not a hand-rolled
pub struct TokenStore {
    path: PathBuf,
}

impl TokenStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn entry(&self) -> Option<Entry> {
        // A test gets an entry of its own, named after its store path: the real one is
        // this machine's actual sign-in, and a test that signs out would otherwise wipe it
        // (and parallel tests would overwrite each other's).
        #[cfg(test)]
        let entry = Entry::new(
            &format!("{KEYRING_SERVICE}.test"),
            &self.path.to_string_lossy(),
        );
        #[cfg(not(test))]
        let entry = Entry::new(KEYRING_SERVICE, KEYRING_USERNAME);
        match entry {
            Ok(entry) => Some(entry),
            Err(err) => {
                // No usable OS credential store on this platform/session - callers fall
                // back to returning empty credentials on load, and log-and-drop on
                // save, rather than crashing. This should be rare (v1's default store
                // selection covers Windows, macOS, and most *nix desktops) but must
                // degrade, not panic.
                log::warn!("OS credential store unavailable: {err}");
                None
            }
        }
    }

    pub fn load(&self) -> StoredCredentials {
        // The file first: it exists only while it holds the newest sign-in - `save` removes it
        // whenever the credential store takes one - so it never loses to an older entry there.
        // It is either the fallback `save` writes when the store refuses, or a pre-keyring
        // install's. Move it into the store if the store takes it now; the file goes only once
        // that has worked. It used to be deleted unconditionally - after a move the store had
        // refused - and the sign-in was gone for good.
        if let Some(credentials) = self.load_legacy_file() {
            if self.save_to_keyring(&payload_json(&credentials)) {
                let _ = fs::remove_file(&self.path);
            }
            return credentials;
        }

        if let Some(entry) = self.entry() {
            match entry.get_secret() {
                Ok(secret) => match serde_json::from_slice::<StorePayload>(&secret) {
                    Ok(data) => return data.into(),
                    Err(err) => log::warn!("Could not parse token store from OS credential store: {err}"),
                },
                // NoEntry just means nothing has been saved yet - not an error worth logging
                // on every normal cold start.
                Err(keyring::Error::NoEntry) => {}
                Err(err) => log::warn!("Could not read token store from OS credential store: {err}"),
            }
        }
        StoredCredentials::default()
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

    /// Returns whether the credential was persisted anywhere.
    ///
    /// The OS credential store first. Windows Credential Manager caps a secret at 2560 bytes
    /// and the sign-in (an id token, a refresh token and the device credential) is longer, so
    /// there it was refused on every save and every launch started signed out. When the store
    /// refuses, the sign-in goes to a file encrypted with DPAPI for this Windows user instead.
    pub fn save(&self, credentials: &StoredCredentials) -> bool {
        let json = payload_json(credentials);
        if self.save_to_keyring(&json) {
            // An older fallback file must not outlive the credential it was standing in for.
            let _ = fs::remove_file(&self.path);
            return true;
        }
        // `load` reads the store first, so an older sign-in still in it would win over the
        // file about to be written.
        if let Some(entry) = self.entry() {
            let _ = entry.delete_credential();
        }
        self.save_to_protected_file(&json)
    }

    fn save_to_keyring(&self, json: &[u8]) -> bool {
        let Some(entry) = self.entry() else {
            return false;
        };
        match entry.set_secret(json) {
            Ok(()) => true,
            Err(err) => {
                log::info!("OS credential store did not take the sign-in ({err}); using the encrypted file");
                false
            }
        }
    }

    fn save_to_protected_file(&self, json: &[u8]) -> bool {
        let Some(sealed) = dpapi::protect(json) else {
            log::warn!("Could not encrypt the sign-in; it was not persisted");
            return false;
        };
        if let Some(dir) = self.path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        // Temp file + rename, so a crash mid-write never leaves a half-written sign-in.
        let tmp = self.path.with_extension("tmp");
        let written = fs::write(&tmp, sealed).and_then(|()| fs::rename(&tmp, &self.path));
        if let Err(err) = written {
            log::warn!("Could not write the encrypted sign-in file: {err}");
            let _ = fs::remove_file(&tmp);
            return false;
        }
        true
    }

    pub fn clear(&self) {
        if let Some(entry) = self.entry() {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(err) => log::warn!("Could not clear token store: {err}"),
            }
        }
        // Also remove a lingering legacy file, if any - a stale plaintext/ DPAPI file left
        // on disk after sign-out would defeat the point.
        if self.path.exists() {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Deliberately does NOT touch the real OS credential store (Windows Credential Manager
    // / Keychain / Secret Service) - a live round-trip there under the production

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
        // Guards the #[serde(default)] on device_id/agent_secret - a file written before
        // device credentials existed must not become unreadable ("discarded as unreadable"
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

    // The tests below use the real Windows Credential Manager (each test its own entry, see
    // `entry`) and real DPAPI, since what broke was exactly how those two behave.

    fn credentials(id_token_len: usize) -> StoredCredentials {
        StoredCredentials {
            id_token: format!("header.{}.sig", "p".repeat(id_token_len)),
            refresh_token: "refresh-token-value".into(),
            device_id: "device-1".into(),
            agent_secret: "secret-1".into(),
        }
    }

    fn same(a: &StoredCredentials, b: &StoredCredentials) -> bool {
        a.id_token == b.id_token && a.refresh_token == b.refresh_token && a.device_id == b.device_id && a.agent_secret == b.agent_secret
    }

    #[cfg(windows)]
    #[test]
    fn a_sign_in_too_long_for_credential_manager_survives_a_restart() {
        // A real sign-in is longer than Credential Manager's 2560-byte cap.
        let path = temp_path("too-long");
        let signed_in = credentials(3000);
        let store = TokenStore::new(path.clone());
        assert!(store.save(&signed_in), "the sign-in is persisted somewhere");

        let after_restart = TokenStore::new(path.clone()).load();
        assert!(same(&after_restart, &signed_in), "a new launch reads the same sign-in back");
        let on_disk = fs::read(&path).expect("the fallback file exists");
        assert!(
            !String::from_utf8_lossy(&on_disk).contains("refresh-token-value"),
            "the file is encrypted, not the tokens in plain text"
        );

        store.clear();
        assert!(!path.exists());
        assert!(!same(&TokenStore::new(path).load(), &signed_in), "signing out forgets it");
    }

    #[cfg(windows)]
    #[test]
    fn a_short_sign_in_goes_to_credential_manager_and_leaves_no_file() {
        let path = temp_path("short");
        let signed_in = credentials(100);
        let store = TokenStore::new(path.clone());
        assert!(store.save(&signed_in));
        assert!(!path.exists(), "no fallback file when the store took it");
        assert!(same(&TokenStore::new(path.clone()).load(), &signed_in));
        store.clear();
    }

    #[cfg(windows)]
    #[test]
    fn a_sign_in_that_outgrows_the_store_replaces_the_older_one_in_it() {
        let path = temp_path("outgrown");
        let store = TokenStore::new(path.clone());
        assert!(store.save(&credentials(100)), "an older, shorter sign-in fits the store");
        let newer = credentials(3000);
        assert!(store.save(&newer));
        assert!(same(&TokenStore::new(path).load(), &newer), "the newer sign-in wins, not the stale one");
        store.clear();
    }

    #[cfg(windows)]
    #[test]
    fn a_saved_file_the_store_cannot_take_is_kept_not_deleted() {
        // What every upgrade to the keyring version did: read the old file, fail to move it into
        // the store, and delete it anyway - losing the sign-in for good.
        let path = temp_path("kept");
        let signed_in = credentials(3000);
        fs::write(&path, dpapi::protect(&payload_json(&signed_in)).unwrap()).unwrap();
        let store = TokenStore::new(path.clone());
        assert!(same(&store.load(), &signed_in));
        assert!(path.exists(), "still there for the next launch");
        assert!(same(&TokenStore::new(path.clone()).load(), &signed_in));
        store.clear();
    }
}
