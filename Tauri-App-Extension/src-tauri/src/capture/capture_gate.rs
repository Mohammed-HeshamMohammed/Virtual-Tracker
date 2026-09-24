//! Whether capture is allowed right now, and why not.
//!
//! Work-hour boundaries are decided by the server, which already owns the
//! member's timezone and DST rules. A privacy break is decided here, because
//! the member presses the button in this app and it has to take effect before
//! the next poll rather than after it.

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureBlock {
    Allowed,
    OutsideWorkHours,
    OnBreak,
}

impl CaptureBlock {
    pub fn message(self) -> Option<&'static str> {
        match self {
            CaptureBlock::Allowed => None,
            CaptureBlock::OutsideWorkHours => Some("Outside your work hours - nothing is being captured."),
            CaptureBlock::OnBreak => Some("Private break - nothing is being captured."),
        }
    }
}

#[derive(Default)]
pub struct CaptureGate {
    outside_work_hours: AtomicBool,
    /// Unix ms, 0 when no break is running.
    break_until_ms: AtomicI64,
}

pub fn now_plus_minutes_ms(minutes: u32) -> i64 {
    now_ms() + i64::from(minutes) * 60_000
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl CaptureGate {
    pub fn apply(&self, outside_work_hours: bool, break_until_ms: i64) {
        self.outside_work_hours.store(outside_work_hours, Ordering::Relaxed);
        self.break_until_ms.store(break_until_ms, Ordering::Relaxed);
    }

    pub fn set_break(&self, until_ms: i64) {
        self.break_until_ms.store(until_ms.max(0), Ordering::Relaxed);
    }

    pub fn state(&self) -> CaptureBlock {
        // The break outranks the schedule: a member who asked for privacy gets
        // it whether or not they are inside their hours.
        if self.break_until_ms.load(Ordering::Relaxed) > now_ms() {
            return CaptureBlock::OnBreak;
        }
        if self.outside_work_hours.load(Ordering::Relaxed) {
            return CaptureBlock::OutsideWorkHours;
        }
        CaptureBlock::Allowed
    }

    pub fn blocked(&self) -> bool {
        self.state() != CaptureBlock::Allowed
    }

    pub fn break_until_ms(&self) -> i64 {
        let until = self.break_until_ms.load(Ordering::Relaxed);
        if until > now_ms() { until } else { 0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_configured_allows_capture() {
        assert_eq!(CaptureGate::default().state(), CaptureBlock::Allowed);
    }

    #[test]
    fn the_server_verdict_blocks_capture() {
        let gate = CaptureGate::default();
        gate.apply(true, 0);
        assert_eq!(gate.state(), CaptureBlock::OutsideWorkHours);
        gate.apply(false, 0);
        assert_eq!(gate.state(), CaptureBlock::Allowed);
    }

    #[test]
    fn a_break_takes_effect_without_waiting_for_a_poll() {
        let gate = CaptureGate::default();
        gate.set_break(now_ms() + 60_000);
        assert_eq!(gate.state(), CaptureBlock::OnBreak);
    }

    #[test]
    fn a_break_outranks_being_inside_work_hours() {
        let gate = CaptureGate::default();
        gate.apply(false, now_ms() + 60_000);
        assert_eq!(gate.state(), CaptureBlock::OnBreak);
    }

    #[test]
    fn an_expired_break_clears_itself_with_nobody_clearing_it() {
        let gate = CaptureGate::default();
        gate.set_break(now_ms() - 1);
        assert_eq!(gate.state(), CaptureBlock::Allowed);
        assert_eq!(gate.break_until_ms(), 0);
    }

    #[test]
    fn an_expired_break_still_leaves_the_schedule_in_force() {
        let gate = CaptureGate::default();
        gate.apply(true, now_ms() - 1);
        assert_eq!(gate.state(), CaptureBlock::OutsideWorkHours);
    }

    #[test]
    fn ending_a_break_is_expressed_as_zero() {
        let gate = CaptureGate::default();
        gate.set_break(now_ms() + 60_000);
        gate.set_break(0);
        assert_eq!(gate.state(), CaptureBlock::Allowed);
    }

    #[test]
    fn only_a_blocked_state_reports_a_message() {
        assert!(CaptureBlock::Allowed.message().is_none());
        assert!(CaptureBlock::OnBreak.message().is_some());
        assert!(CaptureBlock::OutsideWorkHours.message().is_some());
    }
}
