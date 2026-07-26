use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::capture::activity::ActivityMeter;
use crate::capture::events::EventBuilder;
use crate::capture::window::get_foreground_window;
use crate::client::api::ApiClient;
use crate::config::Settings;
use crate::constants::{
    APP_LOG_INTERVAL_SEC, FIRST_SCREENSHOT_DELAY_SEC, IDLE_THRESHOLD_SEC, SESSION_POLL_SEC,
    SESSION_SYNC_INTERVAL_SEC,
};
use crate::queue::EventQueue;

pub type StatusCallback = Arc<dyn Fn(String) + Send + Sync>;

/// How often to retry the offline queue while ticking every SESSION_POLL_SEC —
/// no point hammering a dead connection every 5s.
const QUEUE_FLUSH_INTERVAL_SEC: u64 = 30;

pub struct ActivityTracker {
    api: Arc<Mutex<ApiClient>>,
    events: EventBuilder,
    activity: Arc<ActivityMeter>,
    queue: EventQueue,
    on_status: Option<StatusCallback>,
    stop: Arc<AtomicBool>,
    session_id: Arc<Mutex<Option<String>>>,
    /// Task currently being tracked plus the cumulative active/idle seconds
    /// worked on it so far (server baseline at session/task start + elapsed
    /// ticks since, split by whether there was recent mouse/keyboard input).
    /// Read by the controller on stop/quit so the final flush carries the real
    /// numbers instead of hardcoded 0s.
    task_progress: Arc<Mutex<(Option<String>, u64, u64)>>,
}

impl ActivityTracker {
    pub fn new(
        api: Arc<Mutex<ApiClient>>,
        settings: &Settings,
        activity: Arc<ActivityMeter>,
        on_status: Option<StatusCallback>,
    ) -> Self {
        let events = EventBuilder::new(
            Arc::clone(&activity),
            settings.url_script_path.clone(),
            settings.macos_url_script_path.clone(),
        );
        Self {
            api,
            events,
            activity,
            queue: EventQueue::new(settings.queue_path.clone()),
            on_status,
            stop: Arc::new(AtomicBool::new(false)),
            session_id: Arc::new(Mutex::new(None)),
            task_progress: Arc::new(Mutex::new((None, 0, 0))),
        }
    }

    /// Caller (`AgentController::start_tracker`) always stops any prior tracker
    /// and builds a fresh instance before calling this, so there's no existing
    /// loop to guard against here — just clear the stop flag and spawn.
    pub fn start(self: &Arc<Self>) {
        self.stop.store(false, Ordering::SeqCst);
        self.activity.start();
        let tracker = Arc::clone(self);
        thread::Builder::new()
            .name("vt-tracker".into())
            .spawn(move || tracker.loop_run())
            .ok();
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        *self.session_id.lock() = None;
    }

    /// The session currently being tracked, if any — used to cleanly close it
    /// server-side on quit instead of leaving it "active" forever (which would
    /// otherwise get silently resumed the next time the agent signs in).
    pub fn current_session_id(&self) -> Option<String> {
        self.session_id.lock().clone()
    }

    /// Task being tracked plus the real cumulative active/idle seconds worked
    /// on it so far (baseline pulled from the server at session start +
    /// elapsed ticks). The controller reads this right before posting "stop"
    /// so a clean quit/sign-out/logout flushes the real numbers instead of 0s.
    pub fn current_task_progress(&self) -> (Option<String>, u64, u64) {
        self.task_progress.lock().clone()
    }

    fn emit_status(&self, text: &str) {
        if let Some(cb) = &self.on_status {
            cb(text.to_string());
        }
    }

    fn loop_run(&self) {
        let mut last_app_log_at = Instant::now() - Duration::from_secs(APP_LOG_INTERVAL_SEC);
        let mut next_screenshot_at = Instant::now();
        let mut was_active = false;
        let mut current_session = String::new();
        let mut next_flush_at = Instant::now();
        let mut task_id = String::new();
        let mut active_baseline: u64 = 0;
        let mut active_elapsed: u64 = 0;
        let mut idle_baseline: u64 = 0;
        let mut idle_elapsed: u64 = 0;
        let mut next_sync_at = Instant::now();

        while !self.stop.load(Ordering::SeqCst) {
            if let Err(err) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                self.tick(
                    &mut last_app_log_at,
                    &mut next_screenshot_at,
                    &mut was_active,
                    &mut current_session,
                    &mut next_flush_at,
                    &mut task_id,
                    &mut active_baseline,
                    &mut active_elapsed,
                    &mut idle_baseline,
                    &mut idle_elapsed,
                    &mut next_sync_at,
                );
            })) {
                log::warn!("Tracker tick failed: {err:?}");
            }
            thread::sleep(Duration::from_secs(SESSION_POLL_SEC));
        }
    }

    /// Try to resend anything queued from a prior outage. Throttled — no point
    /// retrying every 5s against a connection that's still down.
    fn maybe_flush_queue(&self, next_flush_at: &mut Instant) {
        if Instant::now() < *next_flush_at {
            return;
        }
        *next_flush_at = Instant::now() + Duration::from_secs(QUEUE_FLUSH_INTERVAL_SEC);
        self.queue
            .flush(|session_id, events| self.api.lock().post_events(session_id, events));
    }

    fn tick(
        &self,
        last_app_log_at: &mut Instant,
        next_screenshot_at: &mut Instant,
        was_active: &mut bool,
        current_session: &mut String,
        next_flush_at: &mut Instant,
        task_id: &mut String,
        active_baseline: &mut u64,
        active_elapsed: &mut u64,
        idle_baseline: &mut u64,
        idle_elapsed: &mut u64,
        next_sync_at: &mut Instant,
    ) {
        self.maybe_flush_queue(next_flush_at);

        let session = match self.api.lock().fetch_session() {
            Ok(session) => session,
            Err(()) => {
                // Backend unreachable. If we were mid-session, keep capturing under
                // it — nothing gets lost, it just queues locally (and keeps ticking
                // active/idle seconds) until reconnected, when the next sync catches up.
                if *was_active && !current_session.is_empty() {
                    let window = get_foreground_window();
                    let session_id = current_session.clone();
                    let now = Instant::now();
                    self.tick_progress(task_id, active_baseline, active_elapsed, idle_baseline, idle_elapsed);
                    if now >= *next_screenshot_at {
                        self.upload_screenshot(&session_id, &window);
                        *next_screenshot_at =
                            now + Duration::from_secs(self.events.random_screenshot_delay_sec());
                    }
                    if now.duration_since(*last_app_log_at).as_secs() >= APP_LOG_INTERVAL_SEC {
                        self.upload_app_slice(&session_id, &window);
                        *last_app_log_at = now;
                    }
                }
                return;
            }
        };
        let Some(session) = session else {
            if *was_active {
                self.emit_status("Signed in — waiting for timer");
            }
            self.reset_task_progress(task_id, active_baseline, active_elapsed, idle_baseline, idle_elapsed);
            *was_active = false;
            *current_session = String::new();
            *self.session_id.lock() = None;
            return;
        };

        let status = session
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if status != "active" {
            if status == "idle" {
                self.emit_status("Timer idle — capture paused");
            } else if *was_active {
                self.emit_status("Signed in — waiting for timer");
            }
            self.reset_task_progress(task_id, active_baseline, active_elapsed, idle_baseline, idle_elapsed);
            *was_active = false;
            *current_session = String::new();
            *self.session_id.lock() = None;
            return;
        }

        let session_id = match session.get("id").and_then(|v| v.as_str()) {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => return,
        };

        let window = get_foreground_window();

        if current_session.as_str() != session_id {
            *current_session = session_id.clone();
            *self.session_id.lock() = Some(session_id.clone());
            *last_app_log_at = Instant::now() - Duration::from_secs(APP_LOG_INTERVAL_SEC);
            *next_screenshot_at = Instant::now() + Duration::from_secs(FIRST_SCREENSHOT_DELAY_SEC);
            log::info!("Tracking session {session_id}");
            self.upload_app_slice(&session_id, &window);
            *last_app_log_at = Instant::now();
        }

        // Task can change under a session that's already open (resume onto a
        // different task) - re-baseline from the server's known totals for it
        // whenever the tracked task id changes, so we resume from the real
        // cumulative instead of quietly restarting the count at 0.
        let session_task_id = session
            .get("taskId")
            .or_else(|| session.get("task_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if task_id.as_str() != session_task_id {
            *task_id = session_task_id.clone();
            *active_elapsed = 0;
            *idle_elapsed = 0;
            let tracking = if session_task_id.is_empty() {
                None
            } else {
                self.api.lock().fetch_task_time_tracking(&session_task_id)
            };
            *active_baseline = tracking.as_ref().map(|t| t.active_seconds).unwrap_or(0);
            *idle_baseline = tracking.as_ref().map(|t| t.idle_seconds).unwrap_or(0);
            *next_sync_at = Instant::now();
        }

        *was_active = true;
        self.emit_status("Task session active");

        let now = Instant::now();
        self.tick_progress(task_id, active_baseline, active_elapsed, idle_baseline, idle_elapsed);

        if now >= *next_screenshot_at {
            self.upload_screenshot(&session_id, &window);
            *next_screenshot_at =
                now + Duration::from_secs(self.events.random_screenshot_delay_sec());
        }

        if now.duration_since(*last_app_log_at).as_secs() >= APP_LOG_INTERVAL_SEC {
            self.upload_app_slice(&session_id, &window);
            *last_app_log_at = now;
        }

        if !task_id.is_empty() && now >= *next_sync_at {
            let active_total = *active_baseline + *active_elapsed;
            let idle_total = *idle_baseline + *idle_elapsed;
            let _ = self.api.lock().post_session_action(
                "sync",
                Some(task_id.as_str()),
                active_total,
                idle_total,
            );
            *next_sync_at = now + Duration::from_secs(SESSION_SYNC_INTERVAL_SEC);
        }
    }

    /// Counts this tick's SESSION_POLL_SEC as idle rather than active if
    /// there's been no mouse/keyboard input for IDLE_THRESHOLD_SEC - an open
    /// session sitting untouched shouldn't silently rack up "active" hours.
    fn tick_progress(
        &self,
        task_id: &str,
        active_baseline: &u64,
        active_elapsed: &mut u64,
        idle_baseline: &u64,
        idle_elapsed: &mut u64,
    ) {
        if self.activity.idle_seconds() >= IDLE_THRESHOLD_SEC {
            *idle_elapsed += SESSION_POLL_SEC;
        } else {
            *active_elapsed += SESSION_POLL_SEC;
        }
        self.set_task_progress(
            task_id,
            *active_baseline + *active_elapsed,
            *idle_baseline + *idle_elapsed,
        );
    }

    fn set_task_progress(&self, task_id: &str, active_seconds: u64, idle_seconds: u64) {
        let id = if task_id.is_empty() {
            None
        } else {
            Some(task_id.to_string())
        };
        *self.task_progress.lock() = (id, active_seconds, idle_seconds);
    }

    fn reset_task_progress(
        &self,
        task_id: &mut String,
        active_baseline: &mut u64,
        active_elapsed: &mut u64,
        idle_baseline: &mut u64,
        idle_elapsed: &mut u64,
    ) {
        task_id.clear();
        *active_baseline = 0;
        *active_elapsed = 0;
        *idle_baseline = 0;
        *idle_elapsed = 0;
        *self.task_progress.lock() = (None, 0, 0);
    }

    fn upload_screenshot(
        &self,
        session_id: &str,
        window: &crate::capture::window::ForegroundWindow,
    ) {
        let Some(event) = self.events.screenshot(window) else {
            return;
        };
        if self.api.lock().post_events(session_id, std::slice::from_ref(&event)) {
            log::info!("Activity uploaded");
        } else {
            self.queue.enqueue(session_id, &[event]);
        }
    }

    fn upload_app_slice(
        &self,
        session_id: &str,
        window: &crate::capture::window::ForegroundWindow,
    ) {
        let app_event = self.events.app_slice(window);
        let app_ok = self.api.lock().post_events(session_id, std::slice::from_ref(&app_event));
        if !app_ok {
            self.queue.enqueue(session_id, &[app_event]);
        }

        // Was true unconditionally whenever no URL was captured at all (not a
        // browser, or the capture script came back empty) — every non-browser
        // app log line was claiming "+ URL" it never had.
        let mut url_sent = false;
        if let Some(url_event) = self.events.url_slice(window) {
            let url_ok = self.api.lock().post_events(session_id, std::slice::from_ref(&url_event));
            if url_ok {
                url_sent = true;
            } else {
                self.queue.enqueue(session_id, &[url_event]);
            }
        }

        if app_ok {
            self.activity.reset();
            log::info!(
                "Logged app slice: {}{}",
                window.app_name,
                if url_sent { " + URL" } else { "" }
            );
        } else {
            log::warn!("App/URL upload failed for session {session_id}, queued for retry");
        }
    }
}
