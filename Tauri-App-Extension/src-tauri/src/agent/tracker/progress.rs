//! Crediting elapsed time to active or idle, and the baselines it is measured
//! against.

use super::*;

/// The most one tick can credit. Longer than any slow tick (each request gives up after
/// HTTP_TIMEOUT_SEC, and a tick makes a handful), short enough that a tracker that was
/// frozen for real cannot bank a long stretch nobody saw.
pub(super) const MAX_TICK_CREDIT_SEC: u64 = 5 * 60;

impl ActivityTracker {
    /// Seconds to credit for one tick: the awake time since the last credited tick, not
    /// an assumed SESSION_POLL_SEC.
    ///
    /// Sleep and hibernation are already left out by the clock (awake_clock), so a long
    /// tick is a slow one (a screenshot upload and a session check on a slow connection)
    /// and is credited in full. The ceiling used to be SESSION_POLL_SEC * 4 (20s),
    /// which silently dropped everything past it on exactly the machines that are slow.
    /// MAX_TICK_CREDIT_SEC only bounds a tracker that was frozen outright.
    pub(super) fn credited_seconds(elapsed: Duration) -> u64 {
        elapsed.as_secs().min(MAX_TICK_CREDIT_SEC)
    }

    /// The part of `elapsed` that was credited, so the caller can roll the remainder into
    /// the next tick instead of dropping it.
    pub(super) fn consumed_span(elapsed: Duration, credited: u64) -> Duration {
        let cap = Duration::from_secs(MAX_TICK_CREDIT_SEC);
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
    pub(super) fn tick_progress(&self, state: &mut TickState) -> bool {
        let task_id = &state.task_id.clone();
        let idle_time_disabled = state.idle_time_disabled;
        let idle_threshold_sec = state.idle_threshold_sec_for_project;
        let active_baseline = &state.active_baseline.clone();
        let idle_baseline = &state.idle_baseline.clone();
        let last_tick_at = &mut state.last_tick_at;
        let active_elapsed = &mut state.active_elapsed;
        let idle_elapsed = &mut state.idle_elapsed;
        let now = AwakeInstant::now();
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

    pub(super) fn set_task_progress(&self, task_id: &str, active_seconds: u64, idle_seconds: u64) {
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

    #[allow(clippy::too_many_arguments)]
    pub(super) fn reset_task_progress(&self, state: &mut TickState) {
        let task_id = &mut state.task_id;
        let last_tick_at = &mut state.last_tick_at;
        let active_baseline = &mut state.active_baseline;
        let active_elapsed = &mut state.active_elapsed;
        let idle_baseline = &mut state.idle_baseline;
        let idle_elapsed = &mut state.idle_elapsed;
        let idle_time_disabled = &mut state.idle_time_disabled;
        let idle_threshold_sec = &mut state.idle_threshold_sec_for_project;
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
        *last_tick_at = AwakeInstant::now();
        *self.task_progress.lock() = (None, 0, 0);
        *self.idle_stage.lock() = 0;
        *self.idle_stop.lock() = None;
        self.progress.clear();
    }

    /// The earliest point an idle stop may rewind to: the last real input this run saw, but
    /// never below what the session already held when the run picked it up.
    ///
    /// `active_at_last_input` starts at 0 on every run and is only raised by a tick that sees
    /// input. An agent that adopts an open session while nobody is at the machine - an update
    /// that restarted it overnight, a session left running over lunch - has seen no input
    /// yet, so the first idle check would rewind to 0 and post a stop that erases every hour
    /// the session had banked, booking them all as idle. Those hours were earned before this
    /// run began; it has no evidence they were idle, so it has no business reversing them.
    pub(super) fn rewind_floor(active_at_last_input: u64, active_baseline: u64) -> u64 {
        active_at_last_input.max(active_baseline)
    }

    /// The rewind arithmetic on its own, so it can be tested without a live session.
    pub(super) fn rewind_active(active_total: u64, active_at_last_input: u64) -> (u64, u64) {
        let rewound = active_at_last_input.min(active_total);
        (rewound, active_total.saturating_sub(rewound))
    }
}
