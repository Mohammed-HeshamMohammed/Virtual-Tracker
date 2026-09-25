use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::agent::progress_store::{PersistedProgress, ProgressStore};
use crate::capture::activity::ActivityMeter;
use crate::capture::events::EventBuilder;
use crate::capture::window::get_foreground_window;
use crate::client::api::ApiClient;
use crate::config::Settings;
use crate::constants::{
    ACTIVITY_SCORING_REFRESH_INTERVAL_SEC, APP_LOG_INTERVAL_SEC, DISPLAY_NAME_REFRESH_INTERVAL_SEC,
    FIRST_SCREENSHOT_DELAY_SEC, IDLE_THRESHOLD_SEC, SESSION_POLL_SEC, SESSION_SYNC_INTERVAL_SEC,
};
use crate::queue::EventQueue;

pub type StatusCallback = Arc<dyn Fn(String) + Send + Sync>;

/// Consecutive failed session fetches before the UI is told the numbers are unconfirmed.
const DEGRADED_TICKS: u32 = 12;

/// How many ticks between session polls.
const SESSION_FETCH_EVERY_N_TICKS: u32 = 3;

/// How long the tracker waits for the shared client before giving up on this tick's poll.
const SESSION_FETCH_LOCK_WAIT: Duration = Duration::from_millis(750);

/// How often to retry the offline queue while ticking every SESSION_POLL_SEC — no point
/// hammering a dead connection every 5s.
const QUEUE_FLUSH_INTERVAL_SEC: u64 = 30;

pub struct ActivityTracker {
    api: Arc<Mutex<ApiClient>>,
    events: EventBuilder,
    activity: Arc<ActivityMeter>,
    queue: EventQueue,
    /// Crash-safe mirror of `task_progress`, written on every credited tick so an unclean
    /// exit doesn't lose whatever RAM alone was holding.
    progress: ProgressStore,
    on_status: Option<StatusCallback>,
    stop: Arc<AtomicBool>,
    /// Set by `pause()`/cleared by `resume()` or `note_stop_requested()`.
    paused: Arc<AtomicBool>,
    /// Set by `note_stop_requested()` (called from `AppController::stop_session`, which
    /// posts "stop" straight to the API without going through the tick loop).
    expect_stop: Arc<AtomicBool>,
    session_id: Arc<Mutex<Option<String>>>,
    /// Task currently being tracked plus the cumulative active/idle seconds worked on it so
    /// far (server baseline at session/task start + elapsed ticks since, split by whether
    task_progress: Arc<Mutex<(Option<String>, u64, u64)>>,
    /// Mirrors `TickState::last_project_id` (see that field's own comment) so
    /// `pause()`/`resume()` - called directly from the controller, outside the tick loop -
    last_project_id: Arc<Mutex<String>>,
    idle_stage: Arc<Mutex<u8>>,
    /// An idle-escalation "stop" that hasn't reached the server yet.
    pending_stop: Arc<Mutex<Option<PendingStop>>>,
    /// AC-1: throttle for the synthetic-input warning below - a jiggler runs continuously,
    /// so without this the same detection would log every SESSION_POLL_SEC forever instead
    last_synthetic_warning_at: Mutex<Option<Instant>>,
    idle_threshold_sec: AtomicU64,
}

/// Everything needed to retry a "stop" action that failed to reach the server, captured at
/// the moment idle escalation decided to stop the timer.
#[derive(Clone)]
struct PendingStop {
    task_id: String,
    project_id: String,
    active_seconds: u64,
    idle_seconds: u64,
}

/// Cumulative active seconds at the last moment there was real input, plus the escalation
/// stage already announced.
#[derive(Default)]
struct IdleWatch {
    stage: u8,
    active_at_last_input: u64,
}

struct TickState {
    last_app_log_at: Instant,
    next_screenshot_at: Instant,
    was_active: bool,
    current_session: String,
    next_flush_at: Instant,
    task_id: String,
    /// Last-seen project id for a task-less (calling project) session - not carried on the
    /// session JSON when it goes missing, so this is the only way a recovery resume (see
    last_project_id: String,
    active_baseline: u64,
    active_elapsed: u64,
    idle_baseline: u64,
    idle_elapsed: u64,
    /// This session's project's own idle settings, re-fetched on every task/project
    /// transition instead of a hardcoded/org-wide constant.
    idle_time_disabled: bool,
    idle_threshold_sec_for_project: u64,
    /// The two fields above were refreshed only when the *task* id changed, which a
    /// task-less (project) session can never trigger - its task id is always `""`, and
    idle_settings_stale: bool,
    next_sync_at: Instant,
    idle_watch: IdleWatch,
    last_tick_at: Instant,
    /// MAC-3/CQ-4: due immediately on the first tick, then re-fetched every
    /// DISPLAY_NAME_REFRESH_INTERVAL_SEC - see maybe_refresh_display_names.
    next_display_name_refresh_at: Instant,
    /// ACT-3: same immediate-then-periodic schedule, see maybe_refresh_activity_scoring.
    next_scoring_refresh_at: Instant,
    /// Ticks since the last session poll, see SESSION_FETCH_EVERY_N_TICKS.
    ticks_since_session_fetch: u32,
    failed_session_fetches: u32,
}

impl TickState {
    fn new() -> Self {
        let now = Instant::now();
        Self {
            last_app_log_at: now - Duration::from_secs(APP_LOG_INTERVAL_SEC),
            next_screenshot_at: now,
            was_active: false,
            current_session: String::new(),
            next_flush_at: now,
            task_id: String::new(),
            last_project_id: String::new(),
            active_baseline: 0,
            active_elapsed: 0,
            idle_baseline: 0,
            idle_elapsed: 0,
            idle_time_disabled: false,
            idle_threshold_sec_for_project: IDLE_THRESHOLD_SEC,
            idle_settings_stale: true,
            next_sync_at: now,
            idle_watch: IdleWatch::default(),
            last_tick_at: now,
            ticks_since_session_fetch: u32::MAX,
            failed_session_fetches: 0,
            next_display_name_refresh_at: now,
            next_scoring_refresh_at: now,
        }
    }
}

/// Idle time is entirely the project's call now: `idle_threshold_sec` (the per-project
/// allowance, or this org-wide fallback) is the only threshold - crossing it stops the
fn valid_idle_threshold(threshold_sec: u64) -> bool {
    threshold_sec > 0
}

mod progress;
mod tick;
mod upload;

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
            settings.classification_cache_path.clone(),
            settings.app_icon_script_path.clone(),
        );
        Self {
            api,
            events,
            activity,
            queue: EventQueue::new(settings.queue_path.clone()),
            progress: ProgressStore::new(settings.progress_path.clone()),
            on_status,
            stop: Arc::new(AtomicBool::new(false)),
            paused: Arc::new(AtomicBool::new(false)),
            expect_stop: Arc::new(AtomicBool::new(false)),
            session_id: Arc::new(Mutex::new(None)),
            task_progress: Arc::new(Mutex::new((None, 0, 0))),
            last_project_id: Arc::new(Mutex::new(String::new())),
            idle_stage: Arc::new(Mutex::new(0)),
            pending_stop: Arc::new(Mutex::new(None)),
            last_synthetic_warning_at: Mutex::new(None),
            idle_threshold_sec: AtomicU64::new(IDLE_THRESHOLD_SEC),
        }
    }

    /// ACT-3: applied from the periodic scoring-settings poll.
    fn apply_idle_thresholds(&self, threshold_sec: u64) {
        if valid_idle_threshold(threshold_sec) {
            self.idle_threshold_sec.store(threshold_sec, Ordering::Relaxed);
        }
    }

    pub fn idle_stage(&self) -> u8 {
        *self.idle_stage.lock()
    }

    /// Caller (`AgentController::start_tracker`) always stops any prior tracker and builds
    /// a fresh instance before calling this, so there's no existing loop to guard against
    pub fn gate(&self) -> &crate::capture::capture_gate::CaptureGate {
        &self.events.gate
    }

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
        // CQ-1: unregister the global input hooks now that ACT-1 uses real ones - a leaked
        // low-level hook is a system-wide problem, not just this process's, so this must
        self.activity.stop();
        *self.session_id.lock() = None;
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    /// Call right before/after telling the backend to stop the session outside the tick
    /// loop (e.g.
    pub fn note_stop_requested(&self) {
        self.expect_stop.store(true, Ordering::SeqCst);
        self.paused.store(false, Ordering::SeqCst);
    }

    /// The break button: marks the session idle server-side, preserving its accumulated
    /// active/idle totals (never resets to 0 the way clicking Stop then Start again used
    pub fn pause(&self) -> Result<(), String> {
        let (task_id, active_seconds, idle_seconds) = self.task_progress.lock().clone();
        let task_id = task_id.filter(|id| !id.is_empty());
        let project_id = task_id.is_none().then(|| self.last_project_id.lock().clone()).filter(|id| !id.is_empty());
        self.api.lock().post_session_action(
            "idle",
            task_id.as_deref(),
            project_id.as_deref(),
            active_seconds,
            idle_seconds,
            None,
            Some("member_pause"),
        )?;
        self.paused.store(true, Ordering::SeqCst);
        self.emit_status("Timer paused — on a break");
        Ok(())
    }

    pub fn resume(&self) -> Result<(), String> {
        let (task_id, active_seconds, idle_seconds) = self.task_progress.lock().clone();
        let task_id = task_id.filter(|id| !id.is_empty());
        // Same reasoning as pause() above.
        let project_id = task_id.is_none().then(|| self.last_project_id.lock().clone()).filter(|id| !id.is_empty());
        self.api.lock().post_session_action(
            "resume",
            task_id.as_deref(),
            project_id.as_deref(),
            active_seconds,
            idle_seconds,
            None,
            Some("member_resume"),
        )?;
        self.paused.store(false, Ordering::SeqCst);
        self.emit_status("Task session active");
        Ok(())
    }

    pub fn current_session_id(&self) -> Option<String> {
        self.session_id.lock().clone()
    }

    /// One delivery attempt for a pending idle-stop, if any.
    fn try_deliver_pending_stop(&self) -> bool {
        let Some(pending) = self.pending_stop.lock().clone() else {
            return true;
        };
        let delivered = self
            .api
            .lock()
            .post_session_action(
                "stop",
                Some(pending.task_id.as_str()).filter(|id| !id.is_empty()),
                Some(pending.project_id.as_str()).filter(|id| !id.is_empty()),
                pending.active_seconds,
                pending.idle_seconds,
                None,
                Some("idle_escalation"),
            )
            .is_ok();
        if delivered {
            *self.pending_stop.lock() = None;
            log::info!("Pending idle-stop delivered");
        } else {
            log::warn!("Idle-stop still undelivered, retrying next tick");
        }
        delivered
    }

    /// Must be called (and must succeed) before a NEW session is allowed to start.
    pub fn flush_pending_stop(&self) -> bool {
        self.try_deliver_pending_stop()
    }

    /// Task being tracked plus the real cumulative active/idle seconds worked on it so far
    /// (baseline pulled from the server at session start + elapsed ticks).
    pub fn current_task_progress(&self) -> (Option<String>, u64, u64) {
        self.task_progress.lock().clone()
    }

    fn emit_status(&self, text: &str) {
        if let Some(cb) = &self.on_status {
            cb(text.to_string());
        }
    }

    fn loop_run(&self) {
        let mut state = TickState::new();

        while !self.stop.load(Ordering::SeqCst) {
            if let Err(err) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                self.tick(&mut state);
            })) {
                log::warn!("Tracker tick failed: {err:?}");
            }
            thread::sleep(Duration::from_secs(SESSION_POLL_SEC));
        }
    }

    /// Try to resend anything queued from a prior outage.
    fn maybe_flush_queue(&self, next_flush_at: &mut Instant) {
        if Instant::now() < *next_flush_at {
            return;
        }
        *next_flush_at = Instant::now() + Duration::from_secs(QUEUE_FLUSH_INTERVAL_SEC);
        self.queue
            .flush(|session_id, events| self.api.lock().post_events(session_id, events));

        // Reported after the flush so the connection is as good as it will get.
        // take_dropped clears the count, and a failed report puts it back rather
        // than losing the fact that work was discarded.
        let dropped = self.queue.take_dropped();
        if dropped > 0 && self.api.lock().report_dropped_batches(dropped).is_err() {
            self.queue.restore_dropped(dropped);
        }
    }

    /// MAC-3/CQ-4: pulls the latest server-delivered app display-name map (CLS-1) into the
    /// event builder's cache.
    fn maybe_refresh_display_names(&self, next_refresh_at: &mut Instant) {
        if Instant::now() < *next_refresh_at {
            return;
        }
        *next_refresh_at = Instant::now() + Duration::from_secs(DISPLAY_NAME_REFRESH_INTERVAL_SEC);
        if let Ok(entries) = self.api.lock().fetch_app_display_names() {
            self.events.apply_display_names(entries);
        }
        // Same schedule, same best-effort contract: a failed fetch keeps the exclusions
        // already in force rather than clearing them, so a network blip can never start
        self.refresh_capture_exclusions_now();
    }

    /// Also called the moment a member edits their own list. The schedule above is
    /// thirty minutes, which is far too long for a privacy control: someone who adds
    /// their bank would stay captured until it next ran.
    pub fn refresh_capture_exclusions_now(&self) {
        if let Ok(patterns) = self.api.lock().fetch_capture_exclusions() {
            self.events.apply_capture_exclusions(patterns);
        }
    }

    /// ACT-3: pulls server-tunable scoring calibration into the running ActivityMeter.
    fn maybe_refresh_activity_scoring(&self, next_refresh_at: &mut Instant) {
        if Instant::now() < *next_refresh_at {
            return;
        }
        *next_refresh_at = Instant::now() + Duration::from_secs(ACTIVITY_SCORING_REFRESH_INTERVAL_SEC);
        if let Ok(settings) = self.api.lock().fetch_activity_scoring_settings() {
            self.activity
                .apply_scoring_settings(settings.saturation_events, settings.window_ms);
            self.events
                .apply_screenshot_cadence(settings.screenshot_min_delay_sec, settings.screenshot_max_delay_sec);
            self.events.apply_capture_policy(
                settings.blur_default,
                settings.outside_work_hours,
                settings.break_until_ms,
            );
            // Ask again when the work-window answer is due to change rather than
            // half an hour later, or a shift ending at 18:00 keeps capturing until
            // the next scheduled poll. A couple of seconds of slack so the server
            // has certainly crossed the boundary by the time we ask.
            if let Some(seconds) = settings.recheck_in_sec {
                let wait = seconds.saturating_add(2).clamp(15, ACTIVITY_SCORING_REFRESH_INTERVAL_SEC);
                *next_refresh_at = Instant::now() + Duration::from_secs(wait);
            }
            self.apply_idle_thresholds(settings.idle_threshold_sec);
        }
    }

















}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
