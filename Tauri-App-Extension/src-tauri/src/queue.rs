use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

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
}

impl EventQueue {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
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
        self.trim_if_needed();
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&self.path) {
            let _ = writeln!(file, "{line}");
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
            return;
        };
        // Same reasoning as flush() above - finite local file, keep partial
        // recovery past a single bad line instead of truncating at it.
        #[allow(clippy::lines_filter_map_ok)]
        let lines: Vec<String> = BufReader::new(file).lines().filter_map(Result::ok).collect();
        if lines.len() < MAX_QUEUED_BATCHES {
            return;
        }
        let drop_count = lines.len() - MAX_QUEUED_BATCHES + 1;
        log::warn!("Offline queue full, dropping {drop_count} oldest batch(es)");
        let kept: Vec<String> = lines.into_iter().skip(drop_count).collect();
        self.rewrite(&kept);
    }

    fn rewrite(&self, lines: &[String]) {
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
}
