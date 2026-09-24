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
            self.apply_idle_thresholds(settings.idle_threshold_sec);
        }
    }

    /// The part of a tick that needs no network and no shared lock - crediting elapsed time
    /// and checking idle escalation.
    fn tick_local_progress(&self, state: &mut TickState) {
        if !state.was_active || state.current_session.is_empty() {
            // Not tracking - or paused by the server (C1).
            state.last_tick_at = Instant::now();
            return;
        }
        let idle_now = self.tick_progress(
            &state.task_id,
            &mut state.last_tick_at,
            &state.active_baseline,
            &mut state.active_elapsed,
            &state.idle_baseline,
            &mut state.idle_elapsed,
            state.idle_time_disabled,
            state.idle_threshold_sec_for_project,
        );
        let _ = idle_now;

        // Idle escalation must not wait on a poll either: it is the thing that stops a
        // session nobody is at, and delaying it would credit active time to an empty chair.
        let stopped = self.tick_idle_escalation(
            &mut state.idle_watch,
            &state.task_id,
            &state.last_project_id,
            &state.active_baseline,
            &state.active_elapsed,
            &state.idle_baseline,
            &state.idle_elapsed,
            state.idle_time_disabled,
            state.idle_threshold_sec_for_project,
        );
        if stopped {
            // Exactly what the polling path does on an idle stop (see the sibling call in
            // `tick`) - the session is over the same way whichever tick happened to notice.
            state.was_active = false;
            state.current_session = String::new();
            *self.session_id.lock() = None;
            self.reset_task_progress(
                &mut state.task_id,
                &mut state.last_tick_at,
                &mut state.active_baseline,
                &mut state.active_elapsed,
                &mut state.idle_baseline,
                &mut state.idle_elapsed,
                &mut state.idle_time_disabled,
                &mut state.idle_threshold_sec_for_project,
            );
        }
    }

    fn tick(&self, state: &mut TickState) {
        // Cheap no-op unless the hooks have gone quiet while the OS is still seeing input.
        self.activity.restart_hooks_if_dead();

        self.maybe_flush_queue(&mut state.next_flush_at);
        self.maybe_refresh_display_names(&mut state.next_display_name_refresh_at);
        self.maybe_refresh_activity_scoring(&mut state.next_scoring_refresh_at);

        // Retry an idle-stop that hasn't landed yet, and do nothing else this tick.
        if self.pending_stop.lock().is_some() {
            self.try_deliver_pending_stop();
            return;
        }

        // Break in progress: skip fetch_session/status handling entirely so the server's
        // "idle" status (set by `pause()`) never gets read back as "session over" and reset
        if self.paused.load(Ordering::SeqCst) {
            self.tick_paused(state);
            return;
        }

        // Bound to a `let` on purpose, same reasoning as
        // `AgentController::sign_in_with_password`'s `session_bootstrap` call: a temporary
        state.ticks_since_session_fetch = state.ticks_since_session_fetch.saturating_add(1);
        if state.ticks_since_session_fetch < SESSION_FETCH_EVERY_N_TICKS {
            self.tick_local_progress(state);
            return;
        }
        let Some(client) = self.api.try_lock_for(SESSION_FETCH_LOCK_WAIT) else {
            log::debug!("session poll skipped: the API client is busy serving the UI");
            self.tick_local_progress(state);
            return;
        };
        state.ticks_since_session_fetch = 0;
        let fetched = { client }.fetch_session();
        let session = match fetched {
            Ok(session) => {
                if state.failed_session_fetches >= DEGRADED_TICKS {
                    self.emit_status("Reconnected — your time is confirmed");
                }
                state.failed_session_fetches = 0;
                session
            }
            Err(_) => {
                state.failed_session_fetches = state.failed_session_fetches.saturating_add(1);
                // Past a minute of silence, say so.
                if state.failed_session_fetches == DEGRADED_TICKS {
                    self.emit_status("Offline — still counting, not yet synced");
                }
                // Backend unreachable.
                if state.was_active && !state.current_session.is_empty() {
                    let window = get_foreground_window();
                    let session_id = state.current_session.clone();
                    let now = Instant::now();
                    let idle_now = self.tick_progress(
                        &state.task_id,
                        &mut state.last_tick_at,
                        &state.active_baseline,
                        &mut state.active_elapsed,
                        &state.idle_baseline,
                        &mut state.idle_elapsed,
                        state.idle_time_disabled,
                        state.idle_threshold_sec_for_project,
                    );
                    // No screenshots while idle - see tick_progress's doc comment.
                    if !idle_now && now >= state.next_screenshot_at {
                        self.upload_screenshot(&session_id, &window);
                        state.next_screenshot_at =
                            now + Duration::from_secs(self.events.random_screenshot_delay_sec());
                    }
                    if now.duration_since(state.last_app_log_at).as_secs() >= APP_LOG_INTERVAL_SEC {
                        self.upload_app_slice(&session_id, &window);
                        state.last_app_log_at = now;
                    }
                }
                return;
            }
        };
        let Some(session) = session else {
            let stop_was_requested = self.expect_stop.swap(false, Ordering::SeqCst);
            if !stop_was_requested && self.try_recover_lost_session(state) {
                self.emit_status("Task session active");
                return;
            }
            if state.was_active {
                self.emit_status("Signed in — waiting for timer");
            }
            self.reset_task_progress(
                &mut state.task_id,
                &mut state.last_tick_at,
                &mut state.active_baseline,
                &mut state.active_elapsed,
                &mut state.idle_baseline,
                &mut state.idle_elapsed,
                &mut state.idle_time_disabled,
                &mut state.idle_threshold_sec_for_project,
            );
            state.was_active = false;
            state.current_session = String::new();
            *self.session_id.lock() = None;
            return;
        };

        let status = session
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if status != "active" {
            if status == "idle" && !state.current_session.is_empty() {
                if state.was_active {
                    self.emit_status("Timer idle — capture paused");
                }
                state.was_active = false;
                // Nothing is credited while paused.
                state.last_tick_at = Instant::now();
                return;
            }
            if status == "idle" {
                self.emit_status("Timer idle — capture paused");
            } else if state.was_active {
                self.emit_status("Signed in — waiting for timer");
            }
            self.reset_task_progress(
                &mut state.task_id,
                &mut state.last_tick_at,
                &mut state.active_baseline,
                &mut state.active_elapsed,
                &mut state.idle_baseline,
                &mut state.idle_elapsed,
                &mut state.idle_time_disabled,
                &mut state.idle_threshold_sec_for_project,
            );
            state.was_active = false;
            state.current_session = String::new();
            *self.session_id.lock() = None;
            return;
        }

        let session_id = match session.get("id").and_then(|v| v.as_str()) {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => return,
        };

        let window = get_foreground_window();

        if state.current_session.as_str() != session_id {
            state.current_session = session_id.clone();
            // A different session can carry different project settings even when the task
            // id is unchanged (and is always unchanged for task-less sessions, where it is
            state.idle_settings_stale = true;
            *self.session_id.lock() = Some(session_id.clone());
            state.last_app_log_at = Instant::now() - Duration::from_secs(APP_LOG_INTERVAL_SEC);
            state.next_screenshot_at = Instant::now() + Duration::from_secs(FIRST_SCREENSHOT_DELAY_SEC);
            log::info!("Tracking session {session_id}");
            self.upload_app_slice(&session_id, &window);
            state.last_app_log_at = Instant::now();
        }

        // Task can change under a session that's already open (resume onto a different
        // task) - re-baseline from the server's known totals for it whenever the tracked
        let session_task_id = session
            .get("taskId")
            .or_else(|| session.get("task_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let task_changed = state.task_id.as_str() != session_task_id;
        // Settings follow *either* identity.
        if task_changed || state.idle_settings_stale {
            let tracking = if session_task_id.is_empty() {
                None
            } else {
                self.api.lock().fetch_task_time_tracking(&session_task_id).ok()
            };
            // Task-less (calling project) sessions have no per-task totals to re-baseline
            // from, so the session's own accumulated seconds are the cumulative figure -
            let session_seconds = |key: &str| {
                session.get(key).and_then(|v| v.as_u64()).unwrap_or(0)
            };
            if task_changed {
                state.task_id = session_task_id.clone();
                state.active_elapsed = 0;
                state.idle_elapsed = 0;
                state.active_baseline = tracking
                    .as_ref()
                    .map(|t| t.active_seconds)
                    .unwrap_or_else(|| session_seconds("activeSeconds"));
                state.idle_baseline = tracking
                    .as_ref()
                    .map(|t| t.idle_seconds)
                    .unwrap_or_else(|| session_seconds("idleSeconds"));
            }

            // Task-anchored sessions get this from the same fetch_task_time_tracking call
            // above (task-time-tracking.js attaches the owning project's settings to every
            state.idle_time_disabled = tracking
                .as_ref()
                .map(|t| t.disable_idle_time)
                .unwrap_or_else(|| {
                    session.get("disableIdleTime").and_then(|v| v.as_bool()).unwrap_or(false)
                });
            let reported_threshold = tracking
                .as_ref()
                .map(|t| t.idle_time_seconds)
                .unwrap_or_else(|| {
                    session
                        .get("idleTimeSeconds")
                        .and_then(|v| v.as_u64())
                        .unwrap_or_else(|| self.idle_threshold_sec.load(Ordering::Relaxed))
                });
            // The org-wide poll has always been validated (apply_idle_thresholds), but the
            // per-project value went straight in unchecked - and nothing upstream
            state.idle_threshold_sec_for_project = if valid_idle_threshold(reported_threshold) {
                reported_threshold
            } else {
                let fallback = self.idle_threshold_sec.load(Ordering::Relaxed);
                log::warn!(
                    "Project reported an unusable idle allowance ({reported_threshold}s) - falling back to the org-wide {fallback}s"
                );
                fallback
            };
            state.idle_settings_stale = false;

            // an unclean exit (crash/kill/reboot) between two `sync` calls loses
            // whatever PS-1's on-disk mirror hadn't reached the server yet - reconcile
            // against it here, same GREATEST-style rule TC-4 already applies
            // server-side for `sync`, so a restart never displays less than what was
            // last actually shown. Scoped to the exact same session+task on purpose: a
            // leftover file from an already-closed session must never bleed into a new
            // one.
            let persisted_task_id = if session_task_id.is_empty() {
                None
            } else {
                Some(session_task_id.clone())
            };
            if let Some(persisted) = self.progress.load() {
                if persisted.session_id == session_id && persisted.task_id == persisted_task_id {
                    state.active_baseline = state.active_baseline.max(persisted.active_seconds);
                    state.idle_baseline = state.idle_baseline.max(persisted.idle_seconds);
                }
            }

            state.next_sync_at = Instant::now();
        }

        if !state.was_active {
            // Coming back from a pause (C1), or starting: count from now.
            state.last_tick_at = Instant::now();
        }
        state.was_active = true;

        let now = Instant::now();
        let idle_now = self.tick_progress(
            &state.task_id,
            &mut state.last_tick_at,
            &state.active_baseline,
            &mut state.active_elapsed,
            &state.idle_baseline,
            &mut state.idle_elapsed,
            state.idle_time_disabled,
            state.idle_threshold_sec_for_project,
        );
        self.maybe_flag_synthetic_input();

        // Calling-project sessions have no task, so they sync on project id instead -
        // gating purely on task id would leave their time unrecorded.
        let session_project_id = session
            .get("projectId")
            .or_else(|| session.get("project_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !session_project_id.is_empty() {
            state.last_project_id = session_project_id.clone();
            *self.last_project_id.lock() = session_project_id.clone();
        }

        if self.tick_idle_escalation(
            &mut state.idle_watch,
            &state.task_id,
            &session_project_id,
            &state.active_baseline,
            &state.active_elapsed,
            &state.idle_baseline,
            &state.idle_elapsed,
            state.idle_time_disabled,
            state.idle_threshold_sec_for_project,
        ) {
            // Timer was stopped for idling; this session is over.
            state.was_active = false;
            state.current_session = String::new();
            *self.session_id.lock() = None;
            self.reset_task_progress(
                &mut state.task_id,
                &mut state.last_tick_at,
                &mut state.active_baseline,
                &mut state.active_elapsed,
                &mut state.idle_baseline,
                &mut state.idle_elapsed,
                &mut state.idle_time_disabled,
                &mut state.idle_threshold_sec_for_project,
            );
            return;
        }

        // No screenshots while idle - see tick_progress's doc comment.
        let capture_excluded = self.events.is_capture_excluded(&window);

        // That elapsed while nobody was there to be captured.
        if !idle_now && !capture_excluded && now >= state.next_screenshot_at {
            self.upload_screenshot(&session_id, &window);
            state.next_screenshot_at =
                now + Duration::from_secs(self.events.random_screenshot_delay_sec());
        }

        if !capture_excluded && now.duration_since(state.last_app_log_at).as_secs() >= APP_LOG_INTERVAL_SEC {
            self.upload_app_slice(&session_id, &window);
            state.last_app_log_at = now;
        }

        if (!state.task_id.is_empty() || !session_project_id.is_empty()) && now >= state.next_sync_at {
            let active_total = state.active_baseline + state.active_elapsed;
            let idle_total = state.idle_baseline + state.idle_elapsed;
            let sync_result = self.api.lock().post_session_action(
                "sync",
                Some(state.task_id.as_str()).filter(|id| !id.is_empty()),
                Some(session_project_id.as_str()).filter(|id| !id.is_empty()),
                active_total,
                idle_total,
                None,
                None,
            );
            state.next_sync_at = now + Duration::from_secs(SESSION_SYNC_INTERVAL_SEC);

            // The server already truncated active_seconds against the task's daily cap
            // (timerCapped) or stopped counting because the project's own budget stop-timer
            let cap = match &sync_result {
                Ok(info) if info.timer_capped => {
                    Some(("Timer stopped — task's daily hour limit reached", "timer_cap"))
                }
                Ok(info) if info.budget_capped => {
                    Some(("Timer stopped — project's budget limit reached", "budget_cap"))
                }
                _ => None,
            };
            if let Some((message, reason)) = cap {
                log::info!("{message} - stopping timer");
                let _ = self.api.lock().post_session_action(
                    "stop",
                    Some(state.task_id.as_str()).filter(|id| !id.is_empty()),
                    Some(session_project_id.as_str()).filter(|id| !id.is_empty()),
                    active_total,
                    idle_total,
                    None,
                    Some(reason),
                );
                state.was_active = false;
                state.current_session = String::new();
                *self.session_id.lock() = None;
                self.reset_task_progress(
                    &mut state.task_id,
                    &mut state.last_tick_at,
                    &mut state.active_baseline,
                    &mut state.active_elapsed,
                    &mut state.idle_baseline,
                    &mut state.idle_elapsed,
                    &mut state.idle_time_disabled,
                    &mut state.idle_threshold_sec_for_project,
                );
                self.emit_status(message);
            }
        }
    }

    /// AC-1: "a session that's 100% active but ~100% injected is a near-certain fake" -
    /// falls out of ACT-1's real hooks almost for free.
    fn maybe_flag_synthetic_input(&self) {
        const HIGH_ACTIVITY_SCORE: u32 = 80;
        const HIGH_INJECTED_FRACTION: f64 = 0.85;
        const RENOTIFY_AFTER: Duration = Duration::from_secs(10 * 60);

        let score = self.activity.score();
        if score < HIGH_ACTIVITY_SCORE {
            return;
        }
        let Some(fraction) = self.activity.injected_fraction() else {
            return;
        };
        if fraction < HIGH_INJECTED_FRACTION {
            return;
        }

        let mut last_warning = self.last_synthetic_warning_at.lock();
        let now = Instant::now();
        if last_warning.is_some_and(|at| now.duration_since(at) < RENOTIFY_AFTER) {
            return;
        }
        *last_warning = Some(now);
        log::warn!(
            "Possible synthetic input: activity score {score}% with {:.0}% of input OS-flagged as injected",
            fraction * 100.0
        );
    }

    /// Idle enforcement.
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
        idle_time_disabled: bool,
        idle_threshold_sec: u64,
    ) -> bool {
        // Idle time disabled for this project means no warn/alert/ auto-stop/rewind either
        // - the switch does what it says end to end, not just for the active/idle split in
        if idle_time_disabled {
            return false;
        }
        // Idle escalation is Windows-only until real input-hook listeners exist for other
        // platforms (see ActivityMeter::run_listeners / HOOKS_SUPPORTED).
        if !ActivityMeter::HOOKS_SUPPORTED {
            return false;
        }
        let idle_for = self.activity.idle_seconds();
        let active_total = active_baseline.saturating_add(*active_elapsed);

        // Real input: remember this as the last honest point the clock can be rewound to.
        if idle_for < idle_threshold_sec {
            if watch.stage != 0 {
                watch.stage = 0;
                *self.idle_stage.lock() = 0;
                self.emit_status("Task session active");
            }
            watch.active_at_last_input = active_total;
            return false;
        }

        // Past the project's own allowance: stop immediately and rewind.
        let (rewound, reversed) = Self::rewind_active(active_total, watch.active_at_last_input);
        let idle_total = idle_baseline.saturating_add(*idle_elapsed).saturating_add(reversed);

        log::info!(
            "Idle {}s past the project's {}s allowance - stopping timer, reversing {}s of active time (from {}s to {}s) into idle",
            idle_for,
            idle_threshold_sec,
            reversed,
            active_total,
            rewound
        );

        self.set_task_progress(task_id, rewound, idle_total);
        let delivered = self
            .api
            .lock()
            .post_session_action(
                "stop",
                Some(task_id).filter(|id| !id.is_empty()),
                Some(project_id).filter(|id| !id.is_empty()),
                rewound,
                idle_total,
                None,
                Some("idle_escalation"),
            )
            .is_ok();
        if !delivered {
            // The network problem that often accompanies an idle stretch must not mean the
            // stop is silently lost.
            *self.pending_stop.lock() = Some(PendingStop {
                task_id: task_id.to_string(),
                project_id: project_id.to_string(),
                active_seconds: rewound,
                idle_seconds: idle_total,
            });
            log::warn!("Idle-stop POST failed - will retry until delivered, tracking stays halted meanwhile");
        }

        watch.stage = 3;
        *self.idle_stage.lock() = 3;
        watch.active_at_last_input = 0;
        self.emit_status("Timer stopped — idle too long, idle time removed");
        true
    }

    /// Seconds to credit for one tick: real elapsed wall time since the last credited
    /// tick, not an assumed SESSION_POLL_SEC.
    ///
    /// Clamped to `SESSION_POLL_SEC * 4` on purpose: a sleep/hibernate gap makes the
    /// real elapsed time huge, and that must never be banked as active work. A resumed
    /// laptop credits at most this, then idle escalation takes over and rewinds to the
    /// last real input - which is the correct outcome for a suspend, not a fabricated
    /// block of "active" time in a single tick.
    fn credited_seconds(elapsed: Duration) -> u64 {
        elapsed.as_secs().min(SESSION_POLL_SEC * 4)
    }

    /// The part of `elapsed` that was credited, so the caller can roll the remainder into
    /// the next tick instead of dropping it.
    fn consumed_span(elapsed: Duration, credited: u64) -> Duration {
        let cap = Duration::from_secs(SESSION_POLL_SEC * 4);
        if elapsed > cap {
            return elapsed;
        }
        Duration::from_secs(credited)
    }

    /// Counts the credited seconds as idle rather than active if there's been no
    /// mouse/keyboard input for IDLE_THRESHOLD_SEC - an open session sitting untouched
    #[allow(clippy::too_many_arguments)]
    /// Returns whether this tick's delta was credited to idle rather than active - callers
    /// use it to skip screenshot/app-slice capture while the user is idle (a screenshot of
    fn tick_progress(
        &self,
        task_id: &str,
        last_tick_at: &mut Instant,
        active_baseline: &u64,
        active_elapsed: &mut u64,
        idle_baseline: &u64,
        idle_elapsed: &mut u64,
        idle_time_disabled: bool,
        idle_threshold_sec: u64,
    ) -> bool {
        let now = Instant::now();
        let elapsed = now.duration_since(*last_tick_at);
        let delta = Self::credited_seconds(elapsed);
        // Not `now`: the sub-second remainder stays owed and is credited by the next tick
        // that pushes the total past a whole second.
        *last_tick_at = now - (elapsed - Self::consumed_span(elapsed, delta));

        // A project with idle time disabled never splits into idle at all - everything is
        // credited active.
        let credited_idle = if idle_time_disabled {
            *active_elapsed += delta;
            false
        } else if ActivityMeter::HOOKS_SUPPORTED && self.activity.idle_seconds() >= idle_threshold_sec {
            *idle_elapsed += delta;
            true
        } else {
            *active_elapsed += delta;
            false
        };
        self.set_task_progress(
            task_id,
            *active_baseline + *active_elapsed,
            *idle_baseline + *idle_elapsed,
        );
        credited_idle
    }

    fn set_task_progress(&self, task_id: &str, active_seconds: u64, idle_seconds: u64) {
        let id = if task_id.is_empty() {
            None
        } else {
            Some(task_id.to_string())
        };
        *self.task_progress.lock() = (id.clone(), active_seconds, idle_seconds);

        // Same values, same call site, so the on-disk mirror can never drift from what's in
        // RAM.
        if let Some(session_id) = self.session_id.lock().clone() {
            self.progress.save(&PersistedProgress {
                session_id,
                task_id: id,
                active_seconds,
                idle_seconds,
            });
        }
    }

    /// While paused, credits the whole wall-clock delta to idle (a break is not activity)
    /// and periodically re-syncs so the paused session's `updated_at` stays fresh enough to
    fn tick_paused(&self, state: &mut TickState) {
        let now = Instant::now();
        // Same carry as tick_progress - a break's seconds are counted the same way worked
        // ones are, so the remainder is owed here too rather than thrown away on every tick
        let elapsed = now.duration_since(state.last_tick_at);
        let delta = Self::credited_seconds(elapsed);
        state.last_tick_at = now - (elapsed - Self::consumed_span(elapsed, delta));
        if !state.idle_time_disabled {
            state.idle_elapsed += delta;
        }
        self.set_task_progress(
            &state.task_id,
            state.active_baseline + state.active_elapsed,
            state.idle_baseline + state.idle_elapsed,
        );
        if now >= state.next_sync_at {
            let task_id = (!state.task_id.is_empty()).then(|| state.task_id.as_str());
            let project_id = (!state.last_project_id.is_empty()).then(|| state.last_project_id.as_str());
            let _ = self.api.lock().post_session_action(
                "sync",
                task_id,
                project_id,
                state.active_baseline + state.active_elapsed,
                state.idle_baseline + state.idle_elapsed,
                None,
                None,
            );
            state.next_sync_at = now + Duration::from_secs(SESSION_SYNC_INTERVAL_SEC);
        }
    }

    /// Attempts to resume a session the server closed as abandoned, carrying the local
    /// unsynced total (baseline + elapsed) forward as the new session's starting point
    fn try_recover_lost_session(&self, state: &mut TickState) -> bool {
        if !state.was_active || state.current_session.is_empty() {
            return false;
        }
        let has_task = !state.task_id.is_empty();
        let has_project = !state.last_project_id.is_empty();
        if !has_task && !has_project {
            return false;
        }
        let active_total = state.active_baseline + state.active_elapsed;
        let idle_total = state.idle_baseline + state.idle_elapsed;
        if active_total == 0 && idle_total == 0 {
            return false;
        }
        let task_id = has_task.then(|| state.task_id.as_str());
        let project_id = has_project.then(|| state.last_project_id.as_str());
        match self
            .api
            .lock()
            .post_session_action("start", task_id, project_id, active_total, idle_total, None, Some("recovered_after_reap"))
        {
            Ok(info) => {
                log::warn!(
                    "Recovered a session the server closed as abandoned - resumed with {active_total}s active / {idle_total}s idle carried forward"
                );
                state.current_session = info.id.unwrap_or_default();
                // This adopts a brand-new session id without going through the tick's own
                // session-change branch, so nothing else would mark the project's idle
                state.idle_settings_stale = true;
                *self.session_id.lock() = Some(state.current_session.clone());
                state.active_baseline = active_total;
                state.active_elapsed = 0;
                state.idle_baseline = idle_total;
                state.idle_elapsed = 0;
                state.last_tick_at = Instant::now();
                state.next_sync_at = Instant::now() + Duration::from_secs(SESSION_SYNC_INTERVAL_SEC);
                true
            }
            Err(err) => {
                log::warn!("Could not recover abandoned session (will retry next tick): {err}");
                false
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn reset_task_progress(
        &self,
        task_id: &mut String,
        last_tick_at: &mut Instant,
        active_baseline: &mut u64,
        active_elapsed: &mut u64,
        idle_baseline: &mut u64,
        idle_elapsed: &mut u64,
        idle_time_disabled: &mut bool,
        idle_threshold_sec: &mut u64,
    ) {
        task_id.clear();
        *active_baseline = 0;
        *active_elapsed = 0;
        *idle_baseline = 0;
        *idle_elapsed = 0;
        // No session means no project to have fetched a threshold from - back to the
        // bootstrap default so a stale disabled-project's setting can never bleed into
        *idle_time_disabled = false;
        *idle_threshold_sec = IDLE_THRESHOLD_SEC;
        // A resumed session must not credit the gap since tracking stopped - without this,
        // signing back in after a long break would credit that entire gap (clamped to
        *last_tick_at = Instant::now();
        *self.task_progress.lock() = (None, 0, 0);
        *self.idle_stage.lock() = 0;
        self.progress.clear();
    }

    /// The rewind arithmetic on its own, so it can be tested without a live session.
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
        // A window we could not identify is a gap in what the agent can see, not an app
        // called "Unknown".
        if !window.is_identified() {
            log::debug!("skipping app slice: foreground window could not be identified");
            return;
        }

        if window.is_shell_surface() {
            log::debug!(
                "skipping app slice: {} is a shell surface, not an app",
                window.process_name
            );
            return;
        }

        let app_event = self.events.app_slice(window);
        let app_ok = self.api.lock().post_events(session_id, std::slice::from_ref(&app_event));
        if !app_ok {
            self.queue.enqueue(session_id, &[app_event]);
        }

        // Was true unconditionally whenever no URL was captured at all (not a browser, or
        // the capture script came back empty) — every non-browser app log line was claiming
        let mut url_sent = 0usize;
        let url_events = self.events.url_slices(window);
        if !url_events.is_empty() {
            let url_ok = self.api.lock().post_events(session_id, &url_events);
            if url_ok {
                url_sent = url_events.len();
            } else {
                self.queue.enqueue(session_id, &url_events);
            }
        }

        if app_ok {
            self.activity.reset();
            log::info!(
                "Logged app slice: {}{}",
                window.app_name,
                match url_sent {
                    0 => String::new(),
                    1 => " + URL".to_string(),
                    n => format!(" + {n} URLs"),
                }
            );
        } else {
            log::warn!("App/URL upload failed for session {session_id}, queued for retry");
        }
    }
}

#[cfg(test)]
#[path = "tracker_tests.rs"]
mod tests;
