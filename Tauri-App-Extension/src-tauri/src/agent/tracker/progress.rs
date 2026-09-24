//! Crediting elapsed time to active or idle, and the baselines it is measured
//! against.

use super::*;

impl ActivityTracker {
    /// Seconds to credit for one tick: real elapsed wall time since the last credited
    /// tick, not an assumed SESSION_POLL_SEC.
    ///
    /// Clamped to `SESSION_POLL_SEC * 4` on purpose: a sleep/hibernate gap makes the
    /// real elapsed time huge, and that must never be banked as active work. A resumed
    /// laptop credits at most this, then idle escalation takes over and rewinds to the
    /// last real input - which is the correct outcome for a suspend, not a fabricated
    /// block of "active" time in a single tick.
    pub(super) fn credited_seconds(elapsed: Duration) -> u64 {
        elapsed.as_secs().min(SESSION_POLL_SEC * 4)
    }

    /// The part of `elapsed` that was credited, so the caller can roll the remainder into
    /// the next tick instead of dropping it.
    pub(super) fn consumed_span(elapsed: Duration, credited: u64) -> Duration {
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
    pub(super) fn tick_progress(&self, state: &mut TickState) -> bool {
        let task_id = &state.task_id.clone();
        let idle_time_disabled = state.idle_time_disabled;
        let idle_threshold_sec = state.idle_threshold_sec_for_project;
        let active_baseline = &state.active_baseline.clone();
        let idle_baseline = &state.idle_baseline.clone();
        let last_tick_at = &mut state.last_tick_at;
        let active_elapsed = &mut state.active_elapsed;
        let idle_elapsed = &mut state.idle_elapsed;
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
        *last_tick_at = Instant::now();
        *self.task_progress.lock() = (None, 0, 0);
        *self.idle_stage.lock() = 0;
        self.progress.clear();
    }

    /// The rewind arithmetic on its own, so it can be tested without a live session.
    pub(super) fn rewind_active(active_total: u64, active_at_last_input: u64) -> (u64, u64) {
        let rewound = active_at_last_input.min(active_total);
        (rewound, active_total.saturating_sub(rewound))
    }
}
