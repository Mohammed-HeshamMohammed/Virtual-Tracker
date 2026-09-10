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

/// How often to retry the offline queue while ticking every SESSION_POLL_SEC —
/// no point hammering a dead connection every 5s.
const QUEUE_FLUSH_INTERVAL_SEC: u64 = 30;

pub struct ActivityTracker {
    api: Arc<Mutex<ApiClient>>,
    events: EventBuilder,
    activity: Arc<ActivityMeter>,
    queue: EventQueue,
    /// PS-1: crash-safe mirror of `task_progress`, written on every credited
    /// tick so an unclean exit doesn't lose whatever RAM alone was holding.
    progress: ProgressStore,
    on_status: Option<StatusCallback>,
    stop: Arc<AtomicBool>,
    /// Set by `pause()`/cleared by `resume()`. While true, `tick()` skips its
    /// normal fetch_session/status handling entirely (see `tick_paused`) -
    /// crediting only idle time and periodically re-syncing to keep the
    /// paused session from being swept up as abandoned.
    paused: Arc<AtomicBool>,
    /// Set by `note_stop_requested()` (called from `AppController::stop_session`,
    /// which posts "stop" straight to the API without going through the tick
    /// loop). Consumed once by the next `session is None` tick so a
    /// user-initiated stop is never mistaken for the server abandoning the
    /// session out from under the agent - see `try_recover_lost_session`.
    expect_stop: Arc<AtomicBool>,
    session_id: Arc<Mutex<Option<String>>>,
    /// Task currently being tracked plus the cumulative active/idle seconds
    /// worked on it so far (server baseline at session/task start + elapsed
    /// ticks since, split by whether there was recent mouse/keyboard input).
    /// Read by the controller on stop/quit so the final flush carries the real
    /// numbers instead of hardcoded 0s.
    task_progress: Arc<Mutex<(Option<String>, u64, u64)>>,
    /// Current idle escalation stage, readable by the UI.
    /// 0 = working, 3 = stopped for idling (1/2 no longer used - idle time is
    /// decided solely by the project's own allowance now, no separate
    /// warn/alert stages ahead of it).
    idle_stage: Arc<Mutex<u8>>,
    /// TC-6: an idle-escalation "stop" that hasn't reached the server yet.
    /// While this is `Some`, `tick()` does nothing but retry it - it must not
    /// fetch_session or otherwise touch session state, because that is
    /// exactly what let tracking silently resume (with the idle rewind never
    /// applied) whenever the original stop POST failed.
    pending_stop: Arc<Mutex<Option<PendingStop>>>,
    /// AC-1: throttle for the synthetic-input warning below - a jiggler runs
    /// continuously, so without this the same detection would log every
    /// SESSION_POLL_SEC forever instead of once per episode.
    last_synthetic_warning_at: Mutex<Option<Instant>>,
    /// ACT-3: server-tunable idle threshold (org-wide fallback, used only
    /// when a project doesn't set its own), defaulted to the compile-time
    /// constant and overwritten by `apply_idle_thresholds` on the periodic
    /// scoring-settings poll.
    idle_threshold_sec: AtomicU64,
}

/// Everything needed to retry a "stop" action that failed to reach the
/// server, captured at the moment idle escalation decided to stop the timer.
#[derive(Clone)]
struct PendingStop {
    task_id: String,
    project_id: String,
    active_seconds: u64,
    idle_seconds: u64,
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

/// Suggestion #11: everything `loop_run` used to hand-maintain as ~10 separate
/// locals and thread through `tick()` as 15 `&mut` parameters, bundled into
/// one struct. Purely a carrier for state between ticks - every field here is
/// the exact same variable that existed before, with the exact same meaning
/// and the exact same read/write sites inside `tick()` (see that function's
/// own comments for what each one does); only *how* it's passed around
/// changed. This is what makes a future capture type additive (one new field)
/// instead of another signature change across every call site.
struct TickState {
    last_app_log_at: Instant,
    next_screenshot_at: Instant,
    was_active: bool,
    current_session: String,
    next_flush_at: Instant,
    task_id: String,
    /// Last-seen project id for a task-less (calling project) session - not
    /// carried on the session JSON when it goes missing, so this is the only
    /// way a recovery resume (see try_recover_lost_session) knows what to
    /// resume against.
    last_project_id: String,
    active_baseline: u64,
    active_elapsed: u64,
    idle_baseline: u64,
    idle_elapsed: u64,
    /// ID-3: this session's project's own idle settings, re-fetched on every
    /// task/project transition instead of a hardcoded/org-wide constant.
    /// `true` means no active/idle split and no idle escalation at all for
    /// this project.
    idle_time_disabled: bool,
    idle_threshold_sec_for_project: u64,
    /// ID-4: the two fields above were refreshed only when the *task* id
    /// changed, which a task-less (project) session can never trigger - its
    /// task id is always `""`, and `reset_task_progress` leaves `task_id` at
    /// `""` too, so `"" != ""` is false and the read was skipped entirely.
    /// Those sessions therefore ran on `IDLE_THRESHOLD_SEC` (60s) instead of
    /// the project's own allowance, and ignored `disableIdleTime` outright -
    /// and since crossing the threshold stops and rewinds immediately (there
    /// are no warn stages), that meant stopping after a minute away from the
    /// keyboard and reversing the time since the last input. Set whenever the
    /// session identity changes under us, so the refresh is keyed on session
    /// as well as task.
    idle_settings_stale: bool,
    next_sync_at: Instant,
    idle_watch: IdleWatch,
    /// Real wall-clock time of the last credited tick (TC-2). Ticks are
    /// credited by measuring the gap to this, not by assuming the loop's
    /// sleep duration elapsed exactly - a tick that took longer (network I/O:
    /// fetch_session/post_events/post_session_action all run inline) used to
    /// silently under-credit the session.
    last_tick_at: Instant,
    /// MAC-3/CQ-4: due immediately on the first tick, then re-fetched every
    /// DISPLAY_NAME_REFRESH_INTERVAL_SEC - see maybe_refresh_display_names.
    next_display_name_refresh_at: Instant,
    /// ACT-3: same immediate-then-periodic schedule, see
    /// maybe_refresh_activity_scoring.
    next_scoring_refresh_at: Instant,
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
            next_display_name_refresh_at: now,
            next_scoring_refresh_at: now,
        }
    }
}

/// Idle time is entirely the project's call now: `idle_threshold_sec` (the
/// per-project allowance, or this org-wide fallback) is the only threshold -
/// crossing it stops the timer and rewinds the idle stretch immediately, with
/// no separate warn/alert stages first.
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
        // CQ-1: unregister the global input hooks now that ACT-1 uses real
        // ones - a leaked low-level hook is a system-wide problem, not just
        // this process's, so this must happen on every stop path, not just
        // process exit.
        self.activity.stop();
        *self.session_id.lock() = None;
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    /// Call right before/after telling the backend to stop the session
    /// outside the tick loop (e.g. the Stop button), so the next tick's
    /// now-missing session reads as an intentional stop, not an abandonment
    /// to recover from.
    pub fn note_stop_requested(&self) {
        self.expect_stop.store(true, Ordering::SeqCst);
    }

    /// The break button: marks the session idle server-side, preserving its
    /// accumulated active/idle totals (never resets to 0 the way clicking
    /// Stop then Start again used to). Nothing is tracked while paused - see
    /// `tick_paused` for how the idle time itself gets credited and synced.
    pub fn pause(&self) -> Result<(), String> {
        let (task_id, active_seconds, idle_seconds) = self.task_progress.lock().clone();
        let task_id = task_id.filter(|id| !id.is_empty());
        self.api
            .lock()
            .post_session_action("idle", task_id.as_deref(), None, active_seconds, idle_seconds, None)?;
        self.paused.store(true, Ordering::SeqCst);
        self.emit_status("Timer paused — on a break");
        Ok(())
    }

    pub fn resume(&self) -> Result<(), String> {
        let (task_id, active_seconds, idle_seconds) = self.task_progress.lock().clone();
        let task_id = task_id.filter(|id| !id.is_empty());
        self.api
            .lock()
            .post_session_action("resume", task_id.as_deref(), None, active_seconds, idle_seconds, None)?;
        self.paused.store(false, Ordering::SeqCst);
        self.emit_status("Task session active");
        Ok(())
    }

    /// The session currently being tracked, if any — used to cleanly close it
    /// server-side on quit instead of leaving it "active" forever (which would
    /// otherwise get silently resumed the next time the agent signs in).
    pub fn current_session_id(&self) -> Option<String> {
        self.session_id.lock().clone()
    }

    /// One delivery attempt for a pending idle-stop, if any. Returns `true`
    /// when there's nothing pending (already delivered, or never was one) and
    /// `false` when a pending stop still exists and this attempt didn't land.
    /// Shared by `tick()`'s own per-tick retry and `flush_pending_stop` below.
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

    /// Must be called (and must succeed) before a NEW session is allowed to
    /// start. The server keys an open session by member, not by session id
    /// (`findOpenSession`), so if an idle-triggered stop for the *previous*
    /// session is still queued here when "start" is posted, the server sees
    /// its own still-"active" old row and just overwrites it in place rather
    /// than opening an independent new one - the new session and the old
    /// pending stop are now the same server row. The next tick's retry then
    /// delivers that pending stop, which "stops" the row with the OLD,
    /// idle-rewound totals - silently killing the session the user just
    /// started and discarding whatever it had already accumulated. Flushing
    /// here first, before start_task_session/start_project_session post
    /// "start", closes that window entirely: either the old stop lands first
    /// (so "start" opens a genuinely fresh row), or it's still stuck (network
    /// down) and starting anyway would just race it again, so callers should
    /// refuse to start rather than proceed.
    pub fn flush_pending_stop(&self) -> bool {
        self.try_deliver_pending_stop()
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

    /// MAC-3/CQ-4: pulls the latest server-delivered app display-name map
    /// (CLS-1) into the event builder's cache. Best-effort and independent
    /// of session/tracking state - runs on this schedule regardless of
    /// whether a timer is active, since it's cheap and display names should
    /// be fresh by the time a session starts, not fetched for the first time
    /// mid-session. A failed fetch leaves the existing cache untouched (see
    /// fetch_app_display_names's contract) and is retried next interval.
    fn maybe_refresh_display_names(&self, next_refresh_at: &mut Instant) {
        if Instant::now() < *next_refresh_at {
            return;
        }
        *next_refresh_at = Instant::now() + Duration::from_secs(DISPLAY_NAME_REFRESH_INTERVAL_SEC);
        if let Ok(entries) = self.api.lock().fetch_app_display_names() {
            self.events.apply_display_names(entries);
        }
        // Same schedule, same best-effort contract: a failed fetch keeps the
        // exclusions already in force rather than clearing them, so a network
        // blip can never start capturing an app the org excluded.
        if let Ok(patterns) = self.api.lock().fetch_capture_exclusions() {
            self.events.apply_capture_exclusions(patterns);
        }
    }

    /// ACT-3: pulls server-tunable scoring calibration into the running
    /// ActivityMeter. Same best-effort/throttled shape as
    /// maybe_refresh_display_names - a failed fetch leaves the meter on
    /// whatever it already had (the compile-time defaults, or the last
    /// successful fetch) rather than resetting anything.
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

    fn tick(&self, state: &mut TickState) {
        self.maybe_flush_queue(&mut state.next_flush_at);
        self.maybe_refresh_display_names(&mut state.next_display_name_refresh_at);
        self.maybe_refresh_activity_scoring(&mut state.next_scoring_refresh_at);

        // TC-6: retry an idle-stop that hasn't landed yet, and do nothing
        // else this tick. Fetching a session now - before the server has
        // confirmed the stop - is exactly what let a task-id mismatch on the
        // next tick re-baseline from the server's still-active, pre-rewind
        // totals and silently resume tracking.
        if self.pending_stop.lock().is_some() {
            self.try_deliver_pending_stop();
            return;
        }

        // Break in progress: skip fetch_session/status handling entirely so
        // the server's "idle" status (set by `pause()`) never gets read back
        // as "session over" and reset - see `tick_paused`.
        if self.paused.load(Ordering::SeqCst) {
            self.tick_paused(state);
            return;
        }

        // Bound to a `let` on purpose, same reasoning as
        // `AgentController::sign_in_with_password`'s `session_bootstrap` call:
        // a temporary `MutexGuard` created inside a `match` scrutinee lives
        // until the end of the whole match, not just until `fetch_session()`
        // returns. Matching directly on `self.api.lock().fetch_session()`
        // left `self.api` locked for the entire body of the `Err(_)` arm
        // below - which itself calls `upload_screenshot`/`upload_app_slice`,
        // each re-locking the same (non-reentrant) mutex. That is a
        // self-deadlock the moment both conditions are true (mid-session and
        // fetch_session fails), silently hanging the tracker thread forever.
        // Never triggered before because this branch had zero test coverage
        // until Suggestion #14 added it - the deadlock showed up immediately
        // once the branch was actually exercised end to end.
        let fetched = self.api.lock().fetch_session();
        let session = match fetched {
            Ok(session) => session,
            Err(_) => {
                // Backend unreachable. If we were mid-session, keep capturing under
                // it — nothing gets lost, it just queues locally (and keeps ticking
                // active/idle seconds) until reconnected, when the next sync catches up.
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
                    // No screenshots while idle - see tick_progress's doc
                    // comment. next_screenshot_at is left untouched so the
                    // very next active tick captures immediately instead of
                    // waiting out the rest of a cadence that elapsed while
                    // nobody was there to be captured.
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
            // TC-X: the server can close a session out from under the agent
            // (abandoned-session sweep, ~90s of missed syncs - see
            // Dashboard-Backend's agent-heartbeat.js) after a brief
            // auth/network hiccup that has nothing to do with the user
            // actually stopping. tick_progress runs off wall-clock, not the
            // network, so the local counters kept climbing the whole time -
            // discarding them here (the old behavior) silently threw away
            // real, worked, tracked time. Try to resume with the local total
            // carried forward before giving up.
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
            // ID-4: a different session can carry different project settings
            // even when the task id is unchanged (and is always unchanged for
            // task-less sessions, where it is `""` on both sides).
            state.idle_settings_stale = true;
            *self.session_id.lock() = Some(session_id.clone());
            state.last_app_log_at = Instant::now() - Duration::from_secs(APP_LOG_INTERVAL_SEC);
            state.next_screenshot_at = Instant::now() + Duration::from_secs(FIRST_SCREENSHOT_DELAY_SEC);
            log::info!("Tracking session {session_id}");
            self.upload_app_slice(&session_id, &window);
            state.last_app_log_at = Instant::now();
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
        let task_changed = state.task_id.as_str() != session_task_id;
        // ID-4: settings follow *either* identity. Re-baselining still keys on
        // the task alone - a recovered session (try_recover_lost_session) has
        // already carried its own totals forward by hand, and re-reading them
        // from the server here would throw that away.
        if task_changed || state.idle_settings_stale {
            let tracking = if session_task_id.is_empty() {
                None
            } else {
                self.api.lock().fetch_task_time_tracking(&session_task_id).ok()
            };
            // Task-less (calling project) sessions have no per-task totals to
            // re-baseline from, so the session's own accumulated seconds are
            // the cumulative figure - without this a resume would restart the
            // count at 0 and push a lower total than already recorded.
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

            // ID-3: task-anchored sessions get this from the same
            // fetch_task_time_tracking call above (task-time-tracking.js
            // attaches the owning project's settings to every response).
            // Calling (task-less) sessions have no such fetch, so their
            // settings are read straight off the session the agent already
            // has (normalizeSession attaches them there for task-less
            // sessions only - see activity/routes.js). A failed fetch on the
            // task path falls back to the org-wide default rather than
            // flapping on a transient network error.
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
            // ID-4: the org-wide poll has always been validated
            // (apply_idle_thresholds), but the per-project value went straight
            // in unchecked - and nothing upstream guarantees it is positive:
            // projects.idle_time_seconds carries no CHECK (> 0), and the
            // project modal floors a cleared field to 0 rather than rejecting
            // it. A 0 threshold makes `idle_for < 0` unsatisfiable, so
            // tick_idle_escalation would stop and rewind on the very first
            // tick and the member could never track on that project at all.
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

            // PS-2: an unclean exit (crash/kill/reboot) between two `sync`
            // calls loses whatever PS-1's on-disk mirror hadn't reached the
            // server yet - reconcile against it here, same GREATEST-style
            // rule TC-4 already applies server-side for `sync`, so a restart
            // never displays less than what was last actually shown. Scoped
            // to the exact same session+task on purpose: a leftover file from
            // an already-closed session must never bleed into a new one.
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

        // Calling-project sessions have no task, so they sync on project id
        // instead - gating purely on task id would leave their time unrecorded.
        let session_project_id = session
            .get("projectId")
            .or_else(|| session.get("project_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !session_project_id.is_empty() {
            state.last_project_id = session_project_id.clone();
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
        // next_screenshot_at is left untouched so the very next active tick
        // captures immediately instead of waiting out the rest of a cadence
        // An app the org excluded from capture is skipped here, not filtered
        // out server-side after the fact: nothing about it - title, URL or
        // pixels - should leave the machine, and we must not pay the UI
        // Automation probe for it either. Time still accrues; only the
        // content capture stops.
        let capture_excluded = self.events.is_capture_excluded(&window);

        // that elapsed while nobody was there to be captured.
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
            );
            state.next_sync_at = now + Duration::from_secs(SESSION_SYNC_INTERVAL_SEC);

            // TC-5: the server already truncated active_seconds against the
            // task's daily cap (timerCapped) or stopped counting because the
            // project's own budget stop-timer threshold was crossed
            // (budgetCapped) - stop here too, same shape as the idle-stop
            // path above, or the local clock keeps advancing past a number
            // the server has stopped recording.
            let cap_message = match &sync_result {
                Ok(info) if info.timer_capped => Some("Timer stopped — task's daily hour limit reached"),
                Ok(info) if info.budget_capped => Some("Timer stopped — project's budget limit reached"),
                _ => None,
            };
            if let Some(message) = cap_message {
                log::info!("{message} - stopping timer");
                let _ = self.api.lock().post_session_action(
                    "stop",
                    Some(state.task_id.as_str()).filter(|id| !id.is_empty()),
                    Some(session_project_id.as_str()).filter(|id| !id.is_empty()),
                    active_total,
                    idle_total,
                    None,
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

    /// AC-1: "a session that's 100% active but ~100% injected is a
    /// near-certain fake" - falls out of ACT-1's real hooks almost for free.
    /// Log-only, throttled to once per 10 minutes per episode: this is a
    /// signal for human review (Part E's GDPR Art. 22 guardrail - never an
    /// automatic verdict), not a block, and full session-level surfacing
    /// (an integrity score in the UI, backend storage) is AC-4's job, not
    /// this one. Gated on a real activity score too, not just a high
    /// fraction alone - a handful of injected events with few total inputs
    /// isn't a meaningful sample.
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

    /// Idle enforcement. Returns true when the timer was stopped.
    ///
    /// The project's own idle allowance (`idle_threshold_sec`, same value
    /// `tick_progress` uses for the active/idle split) is the only threshold -
    /// no separate org-wide warn/alert stages ahead of it. The moment idle
    /// time crosses it, the timer stops and the active total is rewound to
    /// what it was at the last real input - so the entire idle stretch,
    /// including the grace window `tick_progress` had already credited
    /// active before its own threshold kicked in, is reversed out of active
    /// and folded into idle instead of simply vanishing. Without that fold,
    /// idle_total only ever reflected the handful of ticks between crossing
    /// the threshold and this stop actually running - a few seconds, not the
    /// real time the person was away - so the reported active/idle split
    /// silently lost a whole idle_threshold_sec-sized gap on every escalated
    /// stop instead of accounting for where that time actually went.
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
        // ID-3: idle time disabled for this project means no warn/alert/
        // auto-stop/rewind either - the switch does what it says end to end,
        // not just for the active/idle split in tick_progress.
        if idle_time_disabled {
            return false;
        }
        // Idle escalation is Windows-only until real input-hook listeners
        // exist for other platforms (see ActivityMeter::run_listeners /
        // HOOKS_SUPPORTED). Off Windows, idle_seconds() only grows from
        // process start and never resets, which would otherwise force-stop
        // every session ~15 minutes after launch regardless of real
        // activity - so escalation is skipped entirely rather than acting on
        // that unreliable/absent signal.
        if !ActivityMeter::HOOKS_SUPPORTED {
            return false;
        }
        let idle_for = self.activity.idle_seconds();
        let active_total = active_baseline.saturating_add(*active_elapsed);

        // Real input: remember this as the last honest point the clock can be
        // rewound to. Same per-project threshold tick_progress uses (ID-3) -
        // this is the identical boundary.
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
        // Never let the rewind push the total up, and never below zero -
        // clamping both ways because a mis-ordered snapshot would otherwise
        // mint or destroy hours. `reversed` moves to idle rather than
        // disappearing - active and idle still have to sum to the real
        // elapsed wall-clock time, not silently fall short of it.
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
            )
            .is_ok();
        if !delivered {
            // TC-6: the network problem that often accompanies an idle
            // stretch must not mean the stop is silently lost. Without
            // this, the server still thinks the session is active, and
            // the next tick's re-baseline path would resume tracking
            // with the rewind never applied - re-crediting exactly the
            // idle time this escalation just reversed.
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

    /// Seconds to credit for one tick: real elapsed wall time since the last
    /// credited tick, not an assumed SESSION_POLL_SEC (TC-2). One iteration of
    /// `loop_run` is `sleep(SESSION_POLL_SEC) + however long tick() itself
    /// took` — and `tick()` does real network I/O every time (fetch_session
    /// every tick, plus periodic app/screenshot/sync POSTs) — so crediting a
    /// fixed interval silently under-counts by however long that I/O took.
    /// The error was one-directional: the clock could only ever run slow.
    ///
    /// Clamped to `SESSION_POLL_SEC * 4` on purpose: a sleep/hibernate gap
    /// makes the real elapsed time huge, and that must never be banked as
    /// active work. A resumed laptop credits at most this, then idle
    /// escalation takes over and rewinds to the last real input - which is
    /// the correct outcome for a suspend, not a fabricated block of "active"
    /// time in a single tick.
    fn credited_seconds(elapsed: Duration) -> u64 {
        elapsed.as_secs().min(SESSION_POLL_SEC * 4)
    }

    /// Counts the credited seconds as idle rather than active if there's been
    /// no mouse/keyboard input for IDLE_THRESHOLD_SEC - an open session
    /// sitting untouched shouldn't silently rack up "active" hours.
    #[allow(clippy::too_many_arguments)]
    /// Returns whether this tick's delta was credited to idle rather than
    /// active - callers use it to skip screenshot/app-slice capture while
    /// the user is idle (a screenshot of an idle desktop is never useful,
    /// and taking one defeats the point of idle detection in the first
    /// place). Always `false` when idle time is disabled for the project,
    /// since there's no idle bucket to fall into - see the `active_elapsed`
    /// branch below.
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
        let delta = Self::credited_seconds(now.duration_since(*last_tick_at));
        *last_tick_at = now;

        // ID-3: a project with idle time disabled never splits into idle at
        // all - everything is credited active. Otherwise use this session's
        // own project's threshold (fetched on every task/project transition),
        // never the flat org-wide `self.idle_threshold_sec`.
        // Same HOOKS_SUPPORTED gate tick_idle_escalation uses above, for the
        // same reason: off-Windows, idle_seconds() only grows monotonically
        // from process start and never resets. Without this gate, every tick
        // past the first idle_threshold_sec on a non-Windows build would be
        // misclassified as idle forever, even with continuous real input.
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

        // PS-1: same values, same call site, so the on-disk mirror can never
        // drift from what's in RAM. Scoped to the current session so PS-2's
        // restart reconciliation can tell a fresh session's leftovers apart
        // from a genuinely resumable one.
        if let Some(session_id) = self.session_id.lock().clone() {
            self.progress.save(&PersistedProgress {
                session_id,
                task_id: id,
                active_seconds,
                idle_seconds,
            });
        }
    }

    /// While paused, credits the whole wall-clock delta to idle (a break is
    /// not activity) and periodically re-syncs so the paused session's
    /// `updated_at` stays fresh enough to survive the abandoned-session sweep
    /// (SESSION_STALE_MS in Dashboard-Backend's agent-heartbeat.js) through a
    /// long break. Does not touch `status` — `pause()` already set it to
    /// "idle" server-side; a bare "sync" here just keeps the timestamp alive.
    ///
    /// ID-3, missed the first time: idle_time_disabled means no idle time
    /// tracked for this project at all, and that has to hold here too, not
    /// just in tick_progress/tick_idle_escalation - this was the one place
    /// still crediting idle unconditionally. Not credited to active either
    /// (unlike tick_progress's "no split" behavior) - a break is an explicit
    /// "not working" from the person, and crediting it as active time would
    /// mean pausing silently mints work hours instead of just leaving this
    /// stretch out of both totals, which is what "not tracked" actually means.
    fn tick_paused(&self, state: &mut TickState) {
        let now = Instant::now();
        let delta = Self::credited_seconds(now.duration_since(state.last_tick_at));
        state.last_tick_at = now;
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
            );
            state.next_sync_at = now + Duration::from_secs(SESSION_SYNC_INTERVAL_SEC);
        }
    }

    /// Attempts to resume a session the server closed as abandoned, carrying
    /// the local unsynced total (baseline + elapsed) forward as the new
    /// session's starting point instead of losing it. Returns false (caller
    /// falls back to a full reset) when there is nothing local worth saving,
    /// or the resume call itself fails - a network blip here just means the
    /// next tick's fetch_session() finds still-no-session and tries again
    /// naturally, rather than this method needing its own retry loop.
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
            .post_session_action("start", task_id, project_id, active_total, idle_total, None)
        {
            Ok(info) => {
                log::warn!(
                    "Recovered a session the server closed as abandoned - resumed with {active_total}s active / {idle_total}s idle carried forward"
                );
                state.current_session = info.id.unwrap_or_default();
                // ID-4: this adopts a brand-new session id without going
                // through the tick's own session-change branch, so nothing
                // else would mark the project's idle settings for a re-read -
                // the recovered session would keep running on whatever was
                // already cached.
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
        // No session means no project to have fetched a threshold from - back
        // to the bootstrap default so a stale disabled-project's setting can
        // never bleed into whatever session/project starts next.
        *idle_time_disabled = false;
        *idle_threshold_sec = IDLE_THRESHOLD_SEC;
        // A resumed session must not credit the gap since tracking stopped -
        // without this, signing back in after a long break would credit that
        // entire gap (clamped to SESSION_POLL_SEC * 4, but still wrong) on
        // the very next tick_progress call.
        *last_tick_at = Instant::now();
        *self.task_progress.lock() = (None, 0, 0);
        *self.idle_stage.lock() = 0;
        self.progress.clear();
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
        // A window we could not identify is a gap in what the agent can see,
        // not an app called "Unknown". Uploading it anyway put that literal
        // name in Top Apps with real seconds against it - see
        // ForegroundWindow::is_identified. The session still runs; only this
        // tick's attribution is dropped.
        if !window.is_identified() {
            log::debug!("skipping app slice: foreground window could not be identified");
            return;
        }

        let app_event = self.events.app_slice(window);
        let app_ok = self.api.lock().post_events(session_id, std::slice::from_ref(&app_event));
        if !app_ok {
            self.queue.enqueue(session_id, &[app_event]);
        }

        // Was true unconditionally whenever no URL was captured at all (not a
        // browser, or the capture script came back empty) — every non-browser
        // app log line was claiming "+ URL" it never had.
        // One event per URL actually visited this tick - the address-bar
        // subscription reports every navigation, so a member moving quickly
        // through pages no longer collapses into whichever one the poll
        // happened to land on.
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
mod tests {
    use super::{valid_idle_threshold, ActivityTracker, IdleWatch, PendingStop, TickState};
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use std::thread;
    use std::time::{Duration, Instant};

    use parking_lot::Mutex;
    use tiny_http::Method;

    use crate::capture::activity::ActivityMeter;
    use crate::client::api::ApiClient;
    use crate::config::Settings;
    use crate::test_support::{fake_jwt, fake_server};

    // Suggestion #14a: end-to-end tick() coverage, made tractable by the
    // TickState refactor (Suggestion #11) - a test can now hand tick() one
    // struct instead of hand-threading 15 `&mut` locals. These exercise the
    // real session-transition and idle-escalation state machine against a
    // real (fake) HTTP server, not just the pure helpers tested elsewhere in
    // this module.

    /// A `Settings` pointed at `api_url`, with every filesystem path inside
    /// its own fresh temp directory so parallel tests never share state (the
    /// queue file in particular - EventQueue::new reads it on construction).
    fn test_settings(api_url: String) -> Settings {
        let dir = std::env::temp_dir().join(format!(
            "vt-tracker-test-{}-{:?}",
            std::process::id(),
            std::time::Instant::now()
        ));
        let _ = std::fs::create_dir_all(&dir);
        Settings {
            api_url,
            web_url: "http://127.0.0.1:1".into(),
            auth_url: "http://127.0.0.1:1".into(),
            auth_port: 0,
            store_path: dir.join("store.json"),
            prefs_path: dir.join("prefs.json"),
            queue_path: dir.join("queue.jsonl"),
            classification_cache_path: dir.join("classifications.json"),
            progress_path: dir.join("progress.json"),
            log_path: dir.join("agent.log"),
            url_script_path: dir.join("missing-get-browser-url.ps1"),
            macos_url_script_path: dir.join("missing-get-browser-url.applescript"),
            app_icon_script_path: dir.join("missing-get-app-icon.ps1"),
        }
    }

    /// A tracker whose `ApiClient` already holds a not-yet-expired id token,
    /// so `authorized()` never needs a real Firebase round-trip, pointed at
    /// `api_url`.
    fn test_tracker(api_url: String) -> ActivityTracker {
        let mut api = ApiClient::new(api_url.clone(), "http://127.0.0.1:1".into())
            .expect("HTTP client builds in a test environment");
        api.set_tokens(&fake_jwt(3600), "refresh-token");
        let settings = test_settings(api_url);
        ActivityTracker::new(
            std::sync::Arc::new(Mutex::new(api)),
            &settings,
            ActivityMeter::new(),
            None,
        )
    }

    /// Answers exactly the routes a session-transition tick needs; anything
    /// else 404s, which every caller in `tick()` already treats as a
    /// harmless failed best-effort fetch (display names, scoring settings).
    fn session_test_server(session_body: &'static str) -> String {
        fake_server(move |request| {
            let path = request.url().split('?').next().unwrap_or("").to_string();
            match (request.method(), path.as_str()) {
                (Method::Get, "/api/activity/session") => (200, session_body.to_string()),
                (Method::Get, p) if p.starts_with("/api/tasks/") && p.ends_with("/time-tracking") => {
                    // ID-3: idleTimeSeconds=1 so a test that shrinks the org-wide
                    // idle stages via apply_idle_thresholds (warn/alert/stop) isn't
                    // gated on the real 450s/60s default while it does - this
                    // project-sourced value is what tick_idle_escalation's "is this
                    // real input" check now reads, not the org-wide atomic.
                    (200, r#"{"data": {"activeSeconds": 0, "idleSeconds": 0, "disableIdleTime": false, "idleTimeSeconds": 1}}"#.to_string())
                }
                (Method::Post, "/api/activity/events") => {
                    (200, r#"{"data": {"inserted": 1}}"#.to_string())
                }
                (Method::Post, "/api/activity/session") => {
                    (200, r#"{"data": {"id": "sess-1", "status": "stopped"}}"#.to_string())
                }
                _ => (404, "{}".to_string()),
            }
        })
    }

    const ACTIVE_SESSION_WITH_TASK: &str = r#"{"data": {"id": "sess-1", "status": "active", "taskId": "task-1", "projectId": "proj-1", "activeSeconds": 0, "idleSeconds": 0}}"#;

    /// ID-4: a task-less ("calling project") session - no `taskId`, and the
    /// project's own idle settings attached to the session itself, exactly as
    /// `normalizeSession` sends them (`activity/routes.js`). Until this
    /// fixture existed the whole task-less branch had no coverage at all:
    /// every session fixture in this suite was task-anchored, which is why
    /// the settings-refresh bug shipped unnoticed.
    const ACTIVE_SESSION_TASK_LESS: &str = r#"{"data": {"id": "sess-2", "status": "active", "taskId": null, "projectId": "proj-1", "activeSeconds": 0, "idleSeconds": 0, "disableIdleTime": false, "idleTimeSeconds": 450}}"#;

    /// Same shape, but with the unusable `0` allowance a cleared field in the
    /// project modal actually stores (nothing upstream forbids it).
    const ACTIVE_SESSION_TASK_LESS_ZERO_ALLOWANCE: &str = r#"{"data": {"id": "sess-3", "status": "active", "taskId": null, "projectId": "proj-1", "activeSeconds": 0, "idleSeconds": 0, "disableIdleTime": false, "idleTimeSeconds": 0}}"#;

    #[test]
    fn tick_transitions_into_a_newly_started_session() {
        let tracker = test_tracker(session_test_server(ACTIVE_SESSION_WITH_TASK));
        let mut state = TickState::new();

        tracker.tick(&mut state);

        assert!(state.was_active, "a fresh active session must mark the tracker active");
        assert_eq!(state.current_session, "sess-1");
        assert_eq!(state.task_id, "task-1");
    }

    #[test]
    fn tick_keeps_capturing_under_the_last_known_session_when_fetch_session_fails() {
        // A real, listening, always-500 server - not a dropped/unbound port.
        // Whether a closed port fails a connect attempt fast or slow is an
        // OS/sandbox networking detail this test has no business depending
        // on; a server that's reached but answers with a server error hits
        // the exact same `Err(_)` arm in tick() (fetch_session's contract
        // treats "reached but bad response" and "unreachable" the same way),
        // deterministically and fast.
        let base_url = fake_server(|_request| (500, "{}".to_string()));
        let tracker = test_tracker(base_url);

        // Simulate a tick that already has a session open - the exact
        // scenario TC-2/this branch exists for: keep ticking under the last
        // known session across a network blip instead of tearing it down.
        let mut state = TickState::new();
        state.was_active = true;
        state.current_session = "sess-1".to_string();
        state.task_id = "task-1".to_string();
        // Skip the incidental best-effort refreshes and screenshot capture -
        // none of them are what this test is about (and a real screenshot
        // capture, via xcap, isn't reliable in a headless/sandboxed test
        // environment). The app/URL log path below is what exercises the
        // "backend unreachable" behavior this test guards.
        let far_future = std::time::Instant::now() + Duration::from_secs(3600);
        state.next_screenshot_at = far_future;
        state.next_display_name_refresh_at = far_future;
        state.next_scoring_refresh_at = far_future;

        tracker.tick(&mut state);

        assert!(state.was_active, "an unreachable backend must not be treated as session-over");
        assert_eq!(state.current_session, "sess-1", "the last known session must be preserved");
        assert_eq!(state.task_id, "task-1");
    }

    // `tick_idle_escalation` itself short-circuits to a no-op off Windows
    // (`if !ActivityMeter::HOOKS_SUPPORTED { return false; }`, see its own
    // doc comment) because idle_seconds() has no real input hook to reset it
    // on those platforms - the escalation this test exercises does not exist
    // to test outside Windows. Without this guard the test fails on every
    // non-Windows CI/dev machine regardless of the sleep/threshold timing:
    // `tick_idle_escalation` returns `false` immediately, before ever
    // reading `idle_for`.
    /// ID-4: the project's allowance must reach a task-less session.
    ///
    /// This is the regression guard for the bug where the idle-settings read
    /// was gated on the *task* id changing. A task-less session's task id is
    /// always `""`, and a fresh `TickState` starts at `""` too, so the guard
    /// compared `"" != ""`, skipped the block, and left the session running on
    /// the 60s compile-time constant instead of the project's 450s - stopping
    /// and rewinding after a minute away from the keyboard.
    #[test]
    fn tick_reads_the_projects_idle_allowance_for_a_task_less_session() {
        let tracker = test_tracker(session_test_server(ACTIVE_SESSION_TASK_LESS));
        let mut state = TickState::new();
        assert_eq!(
            state.idle_threshold_sec_for_project,
            crate::constants::IDLE_THRESHOLD_SEC,
            "precondition: a fresh state starts on the compile-time default",
        );

        tracker.tick(&mut state);

        assert!(state.was_active, "precondition: the session must have started");
        assert!(state.task_id.is_empty(), "precondition: this session is task-less");
        assert_eq!(
            state.idle_threshold_sec_for_project, 450,
            "the project's own allowance must be adopted, not IDLE_THRESHOLD_SEC",
        );
    }

    /// ID-4: `projects.idle_time_seconds` has no `CHECK (> 0)` and the project
    /// modal floors a cleared field to `0`, so `0` is reachable. Taken
    /// literally it makes `idle_for < 0` unsatisfiable, which stops and
    /// rewinds the session on its very first tick.
    #[test]
    fn an_unusable_project_idle_allowance_falls_back_to_the_org_wide_value() {
        let tracker = test_tracker(session_test_server(ACTIVE_SESSION_TASK_LESS_ZERO_ALLOWANCE));
        tracker.apply_idle_thresholds(123);
        let mut state = TickState::new();

        tracker.tick(&mut state);

        assert!(state.was_active, "precondition: the session must have started");
        assert_eq!(
            state.idle_threshold_sec_for_project, 123,
            "a 0 allowance must fall back to the org-wide threshold, never be used as-is",
        );
    }

    #[cfg(windows)]
    #[test]
    fn tick_stops_the_timer_once_the_idle_escalation_deadline_passes() {
        let tracker = test_tracker(session_test_server(ACTIVE_SESSION_WITH_TASK));
        // Shrunk far below any real project allowance so this test finishes
        // in a few seconds instead of waiting out a real idle period.
        tracker.apply_idle_thresholds(1);
        let mut state = TickState::new();

        // Starts the session. ActivityMeter's last-input clock is set at
        // construction and nothing in this test ever feeds it real input, so
        // idle_seconds() grows with real wall-clock time from here exactly
        // as it would if the user genuinely walked away.
        tracker.tick(&mut state);
        assert!(state.was_active, "precondition: the session must have started");

        thread::sleep(Duration::from_millis(3_500));
        tracker.tick(&mut state);

        assert!(!state.was_active, "idle escalation should have stopped the timer");
        assert!(state.current_session.is_empty());
    }

    // Windows-only, same as the sibling above: tick_idle_escalation short-
    // circuits on `!ActivityMeter::HOOKS_SUPPORTED` off Windows, so `stopped`
    // is always false there and the rewind never runs.
    #[cfg(windows)]
    #[test]
    fn idle_escalation_folds_the_reversed_active_chunk_into_idle_instead_of_discarding_it() {
        let base_url = fake_server(|request| match request.method() {
            Method::Post => (200, r#"{"data": {"id": "sess-1", "status": "stopped"}}"#.to_string()),
            _ => (404, "{}".to_string()),
        });
        let tracker = test_tracker(base_url);
        tracker.apply_idle_thresholds(1);

        // Real idle_seconds() growing from construction, same technique the
        // test above uses - nothing here ever feeds ActivityMeter real input.
        thread::sleep(Duration::from_millis(3_500));

        let mut watch = IdleWatch {
            stage: 0,
            // The last confirmed real input was at 10s of active time -
            // everything credited active since then (up to 100s) is the
            // idle grace window tick_progress mistakenly counted active.
            active_at_last_input: 10,
        };
        let active_baseline = 0u64;
        let active_elapsed = 100u64;
        let idle_baseline = 0u64;
        // The couple of ticks tick_progress had already credited idle by the
        // time escalation ran on the same tick it crossed the threshold.
        let idle_elapsed = 2u64;

        let stopped = tracker.tick_idle_escalation(
            &mut watch,
            "task-1",
            "project-1",
            &active_baseline,
            &active_elapsed,
            &idle_baseline,
            &idle_elapsed,
            false,
            1,
        );
        assert!(stopped, "past the threshold, escalation must stop the session");

        let (_, active_seconds, idle_seconds) = tracker.task_progress.lock().clone();
        // Rewound to the last real input - 10s, not 0 and not the full 100s.
        assert_eq!(active_seconds, 10);
        // The reversed 90s (100 - 10) joins the 2s tick_progress already
        // credited idle - the fix this guards: that 90s used to just vanish,
        // reported nowhere, instead of landing here.
        assert_eq!(idle_seconds, 92);
    }

    /// ID-3: `disable_idle_time = true` on the project must mean no idle
    /// escalation at all - the same idle stretch that stops the timer in the
    /// test above must leave it running when the project has idle time
    /// disabled. Guards the exact bug this task exists to fix: the switch
    /// used to save to the database and change nothing.
    #[test]
    fn tick_never_escalates_when_the_projects_idle_time_is_disabled() {
        let base_url = fake_server(move |request| {
            let path = request.url().split('?').next().unwrap_or("").to_string();
            match (request.method(), path.as_str()) {
                (Method::Get, "/api/activity/session") => (200, ACTIVE_SESSION_WITH_TASK.to_string()),
                (Method::Get, p) if p.starts_with("/api/tasks/") && p.ends_with("/time-tracking") => (
                    200,
                    r#"{"data": {"activeSeconds": 0, "idleSeconds": 0, "disableIdleTime": true, "idleTimeSeconds": 1}}"#
                        .to_string(),
                ),
                (Method::Post, "/api/activity/events") => (200, r#"{"data": {"inserted": 1}}"#.to_string()),
                (Method::Post, "/api/activity/session") => {
                    (200, r#"{"data": {"id": "sess-1", "status": "stopped"}}"#.to_string())
                }
                _ => (404, "{}".to_string()),
            }
        });
        let tracker = test_tracker(base_url);
        // Same shrunk threshold as the test above - if disable_idle_time were
        // being ignored, this would stop the timer within the same 3.5s.
        tracker.apply_idle_thresholds(1);
        let mut state = TickState::new();

        tracker.tick(&mut state);
        assert!(state.was_active, "precondition: the session must have started");

        thread::sleep(Duration::from_millis(3_500));
        tracker.tick(&mut state);

        assert!(state.was_active, "idle time disabled must never stop the timer");
        assert_eq!(state.current_session, "sess-1");
    }

    /// Guards the Start/idle-stop race: `start_task_session`/
    /// `start_project_session` must refuse to proceed (get `false` back) while
    /// a pending idle-stop genuinely can't be delivered, and must actually
    /// clear it (get `true`, and `pending_stop` empty) the moment the server
    /// accepts it - a caller that pressed on regardless would let the pending
    /// stop later land on the session it just started.
    #[test]
    fn flush_pending_stop_reports_false_while_stuck_and_true_once_delivered() {
        let attempts = std::sync::Arc::new(AtomicUsize::new(0));
        let attempts_clone = attempts.clone();
        let base_url = fake_server(move |request| {
            let path = request.url().split('?').next().unwrap_or("").to_string();
            match (request.method(), path.as_str()) {
                (Method::Post, "/api/activity/session") => {
                    if attempts_clone.fetch_add(1, AtomicOrdering::SeqCst) == 0 {
                        (500, "{}".to_string())
                    } else {
                        (200, r#"{"data": {"id": "sess-1", "status": "stopped"}}"#.to_string())
                    }
                }
                _ => (404, "{}".to_string()),
            }
        });
        let tracker = test_tracker(base_url);
        *tracker.pending_stop.lock() = Some(PendingStop {
            task_id: "task-1".into(),
            project_id: String::new(),
            active_seconds: 120,
            idle_seconds: 30,
        });

        assert!(!tracker.flush_pending_stop(), "first attempt fails (500) - must report false");
        assert!(tracker.pending_stop.lock().is_some(), "still queued after a failed attempt");

        assert!(tracker.flush_pending_stop(), "second attempt succeeds - must report true");
        assert!(tracker.pending_stop.lock().is_none(), "cleared once actually delivered");
    }

    #[test]
    fn flush_pending_stop_is_a_true_no_op_when_nothing_is_queued() {
        let base_url = fake_server(|_| (404, "{}".to_string()));
        let tracker = test_tracker(base_url);
        assert!(tracker.flush_pending_stop(), "nothing pending - must not block starting a session");
    }

    /// ID-3, missed the first time: tick_progress and tick_idle_escalation
    /// both already respected idle_time_disabled, but tick_paused - the
    /// third and only other place idle_elapsed grows - credited a break to
    /// idle unconditionally. This is the regression guard for that gap:
    /// pausing on a project with idle time disabled must not tick idle_elapsed
    /// up at all.
    #[test]
    fn tick_paused_never_credits_idle_when_the_projects_idle_time_is_disabled() {
        let base_url = fake_server(|_| (200, "{}".to_string()));
        let tracker = test_tracker(base_url);
        let mut state = TickState::new();
        state.idle_time_disabled = true;
        // Past due right away by default (TickState::new() sets next_sync_at
        // to construction time), which would otherwise fire tick_paused's
        // conditional sync POST mid-test - pushed out so this test only
        // exercises the idle-crediting logic itself.
        state.next_sync_at = Instant::now() + Duration::from_secs(3600);

        thread::sleep(Duration::from_millis(1_100));
        tracker.tick_paused(&mut state);

        assert_eq!(state.idle_elapsed, 0, "idle time disabled must mean no idle time tracked, including on a break");
        assert_eq!(state.active_elapsed, 0, "a break must not be credited as active work either - it should be left out of both totals, not moved into the other one");
    }

    /// Same setup, idle time *not* disabled - the elapsed wall-clock time
    /// must still land in idle_elapsed exactly as before this fix, since the
    /// guard above only skips crediting when the project's flag is set.
    #[test]
    fn tick_paused_still_credits_idle_normally_when_idle_time_is_not_disabled() {
        let base_url = fake_server(|_| (200, "{}".to_string()));
        let tracker = test_tracker(base_url);
        let mut state = TickState::new();
        state.idle_time_disabled = false;
        state.next_sync_at = Instant::now() + Duration::from_secs(3600);

        thread::sleep(Duration::from_millis(1_100));
        tracker.tick_paused(&mut state);

        assert!(state.idle_elapsed >= 1, "a break must still count as idle time by default");
        assert_eq!(state.active_elapsed, 0, "a break is never active time");
    }

    /// Screenshots must stop while the user is idle - a picture of an empty
    /// desk defeats the point of idle detection. tick_progress's return
    /// value is the signal callers (tick, in both its normal and
    /// fetch-session-failed branches) gate `upload_screenshot` on; this
    /// tests that signal directly, at the level where the active/idle split
    /// itself is decided, rather than the network side effect three calls
    /// away.
    #[test]
    fn tick_progress_reports_idle_once_the_threshold_is_crossed() {
        let base_url = fake_server(|_| (200, "{}".to_string()));
        let tracker = test_tracker(base_url);
        let mut last_tick_at = Instant::now();
        let mut active_elapsed = 0u64;
        let mut idle_elapsed = 0u64;

        thread::sleep(Duration::from_millis(1_100));
        let credited_idle = tracker.tick_progress(
            "task-1",
            &mut last_tick_at,
            &0,
            &mut active_elapsed,
            &0,
            &mut idle_elapsed,
            false,
            1, // 1-second threshold, cleared by the sleep above
        );

        if ActivityMeter::HOOKS_SUPPORTED {
            // Real hooks: ActivityMeter's last-input clock was set at
            // construction and nothing here ever fed it real input, so
            // idle_seconds() grew with the sleep above exactly as it would
            // if the user genuinely walked away - same setup
            // tick_stops_the_timer_once_the_idle_escalation_deadline_passes
            // relies on.
            assert!(credited_idle, "should report idle once idle_seconds() clears the threshold");
            assert_eq!(active_elapsed, 0);
            assert!(idle_elapsed >= 1);
        } else {
            // No real hooks on this platform - idle_seconds() can't move,
            // so tick_progress always credits active. Documents why the
            // assertion flips rather than silently skipping the platform.
            assert!(!credited_idle);
            assert!(active_elapsed >= 1);
            assert_eq!(idle_elapsed, 0);
        }
    }

    /// The disabled-project counterpart: even once the same real idle time
    /// has elapsed, idle_time_disabled must keep tick_progress reporting
    /// "not idle" - screenshots keep flowing exactly as ID-3 already
    /// guarantees the active/idle split itself does.
    #[test]
    fn tick_progress_never_reports_idle_when_the_projects_idle_time_is_disabled() {
        let base_url = fake_server(|_| (200, "{}".to_string()));
        let tracker = test_tracker(base_url);
        let mut last_tick_at = Instant::now();
        let mut active_elapsed = 0u64;
        let mut idle_elapsed = 0u64;

        thread::sleep(Duration::from_millis(1_100));
        let credited_idle = tracker.tick_progress(
            "task-1",
            &mut last_tick_at,
            &0,
            &mut active_elapsed,
            &0,
            &mut idle_elapsed,
            true,
            1,
        );

        assert!(!credited_idle, "idle time disabled must mean screenshots never stop for idleness");
        assert!(active_elapsed >= 1);
        assert_eq!(idle_elapsed, 0);
    }

    // Guards ACT-3: a server-pushed idle threshold is only applied if it's
    // sane - idle time is decided solely by the project's own allowance now,
    // so there's nothing left to validate but "not zero".

    #[test]
    fn a_positive_idle_threshold_is_valid() {
        assert!(valid_idle_threshold(60));
    }

    #[test]
    fn a_zero_idle_threshold_is_rejected() {
        assert!(!valid_idle_threshold(0));
    }

    // Guards TC-2: the tracker must credit real elapsed wall time, not an
    // assumed SESSION_POLL_SEC per tick. Before this fix every tick credited
    // exactly 5s regardless of how long the tick's own network I/O took,
    // which meant every recorded hour was short by an amount proportional to
    // the user's network latency.

    #[test]
    fn credits_real_elapsed_time_not_the_assumed_poll_interval() {
        // A tick that actually took 9s (5s sleep + 4s of slow HTTP) must
        // credit 9, not SESSION_POLL_SEC (5). This is the bug that made every
        // recorded hour short.
        assert_eq!(ActivityTracker::credited_seconds(Duration::from_secs(9)), 9);
    }

    #[test]
    fn a_short_tick_credits_exactly_what_elapsed() {
        assert_eq!(ActivityTracker::credited_seconds(Duration::from_secs(5)), 5);
    }

    #[test]
    fn a_suspend_gap_cannot_bank_hours_nobody_worked() {
        // Laptop closed for 2h: clamp to SESSION_POLL_SEC * 4, then let idle
        // escalation take over and rewind to the last real input.
        assert_eq!(
            ActivityTracker::credited_seconds(Duration::from_secs(7200)),
            super::SESSION_POLL_SEC * 4,
        );
    }

    #[test]
    fn the_clamp_boundary_is_exact() {
        let ceiling = super::SESSION_POLL_SEC * 4;
        assert_eq!(
            ActivityTracker::credited_seconds(Duration::from_secs(ceiling)),
            ceiling,
            "exactly at the ceiling must not be clamped down further"
        );
        assert_eq!(
            ActivityTracker::credited_seconds(Duration::from_secs(ceiling + 1)),
            ceiling,
            "one second past the ceiling must still clamp"
        );
    }

    #[test]
    fn zero_elapsed_credits_zero() {
        assert_eq!(ActivityTracker::credited_seconds(Duration::from_secs(0)), 0);
    }

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
