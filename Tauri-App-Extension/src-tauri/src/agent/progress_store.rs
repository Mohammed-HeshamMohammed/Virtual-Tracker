use std::fs;
use std::path::PathBuf;

/// Crash-safe mirror of `ActivityTracker`'s in-memory `task_progress`. Written
/// on every credited tick so an unclean exit (crash/kill/reboot) between two
/// `sync` calls doesn't lose whatever active/idle seconds were only ever held
/// in RAM - see PLAN-agent-crash-safe-progress.md, PS-1/PS-2.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PersistedProgress {
    pub session_id: String,
    pub task_id: Option<String>,
    pub active_seconds: u64,
    pub idle_seconds: u64,
}

pub struct ProgressStore {
    path: PathBuf,
}

impl ProgressStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Atomic write (temp file + rename) so a crash mid-write never leaves a
    /// half-written, unparseable file behind for `load()` to trip over.
    pub fn save(&self, progress: &PersistedProgress) {
        let Ok(json) = serde_json::to_vec(progress) else {
            return;
        };
        let tmp_path = self.path.with_extension("tmp");
        if fs::write(&tmp_path, json).is_err() {
            return;
        }
        let _ = fs::rename(&tmp_path, &self.path);
    }

    pub fn load(&self) -> Option<PersistedProgress> {
        let bytes = fs::read(&self.path).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    pub fn clear(&self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_progress_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "vt-progress-test-{name}-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ))
    }

    #[test]
    fn round_trips_a_saved_value() {
        let path = temp_progress_path("roundtrip");
        let store = ProgressStore::new(path.clone());
        let progress = PersistedProgress {
            session_id: "sess-1".into(),
            task_id: Some("task-1".into()),
            active_seconds: 120,
            idle_seconds: 5,
        };
        store.save(&progress);
        assert_eq!(store.load(), Some(progress));
        store.clear();
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn missing_file_loads_as_none() {
        let path = temp_progress_path("missing");
        let _ = fs::remove_file(&path);
        let store = ProgressStore::new(path.clone());
        assert_eq!(store.load(), None);
    }

    #[test]
    fn clear_removes_the_file() {
        let path = temp_progress_path("clear");
        let store = ProgressStore::new(path.clone());
        store.save(&PersistedProgress {
            session_id: "sess-1".into(),
            task_id: None,
            active_seconds: 1,
            idle_seconds: 0,
        });
        assert!(store.load().is_some());
        store.clear();
        assert_eq!(store.load(), None);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn corrupt_file_loads_as_none_not_a_panic() {
        let path = temp_progress_path("corrupt");
        fs::write(&path, b"not json").unwrap();
        let store = ProgressStore::new(path.clone());
        assert_eq!(store.load(), None);
        let _ = fs::remove_file(&path);
    }
}
