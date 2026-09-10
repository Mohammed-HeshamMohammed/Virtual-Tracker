use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;

use crate::constants::{
    ACTIVITY_MIN_SCORE, ACTIVITY_SATURATION_EVENTS, ACTIVITY_WINDOW_MS, CADENCE_MACHINE_PENALTY,
    CADENCE_MACHINE_STDDEV_MS, CADENCE_MIN_SAMPLES, CADENCE_SAMPLE_SIZE, KEYBOARD_INPUT_WEIGHT,
    MIN_DISTINCT_KEY_RATIO, MOUSE_CLICK_WEIGHT, MOUSE_MOVE_WEIGHT,
};
use crate::types::ActivitySignal;

/// Minimum gap between two counted mouse-MOVE events. A low-level hook fires
/// on every OS-level pixel delta - during a fast drag that can be hundreds of
/// events/second, which would swamp the scoring window and pin activity to
/// 100% from movement alone (worse than the old 100ms-poll behaviour this
/// replaces). Keyboard and mouse *clicks* are never throttled - only
/// continuous movement is. ponytail: a flat throttle, not full path-entropy
/// analysis ("straight-line/looping = automated") - upgrade there if a
/// jiggler using large, slow, human-speed movements ever shows up in
/// practice; the OS injected-flag (AC-1) already catches the common case.
// Windows-only: its one use site is inside the #[cfg(windows)] mouse-hook
// callback below - there's no macOS/Linux input-hook implementation yet for
// this to throttle.
#[cfg(windows)]
const MOUSE_MOVE_MIN_INTERVAL_MS: u64 = 50;

/// Rolling mouse/keyboard activity score (0-100). ACT-2: weighted by input
/// *type* (keyboard > click > move) and keystroke *quality* (distinct keys,
/// human-irregular cadence), not a flat event count - see `score()`. Also
/// tracks ACT-1/AC-1's injected-vs-hardware split for jiggler/auto-clicker
/// detection.
pub struct ActivityMeter {
    keyboard_count: AtomicU64,
    click_count: AtomicU64,
    move_count: AtomicU64,
    /// ACT-1/AC-1: how many of the counted inputs in the current window were
    /// flagged by the OS as synthetically generated (SendInput and
    /// equivalent) rather than from real hardware. The single strongest
    /// anti-cheat signal available almost for free once real hooks exist.
    injected_count: AtomicU64,
    /// ACT-2: distinct virtual-key codes seen this window - "200 presses of
    /// the same key is a macro" needs to know how many *different* keys were
    /// struck, not just how many keydowns fired.
    distinct_keys: Mutex<HashSet<u32>>,
    /// ACT-2: recent keydown timestamps (capped ring), used to judge
    /// cadence - "perfectly even spacing is a macro; human timing is
    /// irregular."
    key_timestamps_ms: Mutex<Vec<u64>>,
    /// ACT-4: last observed cursor position, used to accumulate real
    /// on-screen travel distance rather than a raw move-event count (which
    /// MOUSE_MOVE_MIN_INTERVAL_MS already throttles and so undercounts fast
    /// drags). `None` right after a window roll, so the first move of a new
    /// window contributes no distance instead of a bogus jump from stale
    /// coordinates.
    last_mouse_pos: Mutex<Option<(i32, i32)>>,
    mouse_distance_px: Mutex<f64>,
    window_start_ms: AtomicU64,
    /// ACT-3: server-tunable calibration, defaulted to the compile-time
    /// constants and overwritten by `apply_scoring_settings` on the
    /// tracker's periodic poll - see `agent::tracker::maybe_refresh_activity_scoring`.
    saturation_events: AtomicU64,
    window_ms: AtomicU64,
    started: AtomicBool,
    /// Timestamp of the last observed mouse/keyboard input, independent of the
    /// scoring window above - used to tell the tracker "no input for N
    /// seconds" so it can count idle vs. active seconds honestly instead of
    /// treating every tick as active just because a session is open.
    last_input_ms: AtomicU64,
    /// MOUSE_MOVE_MIN_INTERVAL_MS's own throttle state - Windows-only for the
    /// same reason that constant is, see its doc comment.
    #[cfg(windows)]
    last_mouse_move_ms: AtomicU64,
    #[cfg(not(windows))]
    _last_mouse_move_ms: AtomicU64,
    /// CQ-1: OS thread ID the input hooks are installed on (0 = not
    /// running). `stop()` posts WM_QUIT to this thread to unblock its
    /// message loop and unregister the hooks cleanly - required now that
    /// ACT-1 uses real system-wide hooks, which must not outlive the tracker
    /// (a leaked low-level hook is a system-wide problem, not just this
    /// process's).
    #[cfg(windows)]
    hook_thread_id: AtomicU32,
    #[cfg(not(windows))]
    _hook_thread_id: AtomicU32,
    /// CQ-1: handle to the spawned hook-listener thread. `stop()` joins this
    /// (bounded) before returning, so a fast stop()-then-start() can never
    /// spawn a new hook thread while the old one's own cleanup - which
    /// zeroes METER_FOR_HOOK - is still running. See `join_hook_thread`.
    hook_thread_handle: Mutex<Option<std::thread::JoinHandle<()>>>,
}

/// Seconds since the last input the OS itself recorded for this session, or
/// `None` where there is no such query (non-Windows, or the call failed).
///
/// `GetLastInputInfo` reports a tick count, which wraps roughly every 49.7
/// days of uptime. `GetTickCount64` does not, so the subtraction is done in
/// 64-bit and the 32-bit reading is widened against it - otherwise a machine
/// up longer than that would report a nonsense idle time exactly once per wrap
/// and stop a session for no reason.
/// Tests need to simulate a machine nobody is touching, which the real query
/// cannot do - the machine running the suite is, by definition, in use.
///
/// Thread-local, not a static: `cargo test` runs tests in parallel, and a
/// process-wide override let one test's simulated idle leak into another that
/// wanted the real reading. Each test thread now gets its own answer.
#[cfg(test)]
thread_local! {
    static TEST_IDLE_OVERRIDE_SEC: std::cell::Cell<Option<u64>> = const { std::cell::Cell::new(None) };
}

/// Pretend the OS reports this many seconds of idle on this thread. `None`
/// restores the real query. Test-only.
#[cfg(test)]
pub fn override_system_idle_for_test(seconds: Option<u64>) {
    TEST_IDLE_OVERRIDE_SEC.with(|cell| cell.set(seconds));
}

#[cfg(test)]
fn test_idle_override() -> Option<u64> {
    TEST_IDLE_OVERRIDE_SEC.with(|cell| cell.get())
}

#[cfg(windows)]
fn system_idle_seconds() -> Option<u64> {
    #[cfg(test)]
    if let Some(seconds) = test_idle_override() {
        return Some(seconds);
    }

    use windows::Win32::System::SystemInformation::GetTickCount64;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    // SAFETY: `info` is a correctly sized, fully initialised LASTINPUTINFO,
    // and the call only writes `dwTime`.
    if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        return None;
    }
    let now = unsafe { GetTickCount64() };
    // Widen the 32-bit reading into the same era as `now`.
    let last = (now & !0xFFFF_FFFF) | u64::from(info.dwTime);
    let last = if last > now { last - 0x1_0000_0000 } else { last };
    Some(now.saturating_sub(last) / 1000)
}

#[cfg(not(windows))]
fn system_idle_seconds() -> Option<u64> {
    #[cfg(test)]
    if let Some(seconds) = test_idle_override() {
        return Some(seconds);
    }
    None
}

impl ActivityMeter {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            keyboard_count: AtomicU64::new(0),
            click_count: AtomicU64::new(0),
            move_count: AtomicU64::new(0),
            injected_count: AtomicU64::new(0),
            distinct_keys: Mutex::new(HashSet::new()),
            key_timestamps_ms: Mutex::new(Vec::with_capacity(CADENCE_SAMPLE_SIZE)),
            last_mouse_pos: Mutex::new(None),
            mouse_distance_px: Mutex::new(0.0),
            window_start_ms: AtomicU64::new(now_ms()),
            saturation_events: AtomicU64::new(ACTIVITY_SATURATION_EVENTS),
            window_ms: AtomicU64::new(ACTIVITY_WINDOW_MS),
            started: AtomicBool::new(false),
            last_input_ms: AtomicU64::new(now_ms()),
            #[cfg(windows)]
            last_mouse_move_ms: AtomicU64::new(0),
            #[cfg(not(windows))]
            _last_mouse_move_ms: AtomicU64::new(0),
            #[cfg(windows)]
            hook_thread_id: AtomicU32::new(0),
            #[cfg(not(windows))]
            _hook_thread_id: AtomicU32::new(0),
            hook_thread_handle: Mutex::new(None),
        })
    }

    pub fn start(self: &Arc<Self>) {
        if self
            .started
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        let meter = Arc::clone(self);
        if let Ok(handle) = std::thread::Builder::new()
            .name("vt-activity-meter".into())
            .spawn(move || meter.run_listeners())
        {
            *self.hook_thread_handle.lock() = Some(handle);
        }
    }

    /// ID-5: reinstall the input hooks if Windows has removed them behind our
    /// back.
    ///
    /// Idle time no longer depends on the hooks (see `idle_seconds`), so a
    /// dead hook can no longer stop a session - but it does flatten the
    /// activity *score*, which is built from per-event counts the OS-level
    /// query cannot provide. A member typing normally would score at the floor
    /// and look disengaged. Tearing the thread down and starting it again
    /// re-runs `SetWindowsHookExW`.
    ///
    /// Cheap enough to call on a schedule: the check is two atomic loads and
    /// one `GetLastInputInfo`, and it does nothing at all unless the two
    /// disagree.
    pub fn restart_hooks_if_dead(self: &Arc<Self>) -> bool {
        if !Self::HOOKS_SUPPORTED || !self.hooks_look_dead() {
            return false;
        }
        log::warn!(
            "Input hooks stopped reporting while the OS still sees input - Windows most likely              dropped them for missing LowLevelHooksTimeout. Reinstalling; idle time was unaffected."
        );
        self.stop();
        self.start();
        true
    }

    /// CQ-1: unregisters the OS-level hooks and blocks (bounded) until the
    /// hook thread has actually exited before returning. Safe to call even
    /// if start() was never called or the thread already exited -
    /// `hook_thread_id`/`hook_thread_handle` are 0/None in both cases and
    /// this is a no-op.
    pub fn stop(&self) {
        self.started.store(false, Ordering::SeqCst);
        #[cfg(windows)]
        {
            let thread_id = self.hook_thread_id.swap(0, Ordering::SeqCst);
            if thread_id != 0 {
                use windows::Win32::Foundation::{LPARAM, WPARAM};
                use windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};
                unsafe {
                    let _ = PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
                }
            }
        }
        self.join_hook_thread();
    }

    /// Blocks until the hook thread (if any) has exited, up to a few
    /// seconds. This is the fix for the race where `stop()` used to return
    /// immediately after posting WM_QUIT: `start()` could then spawn a new
    /// hook thread before the old one had unregistered its hooks and zeroed
    /// `METER_FOR_HOOK`/`hook_thread_id`, so the old thread's cleanup could
    /// stomp on the new thread's state and leave input hooks permanently
    /// dead with nothing logged.
    ///
    /// `std::thread::JoinHandle` has no built-in timed join, so this joins
    /// on a small watcher thread instead and gives up (without blocking
    /// forever) if the hook thread doesn't exit in time - the watcher thread
    /// itself is then simply leaked to finish the join on its own.
    fn join_hook_thread(&self) {
        let Some(handle) = self.hook_thread_handle.lock().take() else {
            return;
        };
        let (tx, rx) = std::sync::mpsc::channel();
        let spawned = std::thread::Builder::new()
            .name("vt-activity-meter-join".into())
            .spawn(move || {
                let _ = handle.join();
                let _ = tx.send(());
            });
        if spawned.is_ok() && rx.recv_timeout(std::time::Duration::from_secs(3)).is_err() {
            log::warn!("Hook thread did not exit within the shutdown grace period");
        }
    }

    #[cfg(windows)]
    fn run_listeners(&self) {
        use windows::Win32::Foundation::HINSTANCE;
        use windows::Win32::System::Threading::GetCurrentThreadId;
        use windows::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
            UnhookWindowsHookEx, MSG, WH_KEYBOARD_LL, WH_MOUSE_LL,
        };

        // SAFETY: METER_FOR_HOOK is set once, immediately before installing
        // the hooks, and only ever read from the two hook callbacks below
        // (which only run on this same thread's message loop while the hooks
        // are installed) - never mutated concurrently with a read.
        METER_FOR_HOOK.store(self as *const ActivityMeter as usize, Ordering::SeqCst);

        // Low-level hooks are process-thread-scoped and require the
        // installing thread to pump messages for callbacks to fire at all -
        // this is not optional infrastructure, it's how WH_*_LL delivery
        // works. hmod is None: the hook procs are compiled into this binary,
        // not a separate DLL.
        let keyboard_hook = unsafe {
            SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), HINSTANCE::default(), 0)
        };
        let mouse_hook = unsafe {
            SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), HINSTANCE::default(), 0)
        };

        let (keyboard_hook, mouse_hook) = match (keyboard_hook, mouse_hook) {
            (Ok(k), Ok(m)) => (k, m),
            _ => {
                log::error!("Failed to install global input hooks; activity score stays at floor");
                METER_FOR_HOOK.store(0, Ordering::SeqCst);
                return;
            }
        };

        self.hook_thread_id
            .store(unsafe { GetCurrentThreadId() }, Ordering::SeqCst);

        let mut msg = MSG::default();
        // Blocks until a message arrives - stop() unblocks this by posting
        // WM_QUIT to this exact thread id. GetMessageW returns false (0) on
        // WM_QUIT or a real error; either way, exit the loop and clean up.
        while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }

        unsafe {
            let _ = UnhookWindowsHookEx(keyboard_hook);
            let _ = UnhookWindowsHookEx(mouse_hook);
        }
        METER_FOR_HOOK.store(0, Ordering::SeqCst);
        self.hook_thread_id.store(0, Ordering::SeqCst);
    }

    #[cfg(not(windows))]
    fn run_listeners(&self) {
        // macOS equivalent is CGEventTap (kCGSessionEventTap) with a
        // CFRunLoop on this thread and kCGEventSourceStateID to distinguish
        // hardware from synthetic input - deliberately not implemented here.
        // Unlike the NSWorkspace/CGWindowListCopyWindowInfo calls in
        // window.rs (one-shot queries reusing an already-integrated,
        // already-verified crate), a correct CGEventTap needs persistent
        // run-loop and callback-lifetime management that is easy to get
        // subtly wrong and impossible to verify without real macOS hardware
        // - shipping that blind is worse than an honestly-flagged gap.
        // Activity stays at floor until a real Mac is available to build
        // and test this against.
    }

    // note_input through on_mouse_move: real production callers are the
    // #[cfg(windows)] hook callbacks further down (there's no macOS/Linux
    // input-hook implementation yet). Never actually dead where it matters -
    // the tests below call all four directly on every platform, deliberately,
    // to exercise the scoring logic independent of any real OS hook - but
    // that only holds in the (lib test) build; the plain (lib) build has
    // neither a real hook nor a test calling them on non-Windows targets.
    #[allow(dead_code)]
    fn note_input(&self, injected: bool) {
        if injected {
            self.injected_count.fetch_add(1, Ordering::Relaxed);
        }
        self.last_input_ms.store(now_ms(), Ordering::Relaxed);
    }

    #[allow(dead_code)]
    fn on_keyboard_input(&self, vk_code: u32, injected: bool) {
        self.keyboard_count.fetch_add(1, Ordering::Relaxed);
        self.distinct_keys.lock().insert(vk_code);
        {
            let mut timestamps = self.key_timestamps_ms.lock();
            timestamps.push(now_ms());
            // Capped ring - oldest dropped first. CADENCE_SAMPLE_SIZE is
            // small (30), so a linear shift here is cheap relative to typing
            // speed (at most ~10 keydowns/sec from a human).
            if timestamps.len() > CADENCE_SAMPLE_SIZE {
                timestamps.remove(0);
            }
        }
        self.note_input(injected);
    }

    #[allow(dead_code)]
    fn on_mouse_click(&self, injected: bool) {
        self.click_count.fetch_add(1, Ordering::Relaxed);
        self.note_input(injected);
    }

    #[allow(dead_code)]
    fn on_mouse_move(&self, injected: bool, x: i32, y: i32) {
        self.move_count.fetch_add(1, Ordering::Relaxed);
        {
            let mut last_pos = self.last_mouse_pos.lock();
            if let Some((last_x, last_y)) = *last_pos {
                let dx = (x - last_x) as f64;
                let dy = (y - last_y) as f64;
                *self.mouse_distance_px.lock() += dx.hypot(dy);
            }
            *last_pos = Some((x, y));
        }
        self.note_input(injected);
    }

    /// Seconds since the last real mouse/keyboard input.
    ///
    /// ID-5: this used to read only `last_input_ms`, which is fed exclusively
    /// by the two `WH_*_LL` hooks installed in `run_listeners`. Those hooks can
    /// stop delivering without any error and without notifying this process:
    ///
    ///  - Windows **silently removes** a low-level hook whose callback misses
    ///    `LowLevelHooksTimeout` (`HKCU\Control Panel\Desktop`, 300ms by
    ///    default). Nothing is returned, nothing is logged, the hook is simply
    ///    gone. A machine under load - exactly the machines people report lag
    ///    on - is where this happens.
    ///  - UIPI stops low-level hooks seeing input aimed at a
    ///    higher-integrity-level process, so anyone working in an elevated app
    ///    reads as idle for as long as they stay there.
    ///  - Anything that stalls the hook thread's message pump stops delivery
    ///    for as long as the stall lasts.
    ///
    /// Any one of those froze `last_input_ms`, so idle time grew without bound
    /// and `tick_idle_escalation` stopped the session and rewound the clock
    /// while the member was actively typing. That is the "unexpected pausing"
    /// in the field reports.
    ///
    /// `GetLastInputInfo` is the authority instead. It is a kernel-level query
    /// answered from the session's own input record: it needs no hook, cannot
    /// be silently removed, and never stalls. The hooks stay - the activity
    /// *score* genuinely needs per-event counts, which this cannot give - but
    /// they no longer decide whether someone is present.
    ///
    /// The smaller of the two wins, so either source seeing input is enough.
    pub fn idle_seconds(&self) -> u64 {
        let from_hooks = {
            let last = self.last_input_ms.load(Ordering::Relaxed);
            now_ms().saturating_sub(last) / 1000
        };
        match system_idle_seconds() {
            Some(from_os) => from_os.min(from_hooks),
            None => from_hooks,
        }
    }

    /// Whether the hooks have gone quiet while the OS still sees input - the
    /// signature of a hook Windows removed behind our back. Callers log it and
    /// reinstall; nothing about idle depends on the answer.
    #[allow(dead_code)]
    pub fn hooks_look_dead(&self) -> bool {
        let Some(from_os) = system_idle_seconds() else {
            return false;
        };
        let from_hooks = {
            let last = self.last_input_ms.load(Ordering::Relaxed);
            now_ms().saturating_sub(last) / 1000
        };
        // The OS saw input recently and the hooks did not. One tick of skew is
        // normal; half a minute is not.
        from_os <= 2 && from_hooks > 30
    }

    /// Whether real OS input-hook tracking is actually running on this
    /// platform. Windows is the only target where `run_listeners` installs
    /// real hooks (above) - everywhere else `last_input_ms` never updates
    /// past process start, so `idle_seconds()` only grows monotonically and
    /// is not a trustworthy "no input for N seconds" signal. Any caller that
    /// would act on idle time (warnings, auto-stop escalation) must check
    /// this first rather than treating process-start time as a fake activity
    /// baseline - see `agent::tracker::tick_idle_escalation`.
    pub const HOOKS_SUPPORTED: bool = cfg!(windows);

    /// ACT-2: keyboard's weighted contribution scaled down when the
    /// keystrokes look like a macro rather than real typing - either the
    /// same key hammered repeatedly (low distinct-key ratio) or perfectly
    /// even timing (low cadence variance). Multiplicative, not a hard zero:
    /// this is a scoring signal, not the anti-cheat verdict (that's AC-1's
    /// OS-level injected flag).
    fn keyboard_quality_multiplier(&self, keyboard_count: u64) -> f64 {
        if keyboard_count == 0 {
            return 1.0;
        }
        let distinct = self.distinct_keys.lock().len() as f64;
        let distinct_ratio = (distinct / keyboard_count as f64).clamp(MIN_DISTINCT_KEY_RATIO, 1.0);

        let cadence_multiplier = if keyboard_count as usize >= CADENCE_MIN_SAMPLES {
            match self.keystroke_interval_stddev_ms() {
                Some(stddev) if stddev < CADENCE_MACHINE_STDDEV_MS => CADENCE_MACHINE_PENALTY,
                _ => 1.0,
            }
        } else {
            1.0
        };

        distinct_ratio * cadence_multiplier
    }

    /// Standard deviation of inter-keystroke intervals in the current
    /// sample, or `None` with fewer than two timestamps to derive an
    /// interval from.
    fn keystroke_interval_stddev_ms(&self) -> Option<f64> {
        let timestamps = self.key_timestamps_ms.lock();
        if timestamps.len() < 2 {
            return None;
        }
        let intervals: Vec<f64> = timestamps
            .windows(2)
            .map(|pair| (pair[1] as f64 - pair[0] as f64).abs())
            .collect();
        let mean = intervals.iter().sum::<f64>() / intervals.len() as f64;
        let variance =
            intervals.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / intervals.len() as f64;
        Some(variance.sqrt())
    }

    pub fn score(&self) -> u32 {
        self.maybe_roll_window();
        let keyboard = self.keyboard_count.load(Ordering::Relaxed);
        let clicks = self.click_count.load(Ordering::Relaxed);
        let moves = self.move_count.load(Ordering::Relaxed);

        let keyboard_points =
            keyboard as f64 * KEYBOARD_INPUT_WEIGHT as f64 * self.keyboard_quality_multiplier(keyboard);
        let weighted =
            keyboard_points + (clicks as f64 * MOUSE_CLICK_WEIGHT as f64) + (moves as f64 * MOUSE_MOVE_WEIGHT as f64);

        let saturation = self.saturation_events.load(Ordering::Relaxed);
        let pct = ((weighted / saturation as f64) * 100.0).min(100.0).round() as u32;
        pct.max(ACTIVITY_MIN_SCORE)
    }

    /// ACT-3: applied from the periodic scoring-settings poll. Zero values
    /// are refused rather than stored - a saturation of 0 would divide by
    /// zero in `score()`, and a window of 0 would roll every single tick.
    pub fn apply_scoring_settings(&self, saturation_events: u64, window_ms: u64) {
        if saturation_events > 0 {
            self.saturation_events.store(saturation_events, Ordering::Relaxed);
        }
        if window_ms > 0 {
            self.window_ms.store(window_ms, Ordering::Relaxed);
        }
    }

    /// ACT-4: the raw counters behind `score()`, for the server to persist
    /// per capture and recompute or re-weight from later without an agent
    /// release. Deliberately reads the same window `score()` would (calls
    /// `maybe_roll_window` first) so a signal and the score sent alongside it
    /// in the same capture always describe the same window.
    pub fn signal_snapshot(&self) -> ActivitySignal {
        self.maybe_roll_window();
        let now = now_ms();
        let start = self.window_start_ms.load(Ordering::Relaxed);
        ActivitySignal {
            keystroke_count: self.keyboard_count.load(Ordering::Relaxed),
            distinct_key_count: self.distinct_keys.lock().len() as u32,
            mouse_distance_px: self.mouse_distance_px.lock().round() as u64,
            injected_event_count: self.injected_count.load(Ordering::Relaxed),
            active_seconds_in_window: now.saturating_sub(start) / 1000,
        }
    }

    /// ACT-1/AC-1: fraction (0.0-1.0) of this window's counted input that was
    /// OS-flagged as synthetic. `None` when the window has no input at all -
    /// distinct from `Some(0.0)` (input happened and none of it was
    /// synthetic), since "no signal yet" and "confirmed clean" should not be
    /// flagged identically by a caller doing anti-cheat scoring.
    pub fn injected_fraction(&self) -> Option<f64> {
        self.maybe_roll_window();
        let total = self.keyboard_count.load(Ordering::Relaxed)
            + self.click_count.load(Ordering::Relaxed)
            + self.move_count.load(Ordering::Relaxed);
        if total == 0 {
            return None;
        }
        let injected = self.injected_count.load(Ordering::Relaxed);
        Some(injected as f64 / total as f64)
    }

    fn maybe_roll_window(&self) {
        let now = now_ms();
        let start = self.window_start_ms.load(Ordering::Relaxed);
        let window_ms = self.window_ms.load(Ordering::Relaxed);
        if now.saturating_sub(start) > window_ms {
            self.clear_counters();
            self.window_start_ms.store(now, Ordering::Relaxed);
        }
    }

    fn clear_counters(&self) {
        self.keyboard_count.store(0, Ordering::Relaxed);
        self.click_count.store(0, Ordering::Relaxed);
        self.move_count.store(0, Ordering::Relaxed);
        self.injected_count.store(0, Ordering::Relaxed);
        self.distinct_keys.lock().clear();
        self.key_timestamps_ms.lock().clear();
        *self.mouse_distance_px.lock() = 0.0;
        *self.last_mouse_pos.lock() = None;
    }

    pub fn reset(&self) {
        self.clear_counters();
        self.window_start_ms.store(now_ms(), Ordering::Relaxed);
    }
}

// SAFETY: raw pointer to the single ActivityMeter instance, valid for the
// lifetime of run_listeners (set at its start, cleared at its end) - see the
// SAFETY note where it's stored. Hook callbacks are process-global function
// pointers with no closure capture, so a static is the standard way to reach
// instance state from them; this crate only ever creates one ActivityMeter.
#[cfg(windows)]
static METER_FOR_HOOK: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

#[cfg(windows)]
unsafe extern "system" fn keyboard_hook_proc(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, KBDLLHOOKSTRUCT, LLKHF_INJECTED, WM_KEYDOWN, WM_SYSKEYDOWN,
    };

    if code >= 0 {
        let msg = wparam.0 as u32;
        // Down-transitions only - WM_KEYUP would double-count every press,
        // and Windows already resends WM_KEYDOWN at OS auto-repeat rate
        // while a key is held, which is the real "fast typing" signal this
        // replaces the 100ms poller to stop missing.
        if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
            let ptr = METER_FOR_HOOK.load(Ordering::SeqCst);
            if ptr != 0 {
                let meter = unsafe { &*(ptr as *const ActivityMeter) };
                let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
                let injected = (info.flags.0 & LLKHF_INJECTED.0) != 0;
                meter.on_keyboard_input(info.vkCode, injected);
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

#[cfg(windows)]
unsafe extern "system" fn mouse_hook_proc(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, LLMHF_INJECTED, MSLLHOOKSTRUCT, WM_LBUTTONDOWN, WM_MBUTTONDOWN,
        WM_MOUSEMOVE, WM_RBUTTONDOWN,
    };

    if code >= 0 {
        let msg = wparam.0 as u32;
        let is_click = msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN || msg == WM_MBUTTONDOWN;
        let is_move = msg == WM_MOUSEMOVE;
        if is_click || is_move {
            let ptr = METER_FOR_HOOK.load(Ordering::SeqCst);
            if ptr != 0 {
                let meter = unsafe { &*(ptr as *const ActivityMeter) };
                let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
                let injected = (info.flags & LLMHF_INJECTED) != 0;

                if is_click {
                    meter.on_mouse_click(injected);
                } else {
                    // MOUSE_MOVE_MIN_INTERVAL_MS throttle - see its doc comment.
                    let now = now_ms();
                    let last = meter.last_mouse_move_ms.load(Ordering::Relaxed);
                    if now.saturating_sub(last) >= MOUSE_MOVE_MIN_INTERVAL_MS {
                        meter.last_mouse_move_ms.store(now, Ordering::Relaxed);
                        meter.on_mouse_move(injected, info.pt.x, info.pt.y);
                    }
                }
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pure scoring/window logic - platform-independent, no hook needed. The
    // hooks themselves (real OS callback delivery, injected-flag accuracy)
    // are exactly the part that cannot be verified without live global input
    // on real hardware; what's tested here is everything a bug in that
    // delivery would still need to feed correctly.

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

    /// Pushes `count` irregularly-spaced timestamps (never a uniform
    /// interval) directly into the meter's cadence buffer, bypassing real
    /// wall-clock timing entirely. A tight test loop's real timestamps land
    /// within the same millisecond far more often than genuine typing does,
    /// which would trip the machine-cadence penalty for reasons that have
    /// nothing to do with what a given test is actually checking - this is
    /// the deterministic stand-in used anywhere a test needs cadence to
    /// read as "human" without depending on how fast the test happens to run.
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
        // Below CADENCE_MIN_SAMPLES on purpose - isolates pure per-type
        // weight comparison from the cadence signal, which is its own,
        // separately-tested thing.
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
        // Manufacture perfectly even 50ms-spaced timestamps directly - real
        // hook delivery timing can't be controlled from a unit test, but the
        // penalty this feeds is exactly what's under test here.
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
        // MIN_DISTINCT_KEY_RATIO's floor - a single legitimately-held key
        // (arrow key, backspace) must not drop to near-zero. Cadence seeded
        // irregular so this isolates the distinct-ratio floor specifically;
        // a real OS-auto-repeated key is a separate, arguably-fair case
        // where both signals firing together is correct, not tested here.
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
        // 3 distinct keys matching the count, so the distinct-ratio term is
        // 1.0 and this isolates cadence's effect alone.
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

    // ID-5: idle used to read only the hook-fed timestamp, so a hook Windows
    // silently removed froze it and the session stopped and rewound while the
    // member was typing. These pin the OS-level cross-check that replaced it.
    // No assumption that anyone is at the machine - this runs on CI too. What
    // it checks is that the query answers at all on Windows, and that the
    // tick-count wrap handling never yields an absurd reading.
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
        // The hooks last saw input an hour ago - the state Windows leaves
        // behind when it drops a slow low-level hook without telling anyone.
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
        // sign-in failed before start() ran) - hook_thread_id is 0 either way.
        let meter = ActivityMeter::new();
        meter.stop();
    }
}
