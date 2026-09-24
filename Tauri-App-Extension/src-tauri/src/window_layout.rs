//! Which layout the main window uses, and the size that goes with it.
//!
//! - **Standard** 1320x660 - wider and noticeably shorter than the window
//! used to be, so it fits a laptop screen without running off the bottom.
//! This is the default now. On a screen with the room, and with the apps &
//! screenshots card switched on (`show_insights` in prefs.rs, off by
//! default), the week's top apps and the screenshots get a column of their
//! own on the right; with it off, or without the room for the column, the
//! window is that much narrower instead of showing the column half-hidden.
//! - **Wide** 1420x820 - for a big monitor. Same column as Standard, just
//! more room in it. Never picked by Auto on its own.
//! - **Extended** 1100x750 - the original window, fixed size, no column ever
//! (it doesn't shrink, so a hidden column would just be dead space) - for
//! anyone who wants the classic layout and has a monitor for it. Never
//! picked by Auto on its own, same as Wide.
//! - **Focus** 1100x600 - screens too small even for Standard. No apps &
//! screenshots column; the tasks get a narrow column of their own on the
//! right instead, so the sidebar only holds the projects, and the main
//! pane shows the top apps without the screenshots.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{LogicalSize, WebviewWindow};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LayoutKind {
    Standard,
    Wide,
    Extended,
    Focus,
}

impl LayoutKind {
    fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "standard" => Some(Self::Standard),
            "wide" => Some(Self::Wide),
            "extended" => Some(Self::Extended),
            "focus" => Some(Self::Focus),
            // Pre-rename value: Standard used to mean the 1100x750 window
            // that "extended" now means, so an old explicit choice of
            // "standard" would silently change shape under the same name -
            // "compact" had no such conflict (it's simply Standard's old
            // name), so only it gets carried forward.
            "compact" => Some(Self::Standard),
            _ => None,
        }
    }

    /// The width the side column takes up, including the gap after it - what
    /// the window loses when the column goes. Matches `.side-column` (and its
    /// Wide override) in App.css. Zero for the layouts that have no column.
    fn side_column_width(self) -> f64 {
        match self {
            Self::Wide => 360.0 + 14.0,
            Self::Standard => 296.0 + 14.0,
            Self::Extended | Self::Focus => 0.0,
        }
    }

    /// The size it opens at when the screen has room for it, with the side
    /// column in place.
    fn preferred_size(self) -> (f64, f64) {
        match self {
            Self::Standard => (1320.0, 660.0),
            Self::Wide => (1420.0, 820.0),
            Self::Extended => (1100.0, 750.0),
            Self::Focus => (1100.0, 600.0),
        }
    }

    /// The smallest it can be squeezed to on a screen without room for its
    /// preferred size, with the side column in place - below this its
    /// columns stop fitting. Meaningless for Extended, which doesn't shrink.
    fn min_size(self) -> (f64, f64) {
        match self {
            Self::Standard => (1180.0, 520.0),
            Self::Wide => (1300.0, 700.0),
            Self::Extended => (1100.0, 750.0),
            Self::Focus => (960.0, 520.0),
        }
    }
}

/// Kept clear between the window and the edge of the work area.
const EDGE_MARGIN: f64 = 16.0;

/// No window gets narrower than this, column or not: the sidebar plus a main
/// pane its three stat tiles still fit across.
const NARROWEST: f64 = 960.0;

/// Auto picks Standard from this much usable width up - Standard's own
/// with-column minimum (its narrowest with insights on), plus a little room.
/// Auto's pick can't depend on the insights setting (see auto_kind's own
/// doc), so it has to clear the wider of Standard's two floors, not just the
/// one the current setting happens to need.
const AUTO_STANDARD_MIN_WIDTH: f64 = 1180.0 + EDGE_MARGIN;

/// Auto picks Standard from this much usable height up. Standard's own
/// preferred height (660) is already short, so this only needs to clear its
/// shrink-to-fit floor with a little room, not the height a fixed window
/// would need.
const AUTO_STANDARD_MIN_HEIGHT: f64 = 520.0 + 40.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowLayout {
    pub kind: LayoutKind,
    /// Whether this window was sized with the side column in it.
    pub side_column: bool,
    pub width: f64,
    pub height: f64,
}

/// The layout Auto picks for a screen's work area in logical pixels.
///
/// Wide and Extended are never picked automatically - both exist for someone
/// who knows they have the monitor for it and asks for it by name. Standard
/// fits comfortably shrunk down to a genuinely small screen already (see
/// AUTO_STANDARD_MIN_WIDTH/HEIGHT, both close to its own shrink floor), so
/// Focus is for screens too small even for that. The apps & screenshots
/// setting doesn't change the pick - only the size the pick opens at.
fn auto_kind(work_area: Option<(f64, f64)>) -> LayoutKind {
    match work_area {
        None => LayoutKind::Standard,
        Some((width, height))
            if width >= AUTO_STANDARD_MIN_WIDTH && height >= AUTO_STANDARD_MIN_HEIGHT =>
        {
            LayoutKind::Standard
        }
        Some(_) => LayoutKind::Focus,
    }
}

/// Picks the layout and size for the stored layout preference, the apps &
/// screenshots setting, and the screen's work area in logical pixels (`None`
/// when no monitor could be read).
pub fn resolve(
    preference: &str,
    show_insights: bool,
    work_area: Option<(f64, f64)>,
) -> WindowLayout {
    let kind = LayoutKind::parse(preference).unwrap_or_else(|| auto_kind(work_area));
    let side_column = show_insights && kind.side_column_width() > 0.0;

    // Extended keeps its fixed size, the way the original window always did.
    if kind == LayoutKind::Extended {
        let (width, height) = kind.preferred_size();
        return WindowLayout {
            kind,
            side_column,
            width,
            height,
        };
    }

    // No column means none of its width either.
    let dropped = if side_column {
        0.0
    } else {
        kind.side_column_width()
    };
    let (width, height) = kind.preferred_size();
    let (min_width, min_height) = kind.min_size();
    let (width, min_width) = (width - dropped, (min_width - dropped).max(NARROWEST));

    // The others shrink to fit the screen they're on, down to the smallest
    // size their columns still fit in.
    let (width, height) = match work_area {
        Some((area_width, area_height)) => (
            width.min(area_width - EDGE_MARGIN).max(min_width),
            height.min(area_height - EDGE_MARGIN).max(min_height),
        ),
        None => (width, height),
    };
    WindowLayout {
        kind,
        side_column,
        width: width.round(),
        height: height.round(),
    }
}

/// The work area (the screen minus the taskbar) of the monitor the window is
/// on, in logical pixels.
fn work_area(window: &WebviewWindow) -> Option<(f64, f64)> {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())?;
    let scale = monitor.scale_factor();
    if scale <= 0.0 {
        return None;
    }
    let size = monitor.work_area().size;
    Some((size.width as f64 / scale, size.height as f64 / scale))
}

/// What the window's layout is for these settings, without touching it.
pub fn current(window: &WebviewWindow, preference: &str, show_insights: bool) -> WindowLayout {
    resolve(preference, show_insights, work_area(window))
}

/// How many steps a layout change takes to reach its new size, and how long
/// each one lasts - about a fifth of a second in all.
const RESIZE_STEPS: u32 = 14;
const RESIZE_STEP: Duration = Duration::from_millis(14);

/// Bumped by every resize, so an animation still running when the next layout
/// is picked stops where it is instead of fighting the new one.
static RESIZE_GENERATION: AtomicU64 = AtomicU64::new(0);

/// The size at step `step` of `steps` on the way from `from` to `to`, easing
/// out so the window settles into place rather than stopping dead.
fn eased_size(from: (f64, f64), to: (f64, f64), step: u32, steps: u32) -> (f64, f64) {
    let t = (step as f64 / steps.max(1) as f64).clamp(0.0, 1.0);
    let eased = 1.0 - (1.0 - t).powi(3);
    (
        (from.0 + (to.0 - from.0) * eased).round(),
        (from.1 + (to.1 - from.1) * eased).round(),
    )
}

fn finish_resize(window: &WebviewWindow, (width, height): (f64, f64)) {
    let size = LogicalSize::new(width, height);
    if let Err(err) = window.set_size(size) {
        log::warn!("Could not resize the window for its layout: {err}");
    }
    let _ = window.set_min_size(Some(size));
    let _ = window.center();
}

/// Sizes and re-centres the window for these settings. `animate` eases it
/// there over a fifth of a second - for a change the member just made in
/// Settings; startup sizes it in one step before the window is shown.
pub fn apply(window: &WebviewWindow, preference: &str, show_insights: bool, animate: bool) -> WindowLayout {
    let layout = current(window, preference, show_insights);
    let target = (layout.width, layout.height);
    let generation = RESIZE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    // tauri.conf.json's minimum is the original window's size, which would
    // stop the window from getting any shorter or narrower - lift it while
    // resizing, then pin the new size as the minimum.
    let _ = window.set_min_size(None::<LogicalSize<f64>>);

    let from = window
        .inner_size()
        .ok()
        .zip(window.scale_factor().ok())
        .map(|(size, scale)| {
            let logical = size.to_logical::<f64>(scale);
            (logical.width.round(), logical.height.round())
        });
    match from {
        Some(from) if animate && from != target => {
            let window = window.clone();
            // Off the command's thread: every window call hops to the main
            // thread, which has to stay free to actually carry them out.
            let spawned = std::thread::Builder::new()
                .name("vt-layout-resize".into())
                .spawn({
                    let window = window.clone();
                    move || {
                        for step in 1..RESIZE_STEPS {
                            if RESIZE_GENERATION.load(Ordering::SeqCst) != generation {
                                return;
                            }
                            let (width, height) = eased_size(from, target, step, RESIZE_STEPS);
                            let _ = window.set_size(LogicalSize::new(width, height));
                            let _ = window.center();
                            std::thread::sleep(RESIZE_STEP);
                        }
                        if RESIZE_GENERATION.load(Ordering::SeqCst) == generation {
                            finish_resize(&window, target);
                        }
                    }
                });
            if spawned.is_err() {
                finish_resize(&window, target);
            }
        }
        _ => finish_resize(window, target),
    }
    layout
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_layout_change_eases_from_the_old_size_to_exactly_the_new_one() {
        let from = (1320.0, 660.0);
        let to = (1100.0, 600.0);
        assert_eq!(eased_size(from, to, 0, RESIZE_STEPS), from);
        assert_eq!(eased_size(from, to, RESIZE_STEPS, RESIZE_STEPS), to);
        let mut previous = from;
        for step in 1..=RESIZE_STEPS {
            let next = eased_size(from, to, step, RESIZE_STEPS);
            assert!(next.0 <= previous.0 && next.1 <= previous.1, "never overshoots or reverses");
            previous = next;
        }
        // Eases out: most of the distance is covered in the first half.
        let halfway = eased_size(from, to, RESIZE_STEPS / 2, RESIZE_STEPS);
        assert!(from.0 - halfway.0 > (from.0 - to.0) / 2.0);
    }

    // Usable work areas, in logical pixels, once the taskbar is taken off.
    const BIG_MONITOR: (f64, f64) = (2560.0, 1392.0); // 1440p at 100%
    const FULL_HD: (f64, f64) = (1920.0, 1032.0); // 1080p at 100%
    const SMALL_LAPTOP: (f64, f64) = (1366.0, 728.0); // 1366x768 at 100%
    const SCALED_1080P: (f64, f64) = (1280.0, 672.0); // 1080p at 150%
    const SCALED_768P: (f64, f64) = (1093.0, 566.0); // 1366x768 at 125%
    const SCALED_900P: (f64, f64) = (960.0, 552.0); // 1440x900 at 150%

    const EVERY_SCREEN: [(f64, f64); 6] = [
        BIG_MONITOR,
        FULL_HD,
        SMALL_LAPTOP,
        SCALED_1080P,
        SCALED_768P,
        SCALED_900P,
    ];

    fn fits((width, height): (f64, f64), layout: WindowLayout) -> bool {
        layout.width <= width && layout.height <= height
    }

    fn size(layout: WindowLayout) -> (f64, f64) {
        (layout.width, layout.height)
    }

    #[test]
    fn auto_opens_standard_at_its_preferred_size_wherever_there_is_room() {
        for area in [BIG_MONITOR, FULL_HD, SMALL_LAPTOP] {
            let layout = resolve("auto", true, Some(area));
            assert_eq!(layout.kind, LayoutKind::Standard, "{area:?}");
            assert_eq!(size(layout), (1320.0, 660.0), "{area:?}");
        }
    }

    #[test]
    fn auto_uses_focus_only_on_screens_too_small_for_standard() {
        assert_eq!(
            resolve("auto", true, Some(SCALED_768P)).kind,
            LayoutKind::Focus
        );
        assert_eq!(
            resolve("auto", true, Some(SCALED_900P)).kind,
            LayoutKind::Focus
        );
    }

    #[test]
    fn whatever_auto_picks_fits_the_screen_it_picked_it_for() {
        for show_insights in [true, false] {
            for area in EVERY_SCREEN {
                let layout = resolve("auto", show_insights, Some(area));
                assert!(fits(area, layout), "{layout:?} does not fit {area:?}");
            }
        }
    }

    #[test]
    fn auto_never_picks_wide_or_extended() {
        for area in EVERY_SCREEN {
            let kind = resolve("auto", true, Some(area)).kind;
            assert_ne!(kind, LayoutKind::Wide, "{area:?}");
            assert_ne!(kind, LayoutKind::Extended, "{area:?}");
        }
    }

    #[test]
    fn the_apps_and_screenshots_setting_does_not_change_what_auto_picks() {
        for area in EVERY_SCREEN {
            assert_eq!(
                resolve("auto", true, Some(area)).kind,
                resolve("auto", false, Some(area)).kind,
                "{area:?}"
            );
        }
    }

    #[test]
    fn each_layout_opens_at_its_own_size_where_there_is_room() {
        let sizes = [
            ("standard", (1320.0, 660.0)),
            ("wide", (1420.0, 820.0)),
            ("extended", (1100.0, 750.0)),
            ("focus", (1100.0, 600.0)),
        ];
        for (name, expected) in sizes {
            assert_eq!(
                size(resolve(name, true, Some(BIG_MONITOR))),
                expected,
                "{name}"
            );
        }
    }

    #[test]
    fn an_explicit_choice_overrides_the_screen() {
        assert_eq!(
            resolve("focus", true, Some(BIG_MONITOR)).kind,
            LayoutKind::Focus
        );
        assert_eq!(
            resolve("wide", true, Some(SMALL_LAPTOP)).kind,
            LayoutKind::Wide
        );
        assert_eq!(
            resolve("extended", true, Some(SMALL_LAPTOP)).kind,
            LayoutKind::Extended
        );
    }

    // Extended is the one layout that never shrinks - same as the original
    // window, which had no notion of a screen too small for it either.
    #[test]
    fn extended_keeps_its_fixed_size_however_small_the_screen() {
        let extended = resolve("extended", true, Some(SCALED_900P));
        assert_eq!(size(extended), (1100.0, 750.0));
        assert_eq!(size(resolve("extended", true, None)), (1100.0, 750.0));
    }

    #[test]
    fn a_squeezed_layout_never_goes_below_its_minimum() {
        let wide = resolve("wide", true, Some(SCALED_900P));
        assert_eq!(size(wide), (1300.0, 700.0));
        let focus = resolve("focus", true, Some((800.0, 480.0)));
        assert_eq!(size(focus), (960.0, 520.0));
    }

    // The space goes with the column: switching the card off makes the window
    // narrower by exactly the column's width, instead of stretching the main
    // pane across where it was.
    #[test]
    fn switching_apps_and_screenshots_off_takes_the_column_and_its_width_away() {
        let wide = resolve("wide", false, Some(BIG_MONITOR));
        assert!(!wide.side_column);
        assert_eq!(size(wide), (1420.0 - 374.0, 820.0));

        let standard = resolve("standard", false, Some(BIG_MONITOR));
        assert!(!standard.side_column);
        assert_eq!(size(standard), (1320.0 - 310.0, 660.0));
    }

    #[test]
    fn only_wide_and_standard_have_a_side_column() {
        assert!(resolve("wide", true, None).side_column);
        assert!(resolve("standard", true, None).side_column);
        assert!(!resolve("extended", true, None).side_column);
        assert!(!resolve("focus", true, None).side_column);
    }

    #[test]
    fn a_squeezed_layout_without_its_column_never_goes_below_the_narrowest_floor() {
        assert_eq!(
            resolve("standard", false, Some((800.0, 480.0))).width,
            NARROWEST
        );
    }

    #[test]
    fn no_readable_monitor_keeps_the_standard_layout() {
        assert_eq!(resolve("auto", true, None).kind, LayoutKind::Standard);
        assert_eq!(size(resolve("standard", true, None)), (1320.0, 660.0));
    }

    #[test]
    fn an_unknown_preference_behaves_like_auto() {
        assert_eq!(
            resolve("", true, Some(SCALED_1080P)).kind,
            LayoutKind::Standard
        );
        assert_eq!(
            resolve("banana", true, Some(SCALED_900P)).kind,
            LayoutKind::Focus
        );
    }

    // "compact" was Standard's name before this layout became the default -
    // an old explicit choice of it must still resolve the same way.
    #[test]
    fn a_pre_rename_compact_choice_still_resolves_to_standard() {
        assert_eq!(
            resolve("compact", true, Some(BIG_MONITOR)).kind,
            LayoutKind::Standard
        );
        assert_eq!(
            size(resolve("compact", true, Some(BIG_MONITOR))),
            (1320.0, 660.0)
        );
    }
}
