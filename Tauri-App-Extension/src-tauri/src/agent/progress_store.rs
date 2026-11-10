use std::fs;
use std::path::{Path, PathBuf};

/// Crash-safe mirror of `ActivityTracker`'s in-memory `task_progress`.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PersistedProgress {
    pub session_id: String,
    pub task_id: Option<String>,
    /// For a task-less session, which project it was on, so it can be started again. Absent in
    /// files written by older builds.
    #[serde(default)]
    pub project_id: Option<String>,
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

/// What the member is told after the last run ended with a timer still open (the app or the PC went
/// away mid-session), and what is needed to start the same work again.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestartNotice {
    /// When the tracker last wrote its state - within a few seconds of when it stopped.
    pub stopped_at_ms: i64,
    pub task_id: Option<String>,
    pub project_id: Option<String>,
}

fn modified_ms(path: &Path) -> Option<i64> {
    let since = fs::metadata(path).ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(since.as_millis()).ok()
}

/// `Some` when the last run ended with a running timer: the progress mirror is cleared when a
/// session closes cleanly, and the pending-stop file when the server confirms a stop, so a
/// leftover means the app or the PC went away mid-session. Read before anything starts a tracker.
pub fn unclean_exit_notice(progress_path: &Path, stop_path: &Path) -> Option<RestartNotice> {
    let progress = ProgressStore::new(progress_path.to_path_buf()).load();
    let stop = StopStore::new(stop_path.to_path_buf()).load();
    if progress.is_none() && stop.is_none() {
        return None;
    }
    let non_empty = |v: String| Some(v).filter(|v| !v.is_empty());
    let task_id = progress
        .as_ref()
        .and_then(|p| p.task_id.clone())
        .or_else(|| stop.as_ref().and_then(|s| non_empty(s.task_id.clone())));
    let project_id = progress
        .as_ref()
        .and_then(|p| p.project_id.clone())
        .or_else(|| stop.as_ref().and_then(|s| non_empty(s.project_id.clone())));
    let stopped_at_ms = [modified_ms(progress_path), modified_ms(stop_path)].into_iter().flatten().max().unwrap_or(0);
    Some(RestartNotice { stopped_at_ms, task_id, project_id })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_left_behind_means_no_notice() {
        let progress = std::env::temp_dir().join(format!("vt-r1-none-progress-{}.json", std::process::id()));
        let stop = std::env::temp_dir().join(format!("vt-r1-none-stop-{}.json", std::process::id()));
        let _ = fs::remove_file(&progress);
        let _ = fs::remove_file(&stop);
        assert_eq!(unclean_exit_notice(&progress, &stop), None);
    }

    #[test]
    fn a_leftover_progress_file_gives_a_notice_with_the_work_to_start_again() {
        let progress = std::env::temp_dir().join(format!("vt-r1-progress-{}.json", std::process::id()));
        let stop = std::env::temp_dir().join(format!("vt-r1-p-stop-{}.json", std::process::id()));
        let _ = fs::remove_file(&stop);
        ProgressStore::new(progress.clone()).save(&PersistedProgress {
            session_id: "s".into(),
            task_id: Some("task-1".into()),
            project_id: Some("proj-1".into()),
            active_seconds: 5,
            idle_seconds: 0,
        });
        let notice = unclean_exit_notice(&progress, &stop).expect("a timer was left running");
        assert_eq!(notice.task_id.as_deref(), Some("task-1"));
        assert_eq!(notice.project_id.as_deref(), Some("proj-1"));
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        assert!((now - notice.stopped_at_ms).abs() < 60_000, "stopped_at is when the file was last written");
        ProgressStore::new(progress).clear();
    }

    #[test]
    fn a_leftover_stop_alone_gives_a_notice_for_a_task_less_session() {
        let progress = std::env::temp_dir().join(format!("vt-r1-s-progress-{}.json", std::process::id()));
        let stop = std::env::temp_dir().join(format!("vt-r1-stop-{}.json", std::process::id()));
        let _ = fs::remove_file(&progress);
        StopStore::new(stop.clone()).save(&PersistedStop {
            session_id: "s".into(),
            task_id: String::new(),
            project_id: "proj-9".into(),
            active_seconds: 5,
            idle_seconds: 0,
            reason: "shutdown".into(),
        });
        let notice = unclean_exit_notice(&progress, &stop).expect("a stop was left undelivered");
        assert_eq!(notice.task_id, None, "an empty id is not a task");
        assert_eq!(notice.project_id.as_deref(), Some("proj-9"));
        StopStore::new(stop).clear();
    }

    #[test]
    fn progress_files_from_an_older_build_still_load() {
        let path = temp_progress_path("old-build");
        fs::write(&path, br#"{"session_id":"s","task_id":"t","active_seconds":1,"idle_seconds":2}"#).unwrap();
        let loaded = ProgressStore::new(path.clone()).load().expect("loads without project_id");
        assert_eq!(loaded.project_id, None);
        let _ = fs::remove_file(&path);
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
            project_id: None,
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
            project_id: None,
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
