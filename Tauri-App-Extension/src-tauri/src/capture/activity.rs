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

/// Minimum gap between two counted mouse-MOVE events.
// Windows-only: its one use site is inside the #[cfg(windows)] mouse-hook callback below -
// there's no macOS/Linux input-hook implementation yet for this to throttle.
#[cfg(windows)]
const MOUSE_MOVE_MIN_INTERVAL_MS: u64 = 50;

/// Rolling mouse/keyboard activity score (0-100).
pub struct ActivityMeter {
    keyboard_count: AtomicU64,
    click_count: AtomicU64,
    move_count: AtomicU64,
    /// ACT-1/AC-1: how many of the counted inputs in the current window were flagged by the
    /// OS as synthetically generated (SendInput and equivalent) rather than from real
    injected_count: AtomicU64,
    /// ACT-2: distinct virtual-key codes seen this window - "200 presses of the same key is
    /// a macro" needs to know how many *different* keys were struck, not just how many
    distinct_keys: Mutex<HashSet<u32>>,
    key_timestamps_ms: Mutex<Vec<u64>>,
    last_mouse_pos: Mutex<Option<(i32, i32)>>,
    mouse_distance_px: Mutex<f64>,
    window_start_ms: AtomicU64,
    /// ACT-3: server-tunable calibration, defaulted to the compile-time constants and
    /// overwritten by `apply_scoring_settings` on the tracker's periodic poll - see
    saturation_events: AtomicU64,
    window_ms: AtomicU64,
    started: AtomicBool,
    last_input_ms: AtomicU64,
    /// MOUSE_MOVE_MIN_INTERVAL_MS's own throttle state - Windows-only for the same reason
    /// that constant is, see its doc comment.
    #[cfg(windows)]
    last_mouse_move_ms: AtomicU64,
    #[cfg(not(windows))]
    _last_mouse_move_ms: AtomicU64,
    /// CQ-1: OS thread ID the input hooks are installed on (0 = not running).
    #[cfg(windows)]
    hook_thread_id: AtomicU32,
    #[cfg(not(windows))]
    _hook_thread_id: AtomicU32,
    /// CQ-1: handle to the spawned hook-listener thread.
    hook_thread_handle: Mutex<Option<std::thread::JoinHandle<()>>>,
}

// Tests need to simulate a machine nobody is touching, which the real query cannot do - the
// machine running the suite is, by definition, in use.
#[cfg(test)]
thread_local! {
    static TEST_IDLE_OVERRIDE_SEC: std::cell::Cell<Option<u64>> = const { std::cell::Cell::new(None) };
}

/// Pretend the OS reports this many seconds of idle on this thread.
#[cfg(test)]
pub fn override_system_idle_for_test(seconds: Option<u64>) {
    TEST_IDLE_OVERRIDE_SEC.with(|cell| cell.set(seconds));
}

#[cfg(test)]
fn test_idle_override() -> Option<u64> {
    TEST_IDLE_OVERRIDE_SEC.with(|cell| cell.get())
}

/// Seconds since the last input the OS itself recorded for this session, or `None` where
/// there is no such query (non-Windows, or the call failed).
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
    // SAFETY: `info` is a correctly sized, fully initialised LASTINPUTINFO, and the
    // call only writes `dwTime`.
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

    /// Reinstall the input hooks if Windows has removed them behind our back.
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

    /// CQ-1: unregisters the OS-level hooks and blocks (bounded) until the hook thread has
    /// actually exited before returning.
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

    /// Blocks until the hook thread (if any) has exited, up to a few seconds.
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

        // SAFETY: METER_FOR_HOOK is set once, immediately before installing the hooks,
        // and only ever read from the two hook callbacks below (which only run on this
        // same thread's message loop while the hooks are installed) - never mutated
        // concurrently with a read.
        METER_FOR_HOOK.store(self as *const ActivityMeter as usize, Ordering::SeqCst);

        // Low-level hooks are process-thread-scoped and require the installing thread to
        // pump messages for callbacks to fire at all - this is not optional infrastructure
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
        // Blocks until a message arrives - stop() unblocks this by posting WM_QUIT to this
        // exact thread id.
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
        // MacOS equivalent is CGEventTap (kCGSessionEventTap) with a CFRunLoop on this
        // thread and kCGEventSourceStateID to distinguish hardware from synthetic input -
    }

    // Note_input through on_mouse_move: real production callers are the #[cfg(windows)]
    // hook callbacks further down (there's no macOS/Linux input-hook implementation yet).
    fn note_input(&self, injected: bool) {
        if injected {
            self.injected_count.fetch_add(1, Ordering::Relaxed);
        }
        self.last_input_ms.store(now_ms(), Ordering::Relaxed);
    }
    fn on_keyboard_input(&self, vk_code: u32, injected: bool) {
        self.keyboard_count.fetch_add(1, Ordering::Relaxed);
        self.distinct_keys.lock().insert(vk_code);
        {
            let mut timestamps = self.key_timestamps_ms.lock();
            timestamps.push(now_ms());
            // Capped ring - oldest dropped first.
            if timestamps.len() > CADENCE_SAMPLE_SIZE {
                timestamps.remove(0);
            }
        }
        self.note_input(injected);
    }
    fn on_mouse_click(&self, injected: bool) {
        self.click_count.fetch_add(1, Ordering::Relaxed);
        self.note_input(injected);
    }
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

    /// Whether the hooks have gone quiet while the OS still sees input - the signature of a
    /// hook Windows removed behind our back.
    pub fn hooks_look_dead(&self) -> bool {
        let Some(from_os) = system_idle_seconds() else {
            return false;
        };
        let from_hooks = {
            let last = self.last_input_ms.load(Ordering::Relaxed);
            now_ms().saturating_sub(last) / 1000
        };
        // The OS saw input recently and the hooks did not.
        from_os <= 2 && from_hooks > 30
    }

    /// Whether real OS input-hook tracking is actually running on this platform.
    pub const HOOKS_SUPPORTED: bool = cfg!(windows);

    /// ACT-2: keyboard's weighted contribution scaled down when the keystrokes look like a
    /// macro rather than real typing - either the same key hammered repeatedly (low
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

    /// Standard deviation of inter-keystroke intervals in the current sample, or `None`
    /// with fewer than two timestamps to derive an interval from.
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

    /// ACT-3: applied from the periodic scoring-settings poll.
    pub fn apply_scoring_settings(&self, saturation_events: u64, window_ms: u64) {
        if saturation_events > 0 {
            self.saturation_events.store(saturation_events, Ordering::Relaxed);
        }
        if window_ms > 0 {
            self.window_ms.store(window_ms, Ordering::Relaxed);
        }
    }

    /// ACT-4: the raw counters behind `score()`, for the server to persist per capture and
    /// recompute or re-weight from later without an agent release.
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

    /// ACT-1/AC-1: fraction (0.0-1.0) of this window's counted input that was OS-flagged as
    /// synthetic.
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

// SAFETY: raw pointer to the single ActivityMeter instance, valid for the lifetime of
// run_listeners (set at its start, cleared at its end) - see the SAFETY note where it's
// stored. Hook callbacks are process-global function pointers with no closure capture,
// so a static is the standard way to reach instance state from them; this crate only
// ever creates one ActivityMeter.
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
        // Down-transitions only - WM_KEYUP would double-count every press, and Windows
        // already resends WM_KEYDOWN at OS auto-repeat rate while a key is held, which is
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
#[path = "activity_tests.rs"]
mod activity_tests;
