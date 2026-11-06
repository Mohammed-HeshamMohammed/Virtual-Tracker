use std::fs;
use std::path::{Path, PathBuf};

/// Crash-safe mirror of `ActivityTracker`'s in-memory `task_progress`.
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

/// A "stop" the server has not confirmed yet, written to disk BEFORE it is sent and removed
/// only once the server accepts it. If the app or the PC dies in between, the next start
/// still knows the session was ended, and why.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PersistedStop {
    pub session_id: String,
    pub task_id: String,
    pub project_id: String,
    pub active_seconds: u64,
    pub idle_seconds: u64,
    pub reason: String,
}

pub struct StopStore {
    path: PathBuf,
}

impl StopStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn save(&self, stop: &PersistedStop) {
        let Ok(json) = serde_json::to_vec(stop) else {
            return;
        };
        let tmp_path = self.path.with_extension("tmp");
        if fs::write(&tmp_path, json).is_ok() {
            let _ = fs::rename(&tmp_path, &self.path);
        }
    }

    pub fn load(&self) -> Option<PersistedStop> {
        serde_json::from_slice(&fs::read(&self.path).ok()?).ok()
    }

    pub fn clear(&self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// True when the last run ended with a timer still open: the progress mirror is cleared when a
/// session closes cleanly, and the pending-stop file when the server confirms a stop, so a
/// leftover means the app or the PC went away mid-session. Read before anything starts a tracker.
pub fn last_run_ended_with_running_timer(progress_path: &Path, stop_path: &Path) -> bool {
    ProgressStore::new(progress_path.to_path_buf()).load().is_some()
        || StopStore::new(stop_path.to_path_buf()).load().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leftover_progress_or_stop_means_the_timer_was_running() {
        let progress = std::env::temp_dir().join(format!("vt-r1-progress-{}.json", std::process::id()));
        let stop = std::env::temp_dir().join(format!("vt-r1-stop-{}.json", std::process::id()));
        let _ = fs::remove_file(&progress);
        let _ = fs::remove_file(&stop);
        assert!(!last_run_ended_with_running_timer(&progress, &stop), "clean exit: nothing left");

        ProgressStore::new(progress.clone()).save(&PersistedProgress {
            session_id: "s".into(),
            task_id: None,
            active_seconds: 5,
            idle_seconds: 0,
        });
        assert!(last_run_ended_with_running_timer(&progress, &stop));
        ProgressStore::new(progress.clone()).clear();

        StopStore::new(stop.clone()).save(&PersistedStop {
            session_id: "s".into(),
            task_id: "t".into(),
            project_id: "p".into(),
            active_seconds: 5,
            idle_seconds: 0,
            reason: "shutdown".into(),
        });
        assert!(last_run_ended_with_running_timer(&progress, &stop));
        StopStore::new(stop.clone()).clear();
        assert!(!last_run_ended_with_running_timer(&progress, &stop));
    }

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
