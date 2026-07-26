use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::constants::{ACTIVITY_MIN_SCORE, ACTIVITY_SATURATION_EVENTS, ACTIVITY_WINDOW_MS};

/// Rolling mouse/keyboard activity score (0–100).
pub struct ActivityMeter {
    input_count: AtomicU64,
    window_start_ms: AtomicU64,
    started: AtomicBool,
    /// Timestamp of the last observed mouse/keyboard input, independent of the
    /// scoring window above - used to tell the tracker "no input for N
    /// seconds" so it can count idle vs. active seconds honestly instead of
    /// treating every tick as active just because a session is open.
    last_input_ms: AtomicU64,
}

impl ActivityMeter {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            input_count: AtomicU64::new(0),
            window_start_ms: AtomicU64::new(now_ms()),
            started: AtomicBool::new(false),
            last_input_ms: AtomicU64::new(now_ms()),
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
        thread::Builder::new()
            .name("vt-activity-meter".into())
            .spawn(move || meter.run_listeners())
            .ok();
    }

    fn run_listeners(&self) {
        let mut last_pos = (0i32, 0i32);
        loop {
            #[cfg(windows)]
            {
                use windows::Win32::Foundation::POINT;
                use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
                use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

                let mut point = POINT::default();
                if unsafe { GetCursorPos(&mut point) }.is_ok() {
                    let pos = (point.x, point.y);
                    if pos != last_pos {
                        last_pos = pos;
                        self.on_input();
                    }
                }
                // Sample a few common keys / mouse buttons.
                for vk in [0x01i32, 0x02, 0x08, 0x09, 0x0D, 0x20] {
                    let state = unsafe { GetAsyncKeyState(vk) };
                    if state as u16 & 0x0001 != 0 {
                        self.on_input();
                    }
                }
            }
            #[cfg(not(windows))]
            {
                let _ = last_pos;
                // Placeholder: activity stays at floor until platform hooks are added.
            }
            thread::sleep(Duration::from_millis(100));
        }
    }

    fn on_input(&self) {
        self.input_count.fetch_add(1, Ordering::Relaxed);
        self.last_input_ms.store(now_ms(), Ordering::Relaxed);
    }

    /// Seconds since the last observed mouse/keyboard input. On platforms with
    /// no input hook wired yet (non-Windows, see run_listeners below) this
    /// only grows from process start and never resets, same limitation `score`
    /// already has there.
    pub fn idle_seconds(&self) -> u64 {
        let last = self.last_input_ms.load(Ordering::Relaxed);
        now_ms().saturating_sub(last) / 1000
    }

    pub fn score(&self) -> u32 {
        let now = now_ms();
        let start = self.window_start_ms.load(Ordering::Relaxed);
        if now.saturating_sub(start) > ACTIVITY_WINDOW_MS {
            self.input_count.store(0, Ordering::Relaxed);
            self.window_start_ms.store(now, Ordering::Relaxed);
        }
        let count = self.input_count.load(Ordering::Relaxed);
        let pct = ((count as f64 / ACTIVITY_SATURATION_EVENTS as f64) * 100.0)
            .min(100.0)
            .round() as u32;
        pct.max(ACTIVITY_MIN_SCORE)
    }

    pub fn reset(&self) {
        self.input_count.store(0, Ordering::Relaxed);
        self.window_start_ms.store(now_ms(), Ordering::Relaxed);
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
