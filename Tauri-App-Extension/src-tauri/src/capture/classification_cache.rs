//! Disk-backed cache of the server's app display-name mappings.
//!
//! The mapping used to live only in memory, so restarting the agent while
//! offline showed raw executable names - `chrome.exe`, `msedge.exe` - until it
//! could next reach the server. Persisting it means a cold start with no
//! network still shows real names.
//!
//! **This cache has no authority.** Categories are resolved server-side at
//! read time and the agent never sends a category (there is a test in
//! types.rs enforcing that). So a member who edits or deletes this file
//! changes what their own agent window displays to them, and nothing else -
//! not a single number in any report. That is the actual protection: the file
//! is not worth tampering with, rather than being locked.
//!
//! ponytail: plain JSON in the per-user data directory. Encrypting it at rest
//! (keyring-sealed AEAD) would raise the cost of casual inspection of which
//! internal tools an organisation tracks, but cannot stop the logged-in user
//! reading it - the agent must decrypt it to use it. Worth adding as
//! defence-in-depth for confidentiality; not load-bearing for integrity.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Refuses to grow without bound if the server ever returns a huge table.
const MAX_ENTRIES: usize = 5_000;

pub fn load(path: &Path) -> Vec<(String, String)> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&raw) else {
        // A truncated or hand-edited file is discarded rather than trusted.
        // The next refresh rewrites it; until then names fall back exactly as
        // they did before this cache existed.
        log::warn!("Classification cache is unreadable, ignoring it");
        return Vec::new();
    };
    map.into_iter().take(MAX_ENTRIES).collect()
}

pub fn save(path: &Path, entries: &[(String, String)]) {
    let map: HashMap<&str, &str> = entries
        .iter()
        .take(MAX_ENTRIES)
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    let Ok(json) = serde_json::to_string(&map) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    // Write-then-rename: a crash mid-write must not leave a truncated file
    // that the next start has to throw away.
    let tmp: PathBuf = path.with_extension("json.tmp");
    if fs::write(&tmp, json).is_ok() && fs::rename(&tmp, path).is_err() {
        let _ = fs::remove_file(&tmp);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(name: &str) -> PathBuf {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("vt-classification-{name}-{unique}.json"))
    }

    #[test]
    fn a_missing_file_loads_as_empty_rather_than_failing() {
        assert!(load(&temp_path("missing")).is_empty());
    }

    #[test]
    fn entries_survive_a_save_and_load_round_trip() {
        // The offline bug this exists for: without persistence a cold start
        // with no network shows "chrome.exe" instead of "Google Chrome".
        let path = temp_path("roundtrip");
        save(&path, &[("chrome.exe".into(), "Google Chrome".into())]);
        let loaded = load(&path);
        assert_eq!(loaded, vec![("chrome.exe".to_string(), "Google Chrome".to_string())]);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn a_corrupt_file_is_discarded_not_trusted() {
        let path = temp_path("corrupt");
        fs::write(&path, "{not json").unwrap();
        assert!(load(&path).is_empty());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn saving_replaces_rather_than_merges() {
        // A mapping removed server-side must actually disappear here too -
        // same contract apply_display_names already has in memory.
        let path = temp_path("replace");
        save(&path, &[("chrome.exe".into(), "Google Chrome".into())]);
        save(&path, &[("firefox.exe".into(), "Mozilla Firefox".into())]);
        let loaded = load(&path);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].0, "firefox.exe");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn no_temp_file_is_left_behind_after_a_save() {
        let path = temp_path("tmp-cleanup");
        save(&path, &[("a.exe".into(), "A".into())]);
        assert!(!path.with_extension("json.tmp").exists());
        let _ = fs::remove_file(&path);
    }
}
