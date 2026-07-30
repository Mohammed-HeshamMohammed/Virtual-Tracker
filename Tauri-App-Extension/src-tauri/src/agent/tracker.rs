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
    APP_LOG_INTERVAL_SEC, FIRST_SCREENSHOT_DELAY_SEC, IDLE_FLAG_ALERT_SEC, IDLE_FLAG_STOP_SEC,
    IDLE_FLAG_WARN_SEC, IDLE_THRESHOLD_SEC, SESSION_POLL_SEC, SESSION_SYNC_INTERVAL_SEC,
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
    /// Current idle escalation stage, readable by the UI.
    /// 0 = working, 1 = warned, 2 = alerted, 3 = stopped for idling.
    idle_stage: Arc<Mutex<u8>>,
}

/// Cumulative active seconds at the last moment there was real input, plus the
/// escalation stage already announced. When the timer is stopped for idling,
/// the active total is rewound to `active_at_last_input` - i.e. everything
/// credited since the user actually stopped touching the machine is reversed,
/// which is the whole point of the flags.
#[derive(Default)]
struct IdleWatch {
    stage: u8,
    active_at_last_input: u64,
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
            idle_stage: Arc::new(Mutex::new(0)),
        }
    }

    pub fn idle_stage(&self) -> u8 {
        *self.idle_stage.lock()
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
        let mut idle_watch = IdleWatch::default();

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
                    &mut idle_watch,
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
        idle_watch: &mut IdleWatch,
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
            // Task-less (calling project) sessions have no per-task totals to
            // re-baseline from, so the session's own accumulated seconds are
            // the cumulative figure - without this a resume would restart the
            // count at 0 and push a lower total than already recorded.
            let session_seconds = |key: &str| {
                session.get(key).and_then(|v| v.as_u64()).unwrap_or(0)
            };
            *active_baseline = tracking
                .as_ref()
                .map(|t| t.active_seconds)
                .unwrap_or_else(|| session_seconds("activeSeconds"));
            *idle_baseline = tracking
                .as_ref()
                .map(|t| t.idle_seconds)
                .unwrap_or_else(|| session_seconds("idleSeconds"));
            *next_sync_at = Instant::now();
        }

        *was_active = true;

        let now = Instant::now();
        self.tick_progress(task_id, active_baseline, active_elapsed, idle_baseline, idle_elapsed);

        // Calling-project sessions have no task, so they sync on project id
        // instead - gating purely on task id would leave their time unrecorded.
        let session_project_id = session
            .get("projectId")
            .or_else(|| session.get("project_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if self.tick_idle_escalation(
            idle_watch,
            task_id,
            &session_project_id,
            active_baseline,
            active_elapsed,
            idle_baseline,
            idle_elapsed,
        ) {
            // Timer was stopped for idling; this session is over.
            *was_active = false;
            *current_session = String::new();
            *self.session_id.lock() = None;
            self.reset_task_progress(
                task_id,
                active_baseline,
                active_elapsed,
                idle_baseline,
                idle_elapsed,
            );
            return;
        }

        if now >= *next_screenshot_at {
            self.upload_screenshot(&session_id, &window);
            *next_screenshot_at =
                now + Duration::from_secs(self.events.random_screenshot_delay_sec());
        }

        if now.duration_since(*last_app_log_at).as_secs() >= APP_LOG_INTERVAL_SEC {
            self.upload_app_slice(&session_id, &window);
            *last_app_log_at = now;
        }

        if (!task_id.is_empty() || !session_project_id.is_empty()) && now >= *next_sync_at {
            let active_total = *active_baseline + *active_elapsed;
            let idle_total = *idle_baseline + *idle_elapsed;
            let _ = self.api.lock().post_session_action(
                "sync",
                Some(task_id.as_str()).filter(|id| !id.is_empty()),
                Some(session_project_id.as_str()).filter(|id| !id.is_empty()),
                active_total,
                idle_total,
            );
            *next_sync_at = now + Duration::from_secs(SESSION_SYNC_INTERVAL_SEC);
        }
    }

    /// Three-stage idle escalation. Returns true when the timer was stopped.
    ///
    /// Stages fire at 5 / 10 / 15 minutes without input. The first two only
    /// warn. The third stops the timer and rewinds the active total to what it
    /// was at the last real input - so the entire idle stretch, including the
    /// minute that `tick_progress` credited before its own threshold kicked
    /// in, is reversed rather than banked.
    #[allow(clippy::too_many_arguments)]
    fn tick_idle_escalation(
        &self,
        watch: &mut IdleWatch,
        task_id: &str,
        project_id: &str,
        active_baseline: &u64,
        active_elapsed: &u64,
        idle_baseline: &u64,
        idle_elapsed: &u64,
    ) -> bool {
        let idle_for = self.activity.idle_seconds();
        let active_total = active_baseline.saturating_add(*active_elapsed);

        // Real input: clear any warning and remember this as the last honest
        // point the clock can be rewound to.
        if idle_for < IDLE_THRESHOLD_SEC {
            if watch.stage != 0 {
                watch.stage = 0;
                *self.idle_stage.lock() = 0;
                self.emit_status("Task session active");
            }
            watch.active_at_last_input = active_total;
            return false;
        }

        if idle_for >= IDLE_FLAG_STOP_SEC {
            // Never let the rewind push the total up, and never below zero -
            // clamping both ways because a mis-ordered snapshot would
            // otherwise mint or destroy hours.
            let (rewound, reversed) = Self::rewind_active(active_total, watch.active_at_last_input);
            let idle_total = idle_baseline.saturating_add(*idle_elapsed);

            log::info!(
                "Idle {}s - stopping timer and reversing {}s of active time (from {}s to {}s)",
                idle_for,
                reversed,
                active_total,
                rewound
            );

            self.set_task_progress(task_id, rewound, idle_total);
            let _ = self.api.lock().post_session_action(
                "stop",
                Some(task_id).filter(|id| !id.is_empty()),
                Some(project_id).filter(|id| !id.is_empty()),
                rewound,
                idle_total,
            );

            watch.stage = 3;
            *self.idle_stage.lock() = 3;
            watch.active_at_last_input = 0;
            self.emit_status("Timer stopped — idle too long, idle time removed");
            return true;
        }

        if idle_for >= IDLE_FLAG_ALERT_SEC && watch.stage < 2 {
            watch.stage = 2;
            *self.idle_stage.lock() = 2;
            self.emit_status("Still idle — timer will stop soon and this idle time will be removed");
        } else if idle_for >= IDLE_FLAG_WARN_SEC && watch.stage < 1 {
            watch.stage = 1;
            *self.idle_stage.lock() = 1;
            self.emit_status("Idle — no activity detected");
        }
        false
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
        *self.idle_stage.lock() = 0;
    }

    /// The rewind arithmetic on its own, so it can be tested without a live
    /// session. Returns (new_active_total, seconds_reversed).
    ///
    /// Clamped in both directions on purpose: a snapshot ahead of the current
    /// total would otherwise *invent* hours, and an unsigned subtraction that
    /// went negative would wrap to an enormous number.
    fn rewind_active(active_total: u64, active_at_last_input: u64) -> (u64, u64) {
        let rewound = active_at_last_input.min(active_total);
        (rewound, active_total.saturating_sub(rewound))
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

#[cfg(test)]
mod tests {
    use super::ActivityTracker;

    // Guards the money-adjacent bit of idle escalation: when the timer auto-
    // stops, exactly the time worked after the user stopped touching the
    // machine must come off - no more, no less, and never a wrapped u64.

    #[test]
    fn reverses_only_the_time_credited_since_the_user_went_idle() {
        // 3600s on the clock, 3540s of it earned before input stopped.
        let (rewound, reversed) = ActivityTracker::rewind_active(3600, 3540);
        assert_eq!(rewound, 3540);
        assert_eq!(reversed, 60);
    }

    #[test]
    fn idling_from_the_very_start_reverses_everything() {
        let (rewound, reversed) = ActivityTracker::rewind_active(45, 0);
        assert_eq!(rewound, 0);
        assert_eq!(reversed, 45);
    }

    #[test]
    fn a_snapshot_ahead_of_the_clock_cannot_invent_time() {
        // Would go negative if subtracted naively; must clamp, not wrap.
        let (rewound, reversed) = ActivityTracker::rewind_active(100, 500);
        assert_eq!(rewound, 100, "must never rewind upward");
        assert_eq!(reversed, 0);
    }

    #[test]
    fn nothing_to_reverse_when_input_was_current() {
        let (rewound, reversed) = ActivityTracker::rewind_active(2400, 2400);
        assert_eq!(rewound, 2400);
        assert_eq!(reversed, 0);
    }

    #[test]
    fn zero_clock_stays_zero() {
        let (rewound, reversed) = ActivityTracker::rewind_active(0, 0);
        assert_eq!(rewound, 0);
        assert_eq!(reversed, 0);
    }
}
