//! The mini timer: the main window shrunk to the timer bar and kept above every other
//! window (the way Task Manager can be), until the member goes back to the full tracker.

use tauri::{LogicalSize, PhysicalPosition, WebviewWindow};

use crate::window_layout;

/// The timer bar's size: the clock, its label and the session buttons, with room for the
/// way-back button in the corner.
pub const MINI_SIZE: (f64, f64) = (500.0, 88.0);
/// Kept clear between the mini timer and the corner of the screen it sits in.
const CORNER_MARGIN: f64 = 16.0;

/// Shrinks the window to the timer bar, keeps it on top and puts it in the top-right
/// corner of the screen it is on. The member can drag it anywhere from there.
pub fn enter(window: &WebviewWindow) -> Result<(), String> {
    window_layout::cancel_resize();
    let size = LogicalSize::new(MINI_SIZE.0, MINI_SIZE.1);
    // The layout pins a minimum as large as the full tracker; lift it first.
    let _ = window.set_min_size(None::<LogicalSize<f64>>);
    window.set_size(size).map_err(|e| e.to_string())?;
    let _ = window.set_min_size(Some(size));
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    if let Some(position) = top_right_corner(window) {
        let _ = window.set_position(position);
    }
    Ok(())
}

/// Back to the full tracker: no longer on top, and sized and centred for its layout.
pub fn leave(window: &WebviewWindow, layout: &str, show_insights: bool) -> Result<(), String> {
    window.set_always_on_top(false).map_err(|e| e.to_string())?;
    window_layout::apply(window, layout, show_insights, false);
    Ok(())
}

fn top_right_corner(window: &WebviewWindow) -> Option<PhysicalPosition<i32>> {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let width = (MINI_SIZE.0 * scale).round() as i32;
    let margin = (CORNER_MARGIN * scale).round() as i32;
    Some(PhysicalPosition::new(
        area.position.x + area.size.width as i32 - width - margin,
        area.position.y + margin,
    ))
}
