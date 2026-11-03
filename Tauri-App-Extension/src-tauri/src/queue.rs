use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::types::ActivityEvent;

/// Oldest batches are dropped once the backlog passes this — a multi-day outage shouldn't
/// grow this file without bound.
const MAX_QUEUED_BATCHES: usize = 2000;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct QueuedBatch {
    session_id: String,
    events: Vec<ActivityEvent>,
}

/// Disk-backed FIFO for events that failed to upload while offline.
pub struct EventQueue {
    path: PathBuf,
    /// The one batch being sent right now, written before the request and removed after it.
    /// A crash or power cut mid-upload leaves it behind, and the next start queues it.
    inflight_path: PathBuf,
    /// Only one batch can be in flight; the file is a single slot.
    inflight_lock: parking_lot::Mutex<()>,
    /// Number of batches (lines) currently on disk, tracked in memory so `enqueue()`
    /// doesn't have to re-read the entire backlog file on every single call just to decide
    queued_count: AtomicUsize,
    /// Batches discarded because the backlog hit the cap, since the last read.
    /// A dropped batch is tracked work that will never reach the server, so it
    /// is counted rather than only logged.
    dropped_count: AtomicUsize,
}

impl EventQueue {
    pub fn new(path: PathBuf) -> Self {
        let queued_count = AtomicUsize::new(count_lines(&path));
        let inflight_path = path.with_extension("inflight");
        let queue = Self {
            path,
            inflight_path,
            inflight_lock: parking_lot::Mutex::new(()),
            queued_count,
            dropped_count: AtomicUsize::new(0),
        };
        queue.recover_inflight();
        queue
    }

    /// A batch an earlier run was sending when it died. It may have reached the server
    /// (then it is sent twice) or not (then it would be lost); twice is the better mistake.
    fn recover_inflight(&self) {
        let Ok(text) = fs::read_to_string(&self.inflight_path) else {
            return;
        };
        if let Ok(batch) = serde_json::from_str::<QueuedBatch>(text.trim()) {
            self.enqueue(&batch.session_id, &batch.events);
            log::info!("Recovered a batch an earlier run was sending when it stopped");
        }
        let _ = fs::remove_file(&self.inflight_path);
    }

    /// Sends a batch with `send`, having saved it to disk first: a failed send is queued for
    /// retry, a successful one leaves nothing behind, and a crash in between is recovered
    /// by the next start. Returns whether `send` succeeded.
    pub fn send_or_queue(
        &self,
        session_id: &str,
        events: &[ActivityEvent],
        send: impl FnOnce() -> bool,
    ) -> bool {
        if events.is_empty() {
            return true;
        }
        let _slot = self.inflight_lock.lock();
        let batch = QueuedBatch { session_id: session_id.to_string(), events: events.to_vec() };
        if let Ok(line) = serde_json::to_string(&batch) {
            let _ = fs::write(&self.inflight_path, line);
        }
        let sent = send();
        if !sent {
            self.enqueue(session_id, events);
        }
        let _ = fs::remove_file(&self.inflight_path);
        sent
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
        // Only pay for the full-file read+rewrite when the tracked count says trimming
        // might actually be needed - the common case (queue well under the cap) never
        if self.queued_count.load(Ordering::Relaxed) >= MAX_QUEUED_BATCHES {
            self.trim_if_needed();
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&self.path) {
            if writeln!(file, "{line}").is_ok() {
                self.queued_count.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    /// Try to resend every queued batch via `send`.
    pub fn flush(&self, mut send: impl FnMut(&str, &[ActivityEvent]) -> bool) {
        let Ok(file) = File::open(&self.path) else {
            return;
        };
        // Filter_map (not map_while): a single bad line shouldn't cut off every batch
        // queued after it - this is a finite local file, not a stream that could error
        #[allow(clippy::lines_filter_map_ok)]
        let lines: Vec<String> = BufReader::new(file).lines().filter_map(Result::ok).collect();
        if lines.is_empty() {
            return;
        }

        let mut remaining = Vec::new();
        let mut flushed = 0u32;
        let mut failed = false;
        for line in lines {
            let Ok(batch) = serde_json::from_str::<QueuedBatch>(&line) else {
                continue;
            };
            // After one failure the rest would only wait out the same timeout while the
            // caller holds the API lock; keep them for the next flush.
            if !failed && send(&batch.session_id, &batch.events) {
                flushed += 1;
            } else {
                failed = true;
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
        // Same reasoning as flush() above - finite local file, keep partial recovery past a
        // single bad line instead of truncating at it.
        #[allow(clippy::lines_filter_map_ok)]
        let lines: Vec<String> = BufReader::new(file).lines().filter_map(Result::ok).collect();
        if lines.len() < MAX_QUEUED_BATCHES {
            self.queued_count.store(lines.len(), Ordering::Relaxed);
            return;
        }
        let drop_count = lines.len() - MAX_QUEUED_BATCHES + 1;
        log::warn!("Offline queue full, dropping {drop_count} oldest batch(es)");
        self.dropped_count.fetch_add(drop_count, Ordering::Relaxed);
        let kept: Vec<String> = lines.into_iter().skip(drop_count).collect();
        self.rewrite(&kept);
    }

    /// Reads and clears the count, so a caller that reports it upstream cannot
    /// report the same drops twice.
    pub fn take_dropped(&self) -> usize {
        self.dropped_count.swap(0, Ordering::Relaxed)
    }

    /// Puts a count back after a failed report, so a network blip cannot
    /// silently swallow the very fact this exists to surface.
    pub fn restore_dropped(&self, count: usize) {
        self.dropped_count.fetch_add(count, Ordering::Relaxed);
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

    /// Guards the in-memory counter this fix introduces: it must always reflect what's
    /// actually on disk, not drift from it across a sequence of enqueue/flush calls -
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

        // The last batch fails to send and stays queued, the two before it succeed and are
        // dropped from the backlog.
        let mut calls = 0u32;
        queue.flush(|_, _| {
            calls += 1;
            calls != 3
        });
        assert_eq!(queue.queued_count(), 1);
        assert_eq!(count_lines(&path), 1);

        // A fresh EventQueue over the same path must recover the count by reading the file
        // once at construction, not start back at 0.
        let reopened = EventQueue::new(path.clone());
        assert_eq!(reopened.queued_count(), 1);

        let _ = fs::remove_file(&path);
    }

    /// A dropped batch is tracked work that never reaches the server, so the
    /// count has to survive until it is reported and must not be reported twice.
    #[test]
    fn dropped_batches_are_counted_and_read_exactly_once() {
        let path = temp_queue_path("dropped-once");
        let _ = fs::remove_file(&path);
        let queue = EventQueue::new(path.clone());
        assert_eq!(queue.take_dropped(), 0);

        let lines: Vec<String> = (0..MAX_QUEUED_BATCHES + 3)
            .map(|i| {
                serde_json::to_string(&QueuedBatch {
                    session_id: format!("session-{i}"),
                    events: sample_events(),
                })
                .unwrap()
            })
            .collect();
        queue.rewrite(&lines);
        queue.trim_if_needed();

        let dropped = queue.take_dropped();
        assert!(dropped > 0, "trimming past the cap must count what it discarded");
        assert_eq!(queue.take_dropped(), 0, "a second read must not report the same drops again");
        let _ = fs::remove_file(&path);
    }

    // PLAN-agent-time-loss-and-event-queue.md Q4: with the network down the first send
    // fails, and flushing on through the other batches only holds the API lock for
    // N x the request timeout. One failure is enough to know the rest will fail too.
    #[test]
    fn a_failed_send_stops_the_flush_and_keeps_every_batch() {
        let path = temp_queue_path("flush-stops");
        let _ = fs::remove_file(&path);
        let queue = EventQueue::new(path.clone());
        for i in 0..5 {
            queue.enqueue(&format!("session-{i}"), &sample_events());
        }

        let mut attempts = 0u32;
        queue.flush(|_, _| {
            attempts += 1;
            false
        });

        assert_eq!(attempts, 1, "stopped at the first failure");
        assert_eq!(queue.queued_count(), 5, "nothing was delivered, so nothing is dropped");
        assert_eq!(count_lines(&path), 5);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn a_failed_report_can_put_the_count_back() {
        let path = temp_queue_path("dropped-restore");
        let _ = fs::remove_file(&path);
        let queue = EventQueue::new(path.clone());

        queue.restore_dropped(4);
        assert_eq!(queue.take_dropped(), 4);
        assert_eq!(queue.take_dropped(), 0);
        let _ = fs::remove_file(&path);
    }

    /// Oldest batches are dropped once the backlog passes MAX_QUEUED_BATCHES - exercised
    /// directly against trim_if_needed (rather than 2000 real enqueue() calls) since the
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

        // Trim_if_needed makes room for the batch enqueue() is about to append right after
        // it, so it trims to MAX_QUEUED_BATCHES - 1, not exactly MAX_QUEUED_BATCHES - see
        let expected = MAX_QUEUED_BATCHES - 1;
        assert_eq!(queue.queued_count(), expected);
        assert_eq!(count_lines(&path), expected);
        // The oldest entries (lowest indices) must be the ones dropped, not an
        // arbitrary/newest slice.
        let remaining = fs::read_to_string(&path).unwrap();
        assert!(!remaining.contains("\"session-0\""));
        assert!(remaining.contains(&format!("\"session-{}\"", MAX_QUEUED_BATCHES + 4)));

        let _ = fs::remove_file(&path);
    }

    /// Batches go out oldest first. The one the server refused is kept, and so is everything
    /// behind it, untried: one refusal is enough to know the rest would wait out the same
    /// timeout.
    #[test]
    fn flush_sends_in_order_and_keeps_the_refused_batch_and_those_behind_it() {
        let path = temp_queue_path("flush-order");
        let _ = fs::remove_file(&path);
        let queue = EventQueue::new(path.clone());
        for id in ["s1", "s2", "s3"] {
            queue.enqueue(id, &sample_events());
        }

        let mut seen = Vec::new();
        queue.flush(|id, _| {
            seen.push(id.to_string());
            id != "s2"
        });
        assert_eq!(seen, ["s1", "s2"], "s3 was not tried after s2 failed");

        let mut retried = Vec::new();
        queue.flush(|id, _| {
            retried.push(id.to_string());
            true
        });
        assert_eq!(retried, ["s2", "s3"], "the refused batch and the untried one survive, in order");
        let _ = fs::remove_file(&path);
    }

    /// A corrupt line (torn write, disk hiccup) must not cost the batches queued after it.
    #[test]
    fn flush_skips_a_corrupt_line_and_still_sends_the_rest() {
        let path = temp_queue_path("flush-corrupt");
        let _ = fs::remove_file(&path);
        let queue = EventQueue::new(path.clone());
        queue.enqueue("before", &sample_events());
        {
            let mut file = OpenOptions::new().append(true).open(&path).unwrap();
            writeln!(file, "{{not json").unwrap();
        }
        queue.enqueue("after", &sample_events());

        let mut seen = Vec::new();
        queue.flush(|id, _| {
            seen.push(id.to_string());
            true
        });
        assert_eq!(seen, ["before", "after"]);
        assert!(!path.exists(), "the corrupt line is not kept around to be re-parsed forever");
        assert_eq!(queue.queued_count(), 0);
    }

    #[test]
    fn a_fully_delivered_backlog_removes_the_file() {
        let path = temp_queue_path("flush-all");
        let _ = fs::remove_file(&path);
        let queue = EventQueue::new(path.clone());
        queue.enqueue("s1", &sample_events());
        queue.enqueue("s2", &sample_events());

        queue.flush(|_, _| true);
        assert!(!path.exists());
        assert_eq!(queue.queued_count(), 0);
    }

    #[test]
    fn flush_with_nothing_queued_never_calls_send() {
        let path = temp_queue_path("flush-empty");
        let _ = fs::remove_file(&path);
        let queue = EventQueue::new(path.clone());
        queue.enqueue("s1", &[]);

        queue.flush(|_, _| panic!("nothing was queued, so nothing may be sent"));
        assert!(!path.exists(), "an empty batch is not written to disk");
    }

    // --- Write-ahead events (PLAN-agent-time-loss-and-event-queue.md section 9) -------------

    #[test]
    fn a_batch_is_on_disk_while_it_is_being_sent_and_gone_after_a_success() {
        let path = temp_queue_path("inflight-ok");
        let _ = fs::remove_file(&path);
        let queue = EventQueue::new(path.clone());
        let inflight = path.with_extension("inflight");

        let sent = queue.send_or_queue("session-a", &sample_events(), || {
            assert!(inflight.exists(), "saved before the request goes out");
            true
        });

        assert!(sent);
        assert!(!inflight.exists());
        assert_eq!(queue.queued_count(), 0, "a delivered batch is not also queued");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn a_batch_that_fails_to_send_is_queued_exactly_once() {
        let path = temp_queue_path("inflight-fail");
        let _ = fs::remove_file(&path);
        let queue = EventQueue::new(path.clone());

        let sent = queue.send_or_queue("session-a", &sample_events(), || false);

        assert!(!sent);
        assert!(!path.with_extension("inflight").exists());
        assert_eq!(queue.queued_count(), 1);
        assert_eq!(count_lines(&path), 1);
        let _ = fs::remove_file(&path);
    }

    // The app or the PC dies after the batch was saved and before the answer came back.
    #[test]
    fn a_batch_that_was_being_sent_when_the_app_died_is_queued_by_the_next_start() {
        let path = temp_queue_path("inflight-crash");
        let _ = fs::remove_file(&path);
        let batch = QueuedBatch { session_id: "session-x".into(), events: sample_events() };
        fs::write(path.with_extension("inflight"), serde_json::to_string(&batch).unwrap()).unwrap();

        let queue = EventQueue::new(path.clone());

        assert_eq!(queue.queued_count(), 1);
        let mut resent = Vec::new();
        queue.flush(|id, _| {
            resent.push(id.to_string());
            true
        });
        assert_eq!(resent, ["session-x"]);
        assert!(!path.with_extension("inflight").exists());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn a_damaged_leftover_is_discarded_not_fatal() {
        let path = temp_queue_path("inflight-bad");
        let _ = fs::remove_file(&path);
        fs::write(path.with_extension("inflight"), b"{ not json").unwrap();

        let queue = EventQueue::new(path.clone());

        assert_eq!(queue.queued_count(), 0);
        assert!(!path.with_extension("inflight").exists());
        let _ = fs::remove_file(&path);
    }
}
