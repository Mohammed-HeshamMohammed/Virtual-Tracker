//! The clock the tracker credits time from: one that stops while the computer sleeps.
//!
//! `Instant` already behaves this way on macOS and Linux. On Windows it keeps counting
//! through sleep and hibernation, so a resumed laptop looked like one enormous tick, and
//! the only defence was a ceiling on how much one tick could credit. That ceiling also cut
//! honest ticks that were merely slow (a screenshot upload and a session check on a slow
//! connection), silently dropping the member's time. With sleep left out of the clock,
//! a long tick means the tracker was slow, not that nobody was there.

use std::ops::Sub;
use std::time::Duration;

/// A point on the awake-time clock.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct AwakeInstant(Duration);

impl AwakeInstant {
    pub fn now() -> Self {
        Self(awake_since_origin())
    }

    pub fn duration_since(&self, earlier: AwakeInstant) -> Duration {
        self.0.saturating_sub(earlier.0)
    }

    #[cfg(test)]
    pub fn elapsed(&self) -> Duration {
        Self::now().duration_since(*self)
    }
}

impl Sub<Duration> for AwakeInstant {
    type Output = AwakeInstant;

    fn sub(self, rhs: Duration) -> AwakeInstant {
        AwakeInstant(self.0.saturating_sub(rhs))
    }
}

/// Windows' interrupt time without the time spent asleep or hibernating, in 100 ns units.
/// In kernel32 since Windows 7, so the legacy build can use it too.
#[cfg(windows)]
fn awake_since_origin() -> Duration {
    #[link(name = "kernel32")]
    extern "system" {
        fn QueryUnbiasedInterruptTime(unbiased_time: *mut u64) -> i32;
    }
    let mut hundreds_of_ns: u64 = 0;
    // SAFETY: the pointer is to a live, writable u64, which is all the call writes.
    if unsafe { QueryUnbiasedInterruptTime(&mut hundreds_of_ns) } != 0 {
        return Duration::from_nanos(hundreds_of_ns.saturating_mul(100));
    }
    instant_since_origin()
}

#[cfg(not(windows))]
fn awake_since_origin() -> Duration {
    instant_since_origin()
}

fn instant_since_origin() -> Duration {
    static ORIGIN: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    ORIGIN.get_or_init(std::time::Instant::now).elapsed()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_forward_with_real_time() {
        let start = AwakeInstant::now();
        std::thread::sleep(Duration::from_millis(60));
        let elapsed = start.elapsed();
        assert!(elapsed >= Duration::from_millis(40), "only {elapsed:?} passed");
        assert!(elapsed < Duration::from_secs(5));
    }

    #[test]
    fn subtracting_never_goes_below_the_origin() {
        let point = AwakeInstant(Duration::from_secs(1));
        assert_eq!(point - Duration::from_secs(5), AwakeInstant(Duration::ZERO));
        // An earlier point "since" a later one is zero, not a panic.
        assert_eq!(point.duration_since(AwakeInstant(Duration::from_secs(9))), Duration::ZERO);
    }
}
