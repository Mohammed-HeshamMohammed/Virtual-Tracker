//! When a break has gone on long enough to end by itself.
//!
//! The limit is the project's (`break_time_seconds`), with the project's switch
//! removing it. It is held here rather than in the tick's own state because the
//! controller needs it too - a private break's length is clamped to it before the
//! break starts, and that happens outside the tick loop.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

pub const MIN_BREAK_LIMIT_SEC: u64 = 60;
pub const MAX_BREAK_LIMIT_SEC: u64 = 8 * 60 * 60;
pub const DEFAULT_BREAK_LIMIT_SEC: u64 = 600;

#[derive(Default)]
pub struct BreakState {
    /// 0 means no limit: the project's switch is on, or nothing is being tracked.
    limit_sec: AtomicU64,
    started_at: Mutex<Option<Instant>>,
    /// The break began as a private break, so it also ends when that does.
    private: AtomicBool,
}

impl BreakState {
    pub fn set_limit(&self, disabled: bool, seconds: u64) {
        let limit = if disabled { 0 } else { seconds.clamp(MIN_BREAK_LIMIT_SEC, MAX_BREAK_LIMIT_SEC) };
        self.limit_sec.store(limit, Ordering::Relaxed);
    }

    /// Nothing is being tracked, so there is no project whose limit applies.
    pub fn clear_limit(&self) {
        self.limit_sec.store(0, Ordering::Relaxed);
    }

    pub fn limit_sec(&self) -> u64 {
        self.limit_sec.load(Ordering::Relaxed)
    }

    pub fn begin(&self) {
        *self.started_at.lock() = Some(Instant::now());
    }

    #[cfg(test)]
    pub fn backdate(&self, by: Duration) {
        *self.started_at.lock() = Some(Instant::now() - by);
    }

    pub fn mark_private(&self) {
        self.private.store(true, Ordering::Relaxed);
    }

    pub fn end(&self) {
        *self.started_at.lock() = None;
        self.private.store(false, Ordering::Relaxed);
    }

    /// Whole minutes, rounded down, so a private break can never outlast the limit
    /// and leave capture blocked after the timer has resumed.
    pub fn clamp_minutes(&self, minutes: u32) -> u32 {
        match self.limit_sec() {
            0 => minutes,
            limit => minutes.min(((limit / 60) as u32).max(1)),
        }
    }

    pub fn is_over(&self, private_break_running: bool) -> bool {
        let Some(started) = *self.started_at.lock() else {
            return false;
        };
        if self.private.load(Ordering::Relaxed) && !private_break_running {
            return true;
        }
        match self.limit_sec() {
            0 => false,
            limit => started.elapsed() >= Duration::from_secs(limit),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn started(limit_sec: u64) -> BreakState {
        let state = BreakState::default();
        state.set_limit(false, limit_sec);
        state.begin();
        state
    }

    fn backdated(state: &BreakState, by: Duration) {
        state.backdate(by);
    }

    #[test]
    fn a_break_is_not_over_before_its_limit() {
        let state = started(600);
        backdated(&state, Duration::from_secs(599));
        assert!(!state.is_over(false));
    }

    #[test]
    fn a_break_ends_at_its_limit() {
        let state = started(600);
        backdated(&state, Duration::from_secs(600));
        assert!(state.is_over(false));
    }

    #[test]
    fn the_switch_removes_the_limit() {
        let state = BreakState::default();
        state.set_limit(true, 600);
        state.begin();
        backdated(&state, Duration::from_secs(3 * 3600));
        assert!(!state.is_over(false));
        assert_eq!(state.limit_sec(), 0);
    }

    #[test]
    fn no_break_is_never_over() {
        let state = BreakState::default();
        state.set_limit(false, 60);
        assert!(!state.is_over(false));
    }

    #[test]
    fn a_private_break_ends_with_its_private_break() {
        let state = started(600);
        state.mark_private();
        assert!(!state.is_over(true), "still running: the timer stays paused");
        assert!(state.is_over(false), "ended or expired: the timer resumes");
    }

    #[test]
    fn a_plain_pause_ignores_the_private_break() {
        let state = started(600);
        assert!(!state.is_over(false));
    }

    #[test]
    fn ending_a_break_forgets_that_it_was_private() {
        let state = started(600);
        state.mark_private();
        state.end();
        state.begin();
        assert!(!state.is_over(false));
    }

    #[test]
    fn the_limit_is_held_between_a_minute_and_eight_hours() {
        let state = BreakState::default();
        state.set_limit(false, 5);
        assert_eq!(state.limit_sec(), 60);
        state.set_limit(false, 999_999);
        assert_eq!(state.limit_sec(), 8 * 3600);
    }

    #[test]
    fn a_private_break_is_clamped_down_to_the_limit_and_never_up() {
        let state = BreakState::default();
        state.set_limit(false, 600);
        assert_eq!(state.clamp_minutes(60), 10);
        assert_eq!(state.clamp_minutes(5), 5);
        state.set_limit(false, 90);
        assert_eq!(state.clamp_minutes(30), 1, "rounded down, never past the limit");
        state.set_limit(true, 600);
        assert_eq!(state.clamp_minutes(240), 240);
        state.clear_limit();
        assert_eq!(state.clamp_minutes(240), 240);
    }
}
