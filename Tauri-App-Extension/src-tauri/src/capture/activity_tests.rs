//! Tests for activity.rs.

#[allow(unused_imports)]
use super::*;

#[cfg(test)]
mod tests {
    use super::*;

    // Pure scoring/window logic - platform-independent, no hook needed.

    fn keydown(meter: &ActivityMeter, vk_code: u32) {
        meter.on_keyboard_input(vk_code, false);
    }

    #[test]
    fn floor_score_with_no_input_at_all() {
        let meter = ActivityMeter::new();
        assert_eq!(meter.score(), ACTIVITY_MIN_SCORE);
    }

    #[test]
    fn score_rises_with_varied_keyboard_input() {
        let meter = ActivityMeter::new();
        for i in 0..20u32 {
            keydown(&meter, i); // 20 distinct keys - real varied typing
        }
        let score = meter.score();
        assert!(score > ACTIVITY_MIN_SCORE, "expected a real score, got {score}");
        assert!(score < 100, "20 keystrokes should not already saturate");
    }

    /// Pushes `count` irregularly-spaced timestamps (never a uniform interval) directly
    /// into the meter's cadence buffer, bypassing real wall-clock timing entirely.
    fn seed_irregular_timestamps(meter: &ActivityMeter, count: u64) {
        let mut timestamps = meter.key_timestamps_ms.lock();
        let mut t = 0u64;
        for i in 0..count {
            t += 40 + (i % 7) * 15;
            timestamps.push(t);
        }
    }

    #[test]
    fn score_saturates_at_100_not_higher() {
        let meter = ActivityMeter::new();
        for i in 0..60u32 {
            meter.distinct_keys.lock().insert(i);
        }
        seed_irregular_timestamps(&meter, 30);
        meter.keyboard_count.store(60, Ordering::Relaxed);
        assert_eq!(meter.score(), 100);
    }

    #[test]
    fn keyboard_outweighs_mouse_click_which_outweighs_mouse_move() {
        // Below CADENCE_MIN_SAMPLES on purpose - isolates pure per-type weight comparison
        // from the cadence signal, which is its own, separately-tested thing.
        let a = ActivityMeter::new();
        for i in 0..5u32 {
            keydown(&a, i);
        }
        let b = ActivityMeter::new();
        for _ in 0..5 {
            b.on_mouse_click(false);
        }
        let c = ActivityMeter::new();
        for i in 0..5 {
            c.on_mouse_move(false, i, i);
        }
        assert!(a.score() > b.score(), "5 varied keystrokes must outscore 5 clicks");
        assert!(b.score() > c.score(), "5 clicks must outscore 5 mouse moves");
    }

    #[test]
    fn hammering_one_key_scores_lower_than_the_same_count_of_varied_keys() {
        let macro_like = ActivityMeter::new();
        for _ in 0..40 {
            keydown(&macro_like, 65); // always the same key - "200 presses of the same key is a macro"
        }
        let varied = ActivityMeter::new();
        for i in 0..40u32 {
            keydown(&varied, i % 15); // 15 distinct keys across 40 presses
        }
        assert!(
            macro_like.score() < varied.score(),
            "same-key hammering ({}) must score below varied typing ({})",
            macro_like.score(),
            varied.score()
        );
    }

    #[test]
    fn perfectly_even_keystroke_timing_is_penalized() {
        let meter = ActivityMeter::new();
        // Manufacture perfectly even 50ms-spaced timestamps directly - real hook delivery
        // timing can't be controlled from a unit test, but the penalty this feeds is
        {
            let mut timestamps = meter.key_timestamps_ms.lock();
            for i in 0..15u64 {
                timestamps.push(i * 50);
            }
        }
        for i in 0..15u32 {
            meter.distinct_keys.lock().insert(i); // varied keys - isolate cadence's effect alone
        }
        meter.keyboard_count.store(15, Ordering::Relaxed);
        let multiplier = meter.keyboard_quality_multiplier(15);
        assert_eq!(multiplier, CADENCE_MACHINE_PENALTY, "perfectly even spacing must hit the machine-cadence penalty");
    }

    #[test]
    fn irregular_keystroke_timing_is_not_penalized() {
        let meter = ActivityMeter::new();
        {
            let mut timestamps = meter.key_timestamps_ms.lock();
            for t in [0u64, 40, 220, 260, 500, 510, 800, 1200, 1210, 1600, 2200, 2210] {
                timestamps.push(t);
            }
        }
        for i in 0..12u32 {
            meter.distinct_keys.lock().insert(i);
        }
        meter.keyboard_count.store(12, Ordering::Relaxed);
        let multiplier = meter.keyboard_quality_multiplier(12);
        assert_eq!(multiplier, 1.0, "human-irregular timing must not be penalized");
    }

    #[test]
    fn a_held_navigation_key_still_gets_some_credit() {
        // MIN_DISTINCT_KEY_RATIO's floor - a single legitimately-held key (arrow key,
        // backspace) must not drop to near-zero.
        let meter = ActivityMeter::new();
        meter.distinct_keys.lock().insert(8); // backspace - the only key struck
        seed_irregular_timestamps(&meter, 15);
        let multiplier = meter.keyboard_quality_multiplier(40);
        assert!(
            (multiplier - MIN_DISTINCT_KEY_RATIO).abs() < 1e-9,
            "a single held key must land exactly at the distinct-ratio floor, got {multiplier}"
        );
    }

    #[test]
    fn cadence_is_not_judged_on_too_few_samples() {
        let meter = ActivityMeter::new();
        // 3 keystrokes, perfectly even - below CADENCE_MIN_SAMPLES, must not be penalized.
        {
            let mut timestamps = meter.key_timestamps_ms.lock();
            timestamps.push(0);
            timestamps.push(50);
            timestamps.push(100);
        }
        // 3 distinct keys matching the count, so the distinct-ratio term is 1.0 and this
        // isolates cadence's effect alone.
        for i in 0..3u32 {
            meter.distinct_keys.lock().insert(i);
        }
        assert_eq!(meter.keyboard_quality_multiplier(3), 1.0);
    }

    #[test]
    fn injected_fraction_is_none_with_no_input() {
        let meter = ActivityMeter::new();
        assert_eq!(meter.injected_fraction(), None);
    }

    #[test]
    fn injected_fraction_is_zero_when_input_is_all_real() {
        let meter = ActivityMeter::new();
        meter.on_mouse_click(false);
        meter.on_mouse_click(false);
        assert_eq!(meter.injected_fraction(), Some(0.0));
    }

    #[test]
    fn injected_fraction_reflects_a_pure_jiggler() {
        // "100% active but ~100% injected" is the anti-cheat tell this exists for.
        let meter = ActivityMeter::new();
        for i in 0..10 {
            meter.on_mouse_move(true, i, i);
        }
        assert_eq!(meter.injected_fraction(), Some(1.0));
    }

    #[test]
    fn injected_fraction_is_a_mix_across_input_types() {
        let meter = ActivityMeter::new();
        keydown(&meter, 1);
        meter.on_mouse_click(false);
        meter.on_mouse_move(false, 0, 0);
        meter.on_mouse_move(true, 1, 1);
        assert_eq!(meter.injected_fraction(), Some(0.25));
    }

    #[test]
    fn reset_clears_every_counter_not_just_the_score() {
        let meter = ActivityMeter::new();
        keydown(&meter, 1);
        meter.on_mouse_click(true);
        meter.reset();
        assert_eq!(meter.injected_fraction(), None, "reset must not leave a stale injected fraction behind");
        assert_eq!(meter.score(), ACTIVITY_MIN_SCORE);
        assert!(meter.distinct_keys.lock().is_empty());
        assert!(meter.key_timestamps_ms.lock().is_empty());
        meter.on_mouse_move(false, 0, 0);
        meter.on_mouse_move(false, 10, 0);
        meter.reset();
        assert_eq!(meter.signal_snapshot().mouse_distance_px, 0, "reset must clear accumulated mouse distance too");
    }

    #[test]
    fn mouse_move_accumulates_euclidean_distance_not_raw_event_count() {
        let meter = ActivityMeter::new();
        meter.on_mouse_move(false, 0, 0); // first move: sets baseline, contributes no distance
        meter.on_mouse_move(false, 3, 4); // classic 3-4-5 triangle
        meter.on_mouse_move(false, 3, -4); // back down 8px in y
        assert_eq!(meter.signal_snapshot().mouse_distance_px, 13, "5px diagonal + 8px vertical = 13px");
    }

    #[test]
    fn signal_snapshot_reports_the_raw_counters_score_is_built_from() {
        let meter = ActivityMeter::new();
        keydown(&meter, 1);
        keydown(&meter, 2);
        meter.on_mouse_click(true);
        let signal = meter.signal_snapshot();
        assert_eq!(signal.keystroke_count, 2);
        assert_eq!(signal.distinct_key_count, 2);
        assert_eq!(signal.injected_event_count, 1);
    }

    // Idle used to read only the hook-fed timestamp, so a hook Windows silently removed
    // froze it and the session stopped and rewound while the member was typing.
    #[test]
    fn the_os_idle_query_answers_on_windows_and_is_absent_elsewhere() {
        let answer = system_idle_seconds();
        if ActivityMeter::HOOKS_SUPPORTED {
            let seconds = answer.expect("GetLastInputInfo must answer on Windows");
            assert!(seconds < 60 * 60 * 24 * 365, "implausible idle reading: {seconds}s");
        } else {
            assert_eq!(answer, None);
        }
    }

    #[test]
    fn a_frozen_hook_timestamp_cannot_by_itself_report_idle() {
        let meter = ActivityMeter::new();
        // The hooks last saw input an hour ago - the state Windows leaves behind when it
        // drops a slow low-level hook without telling anyone.
        meter
            .last_input_ms
            .store(now_ms().saturating_sub(60 * 60 * 1000), Ordering::Relaxed);
        // ...while the OS knows somebody typed two seconds ago.
        override_system_idle_for_test(Some(2));

        assert_eq!(
            meter.idle_seconds(),
            2,
            "the OS reading must win; a dead hook used to stop the session and rewind the clock",
        );
        assert!(meter.hooks_look_dead(), "and the disagreement is detectable");

        override_system_idle_for_test(None);
    }

    #[test]
    fn a_genuinely_idle_machine_still_reports_idle() {
        let meter = ActivityMeter::new();
        meter
            .last_input_ms
            .store(now_ms().saturating_sub(600 * 1000), Ordering::Relaxed);
        override_system_idle_for_test(Some(600));

        assert_eq!(meter.idle_seconds(), 600, "both sources agree nobody is here");
        assert!(!meter.hooks_look_dead(), "agreeing sources are not a dead hook");

        override_system_idle_for_test(None);
    }

    // Either source seeing input is enough - the smaller reading wins.
    #[test]
    fn live_hooks_win_when_the_os_reading_is_the_staler_one() {
        let meter = ActivityMeter::new();
        meter.last_input_ms.store(now_ms(), Ordering::Relaxed);
        override_system_idle_for_test(Some(300));

        assert!(meter.idle_seconds() <= 1);

        override_system_idle_for_test(None);
    }

    #[test]
    fn hooks_reporting_normally_are_not_flagged_as_dead() {
        let meter = ActivityMeter::new();
        meter.last_input_ms.store(now_ms(), Ordering::Relaxed);
        override_system_idle_for_test(Some(0));
        assert!(!meter.hooks_look_dead());
        override_system_idle_for_test(None);
    }

    #[test]
    fn idle_seconds_is_near_zero_right_after_input() {
        let meter = ActivityMeter::new();
        meter.on_mouse_click(false);
        assert!(meter.idle_seconds() <= 1);
    }

    #[test]
    fn stop_without_start_never_panics() {
        // CQ-1: must be safe to call on a meter that was never started (e.g.
        let meter = ActivityMeter::new();
        meter.stop();
    }
}
