//! Buzz: the Owner pokes this tracker from the People page - a small nudge card, or a joke
//! "blue screen" with a message.
//!
//! It arrives as a `buzz` frame on the same live socket as the other pushes (see
//! `agent/live_sync.rs`) and is drawn by a frameless window running this same frontend
//! (`src/BuzzScreen.tsx`), the way the tray menu is. It is a joke, so it is built to be
//! harmless: it closes on any click or key, closes itself after a few seconds whatever
//! happens, never stacks, and is rate limited here on top of the server's own limit.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "buzz";

const MAX_MESSAGE_CHARS: usize = 140;
const MAX_FROM_CHARS: usize = 60;
/// The server already allows one buzz per person per 30 s; this is the tracker's own backstop.
const MIN_GAP: Duration = Duration::from_secs(8);
/// If the screen's own timer never fires (a stuck webview), this still takes it down.
const FAILSAFE_CLOSE: Duration = Duration::from_secs(30);

const NUDGE_SIZE: (f64, f64) = (360.0, 120.0);
const NUDGE_MARGIN: f64 = 16.0;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Buzz {
    pub style: String,
    pub message: String,
    pub from: String,
}

#[derive(Default)]
pub struct BuzzState {
    current: Mutex<Option<Buzz>>,
    last_at: Mutex<Option<Instant>>,
}

fn clip(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}

/// A `buzz` frame, or `None` for anything else (including a malformed or unknown-style one).
pub fn parse(frame: &str) -> Option<Buzz> {
    let value: serde_json::Value = serde_json::from_str(frame).ok()?;
    if value.get("type")?.as_str()? != "buzz" {
        return None;
    }
    let style = value.get("style")?.as_str()?;
    if style != "nudge" && style != "bluescreen" {
        return None;
    }
    let message = clip(value.get("message").and_then(|v| v.as_str()).unwrap_or(""), MAX_MESSAGE_CHARS);
    if message.is_empty() {
        return None;
    }
    let from = clip(value.get("from").and_then(|v| v.as_str()).unwrap_or(""), MAX_FROM_CHARS);
    Some(Buzz {
        style: style.to_string(),
        message,
        from: if from.is_empty() { "Your owner".into() } else { from },
    })
}

/// Whether a buzz may be shown now, given when the last one was.
fn allowed(last: Option<Instant>, now: Instant) -> bool {
    last.map_or(true, |at| now.duration_since(at) >= MIN_GAP)
}

/// Shows the buzz. Window work goes through the main thread: this is called from the live
/// socket's own thread, and creating a window off the main thread can deadlock on Windows.
pub fn show(app: &AppHandle, buzz: Buzz) {
    let Some(state) = app.try_state::<BuzzState>() else { return };
    {
        let mut last = state.last_at.lock().unwrap();
        let now = Instant::now();
        if !allowed(*last, now) {
            log::info!("[buzz] ignored: another one just arrived");
            return;
        }
        *last = Some(now);
    }
    *state.current.lock().unwrap() = Some(buzz.clone());

    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(err) = open_window(&handle, &buzz) {
            log::warn!("[buzz] could not open the window: {err}");
            return;
        }
        let closer = handle.clone();
        std::thread::spawn(move || {
            std::thread::sleep(FAILSAFE_CLOSE);
            dismiss(&closer);
        });
    });
}

fn open_window(app: &AppHandle, buzz: &Buzz) -> tauri::Result<()> {
    // A new buzz replaces one still on screen rather than stacking.
    if let Some(old) = app.get_webview_window(LABEL) {
        let _ = old.destroy();
    }
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("My Virtual Tracker")
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .focused(true);

    if buzz.style == "bluescreen" {
        builder.fullscreen(true).build()?;
        return Ok(());
    }

    let window = builder
        .inner_size(NUDGE_SIZE.0, NUDGE_SIZE.1)
        .transparent(true)
        .build()?;
    // Top-right of the area the taskbar leaves free.
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let _ = window.set_size(LogicalSize::new(NUDGE_SIZE.0, NUDGE_SIZE.1));
        let x = f64::from(area.position.x) + f64::from(area.size.width) - (NUDGE_SIZE.0 + NUDGE_MARGIN) * scale;
        let y = f64::from(area.position.y) + NUDGE_MARGIN * scale;
        let _ = window.set_position(PhysicalPosition::new(x.round(), y.round()));
    }
    Ok(())
}

pub fn dismiss(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
    if let Some(state) = app.try_state::<BuzzState>() {
        *state.current.lock().unwrap() = None;
    }
}

/// What the screen should draw; the window asks for it as soon as it has loaded.
#[tauri::command]
pub fn buzz_take(state: tauri::State<'_, BuzzState>) -> Option<Buzz> {
    state.current.lock().unwrap().clone()
}

#[tauri::command]
pub fn buzz_dismiss(app: AppHandle) {
    dismiss(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_buzz_frame_is_read_with_its_style_message_and_sender() {
        let frame = r#"{"type":"buzz","style":"bluescreen","message":"Focus!","from":"Olive Owner","at":1}"#;
        assert_eq!(
            parse(frame),
            Some(Buzz { style: "bluescreen".into(), message: "Focus!".into(), from: "Olive Owner".into() })
        );
    }

    #[test]
    fn other_frames_and_malformed_ones_are_not_buzzes() {
        assert_eq!(parse(r#"{"type":"changed","resource":"tasks"}"#), None);
        assert_eq!(parse("not json"), None);
        assert_eq!(parse(r#"{"type":"buzz","style":"airhorn","message":"x"}"#), None, "unknown style");
        assert_eq!(parse(r#"{"type":"buzz","style":"nudge","message":"   "}"#), None, "nothing to say");
        assert_eq!(parse(r#"{"type":"buzz","message":"x"}"#), None, "no style");
    }

    #[test]
    fn text_is_clipped_and_a_missing_sender_gets_a_name() {
        let long = "x".repeat(500);
        let frame = format!(r#"{{"type":"buzz","style":"nudge","message":"{long}","from":"{long}"}}"#);
        let buzz = parse(&frame).unwrap();
        assert_eq!(buzz.message.chars().count(), MAX_MESSAGE_CHARS);
        assert_eq!(buzz.from.chars().count(), MAX_FROM_CHARS);
        assert_eq!(parse(r#"{"type":"buzz","style":"nudge","message":"hi"}"#).unwrap().from, "Your owner");
    }

    #[test]
    fn a_second_buzz_inside_the_gap_is_ignored() {
        let now = Instant::now();
        assert!(allowed(None, now));
        assert!(!allowed(Some(now), now + MIN_GAP - Duration::from_millis(1)));
        assert!(allowed(Some(now), now + MIN_GAP));
    }
}
