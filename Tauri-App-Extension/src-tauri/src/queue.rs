use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::types::ActivityEvent;

/// Oldest batches are dropped once the backlog passes this — a multi-day outage
/// shouldn't grow this file without bound.
const MAX_QUEUED_BATCHES: usize = 2000;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct QueuedBatch {
    session_id: String,
    events: Vec<ActivityEvent>,
}

/// Disk-backed FIFO for events that failed to upload while offline. Captured
/// data keeps accumulating locally during an outage; once the backend is
/// reachable again everything queued gets resent and cleared.
pub struct EventQueue {
    path: PathBuf,
    /// Number of batches (lines) currently on disk, tracked in memory so
    /// `enqueue()` doesn't have to re-read the entire backlog file on every
    /// single call just to decide whether trimming is needed - that full-file
    /// scan per enqueue was an O(1) append turned into O(n) I/O + allocation
    /// on a process meant to idle quietly for weeks. Kept in sync by every
    /// method that changes what's on disk (enqueue/trim_if_needed/rewrite).
    queued_count: AtomicUsize,
}

impl EventQueue {
    pub fn new(path: PathBuf) -> Self {
        let queued_count = AtomicUsize::new(count_lines(&path));
        Self { path, queued_count }
    }

    /// Buffer a batch that failed to upload, for retry once the connection returns.
    pub fn enqueue(&self, session_id: &str, events: &[ActivityEvent]) {
        if events.is_empty() {
            return;
        }
        let batch = QueuedBatch {
            session_id: session_id.to_string(),
            events: events.to_vec(),
        };
        let Ok(line) = serde_json::to_string(&batch) else {
            return;
        };
        // Only pay for the full-file read+rewrite when the tracked count
        // says trimming might actually be needed - the common case (queue
        // well under the cap) never touches the file for this.
        if self.queued_count.load(Ordering::Relaxed) >= MAX_QUEUED_BATCHES {
            self.trim_if_needed();
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&self.path) {
            if writeln!(file, "{line}").is_ok() {
                self.queued_count.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    /// Try to resend every queued batch via `send`. Batches that fail again stay
    /// queued, in original order, for the next flush attempt.
    pub fn flush(&self, mut send: impl FnMut(&str, &[ActivityEvent]) -> bool) {
        let Ok(file) = File::open(&self.path) else {
            return;
        };
        // filter_map (not map_while): a single bad line shouldn't cut off every
        // batch queued after it - this is a finite local file, not a stream that
        // could error forever, so clippy's infinite-loop concern doesn't apply here.
        #[allow(clippy::lines_filter_map_ok)]
        let lines: Vec<String> = BufReader::new(file).lines().filter_map(Result::ok).collect();
        if lines.is_empty() {
            return;
        }

        let mut remaining = Vec::new();
        let mut flushed = 0u32;
        for line in lines {
            let Ok(batch) = serde_json::from_str::<QueuedBatch>(&line) else {
                continue;
            };
            if send(&batch.session_id, &batch.events) {
                flushed += 1;
            } else {
                remaining.push(line);
            }
        }
        if flushed > 0 {
            log::info!("Flushed {flushed} queued offline batch(es) to the server");
        }
        self.rewrite(&remaining);
    }

    fn trim_if_needed(&self) {
        let Ok(file) = File::open(&self.path) else {
            self.queued_count.store(0, Ordering::Relaxed);
            return;
        };
        // Same reasoning as flush() above - finite local file, keep partial
        // recovery past a single bad line instead of truncating at it.
        #[allow(clippy::lines_filter_map_ok)]
        let lines: Vec<String> = BufReader::new(file).lines().filter_map(Result::ok).collect();
        if lines.len() < MAX_QUEUED_BATCHES {
            self.queued_count.store(lines.len(), Ordering::Relaxed);
            return;
        }
        let drop_count = lines.len() - MAX_QUEUED_BATCHES + 1;
        log::warn!("Offline queue full, dropping {drop_count} oldest batch(es)");
        let kept: Vec<String> = lines.into_iter().skip(drop_count).collect();
        self.rewrite(&kept);
    }

    fn rewrite(&self, lines: &[String]) {
        self.queued_count.store(lines.len(), Ordering::Relaxed);
        if lines.is_empty() {
            let _ = fs::remove_file(&self.path);
            return;
        }
        if let Ok(mut file) = File::create(&self.path) {
            for line in lines {
                let _ = writeln!(file, "{line}");
            }
        }
    }

    #[cfg(test)]
    fn queued_count(&self) -> usize {
        self.queued_count.load(Ordering::Relaxed)
    }
}

fn count_lines(path: &Path) -> usize {
    let Ok(file) = File::open(path) else {
        return 0;
    };
    #[allow(clippy::lines_filter_map_ok)]
    BufReader::new(file).lines().filter_map(Result::ok).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_queue_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "vt-queue-test-{name}-{}-{}.jsonl",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ))
    }

    fn sample_events() -> Vec<ActivityEvent> {
        vec![ActivityEvent::App {
            app_name: "Test App".into(),
            page_title: "Test".into(),
            duration_seconds: 15,
            app_icon: None,
            signal: crate::types::ActivitySignal::default(),
        }]
    }

    /// Guards the in-memory counter this fix introduces: it must always
    /// reflect what's actually on disk, not drift from it across a sequence
    /// of enqueue/flush calls - that's the invariant `enqueue()` now relies
    /// on to skip the full-file read on the common (under-the-cap) path.
    #[test]
    fn queued_count_tracks_the_real_file_line_count() {
        let path = temp_queue_path("counter");
        let _ = fs::remove_file(&path);
        let queue = EventQueue::new(path.clone());
        assert_eq!(queue.queued_count(), 0);

        queue.enqueue("session-a", &sample_events());
        queue.enqueue("session-b", &sample_events());
        queue.enqueue("session-c", &sample_events());
        assert_eq!(queue.queued_count(), 3);
        assert_eq!(count_lines(&path), 3);

        // One batch fails to send and stays queued, two succeed and are
        // dropped from the backlog.
        let mut calls = 0u32;
        queue.flush(|_, _| {
            calls += 1;
            calls != 1
        });
        assert_eq!(queue.queued_count(), 1);
        assert_eq!(count_lines(&path), 1);

        // A fresh EventQueue over the same path must recover the count by
        // reading the file once at construction, not start back at 0.
        let reopened = EventQueue::new(path.clone());
        assert_eq!(reopened.queued_count(), 1);

        let _ = fs::remove_file(&path);
    }

    /// Oldest batches are dropped once the backlog passes MAX_QUEUED_BATCHES -
    /// exercised directly against trim_if_needed (rather than 2000 real
    /// enqueue() calls) since the cap is a private, non-injectable constant.
    #[test]
    fn trim_drops_the_oldest_batches_once_over_the_cap() {
        let path = temp_queue_path("trim");
        let _ = fs::remove_file(&path);
        let queue = EventQueue::new(path.clone());

        let lines: Vec<String> = (0..MAX_QUEUED_BATCHES + 5)
            .map(|i| {
                serde_json::to_string(&QueuedBatch {
                    session_id: format!("session-{i}"),
                    events: sample_events(),
                })
                .unwrap()
            })
            .collect();
        queue.rewrite(&lines);
        assert_eq!(queue.queued_count(), MAX_QUEUED_BATCHES + 5);

        queue.trim_if_needed();

        // trim_if_needed makes room for the batch enqueue() is about to
        // append right after it, so it trims to MAX_QUEUED_BATCHES - 1, not
        // exactly MAX_QUEUED_BATCHES - see the `drop_count` "+ 1" above.
        let expected = MAX_QUEUED_BATCHES - 1;
        assert_eq!(queue.queued_count(), expected);
        assert_eq!(count_lines(&path), expected);
        // The oldest entries (lowest indices) must be the ones dropped, not
        // an arbitrary/newest slice.
        let remaining = fs::read_to_string(&path).unwrap();
        assert!(!remaining.contains("\"session-0\""));
        assert!(remaining.contains(&format!("\"session-{}\"", MAX_QUEUED_BATCHES + 4)));

        let _ = fs::remove_file(&path);
    }
}
