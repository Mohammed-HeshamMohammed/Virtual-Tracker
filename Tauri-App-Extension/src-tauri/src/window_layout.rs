//! Which layout the main window uses, and the size that goes with it.
//!
//! The standard window is 1100x750. That is taller than a lot of screens have
//! room for: a 1366x768 laptop leaves ~728px once the taskbar is taken off, a
//! 1080p laptop at 150% scaling ~680px, and a 1366x768 panel at 125% only
//! ~566px - and those last ones are narrow as well as short. Squashing the
//! standard layout to fit would shrink the sidebar and the main pane, so each
//! screen class gets its own arrangement instead, with every element kept at
//! its normal size:
//!
//! - **Standard** 1100x750 - the original. Normal desktop monitors.
//! - **Wide** 1420x820 - big monitors. The week's top apps and the screenshots
//!   get a roomier column of their own on the right.
//! - **Compact** 1320x660 - short but wide screens. Same side column, and the
//!   project/task lists show two rows instead of three.
//! - **Focus** 1040x600 - short and narrow screens. No side column; the lists
//!   show two rows and the main pane scrolls.
//!
//! In Wide, Compact and Focus the apps & screenshots card can be switched off
//! (`show_insights` in prefs.rs). Off means the space goes too: Wide and
//! Compact drop their side column and the window gets that much narrower,
//! rather than leaving the main pane stretched across where it was. The CSS
//! side is `.layout-*` and `.no-side-column` in App.css.

use serde::Serialize;
use tauri::{LogicalSize, WebviewWindow};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LayoutKind {
    Standard,
    Wide,
    Compact,
    Focus,
}

impl LayoutKind {
    fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "standard" => Some(Self::Standard),
            "wide" => Some(Self::Wide),
            "compact" => Some(Self::Compact),
            "focus" => Some(Self::Focus),
            _ => None,
        }
    }

    /// The width the side column takes up, including the gap after it - what
    /// the window loses when the column goes. Matches `.side-column` (and its
    /// Wide override) in App.css. Zero for the layouts that have no column.
    fn side_column_width(self) -> f64 {
        match self {
            Self::Wide => 360.0 + 14.0,
            Self::Compact => 296.0 + 14.0,
            Self::Standard | Self::Focus => 0.0,
        }
    }

    /// The size it opens at when the screen has room for it, with the side
    /// column in place.
    fn preferred_size(self) -> (f64, f64) {
        match self {
            Self::Standard => (1100.0, 750.0),
            Self::Wide => (1420.0, 820.0),
            Self::Compact => (1320.0, 660.0),
            Self::Focus => (1040.0, 600.0),
        }
    }

    /// The smallest it can be squeezed to on a screen without room for its
    /// preferred size, with the side column in place - below this its
    /// columns stop fitting.
    fn min_size(self) -> (f64, f64) {
        match self {
            Self::Standard => (1100.0, 750.0),
            Self::Wide => (1300.0, 700.0),
            Self::Compact => (1180.0, 520.0),
            Self::Focus => (960.0, 520.0),
        }
    }
}

/// Kept clear between the window and the edge of the work area.
const EDGE_MARGIN: f64 = 16.0;

/// No window gets narrower than this, column or not: the sidebar plus a main
/// pane its three stat tiles still fit across.
const NARROWEST: f64 = 960.0;

/// Auto keeps the standard layout from this much usable height up.
const AUTO_STANDARD_MIN_HEIGHT: f64 = 750.0 + 40.0;

/// Auto uses compact from this much usable width up, and focus below it.
const AUTO_COMPACT_MIN_WIDTH: f64 = 1180.0 + EDGE_MARGIN;

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
/// Wide is never picked automatically: on a monitor where the standard
/// window already fits, it stays exactly as it has always been, and Wide is
/// there for anyone who wants the extra room. The apps & screenshots setting
/// doesn't change the pick - only the size the pick opens at.
fn auto_kind(work_area: Option<(f64, f64)>) -> LayoutKind {
    match work_area {
        None => LayoutKind::Standard,
        Some((_, height)) if height >= AUTO_STANDARD_MIN_HEIGHT => LayoutKind::Standard,
        Some((width, _)) if width >= AUTO_COMPACT_MIN_WIDTH => LayoutKind::Compact,
        Some(_) => LayoutKind::Focus,
    }
}

/// Picks the layout and size for the stored layout preference, the apps &
/// screenshots setting, and the screen's work area in logical pixels (`None`
/// when no monitor could be read).
///
/// An explicit layout is always honoured. "auto", and anything unrecognised,
/// looks at the screen.
pub fn resolve(
    preference: &str,
    show_insights: bool,
    work_area: Option<(f64, f64)>,
) -> WindowLayout {
    let kind = LayoutKind::parse(preference).unwrap_or_else(|| auto_kind(work_area));
    let side_column = show_insights && kind.side_column_width() > 0.0;

    // Standard keeps its fixed size, as it always has.
    if kind == LayoutKind::Standard {
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

/// Sizes and re-centres the window for these settings.
pub fn apply(window: &WebviewWindow, preference: &str, show_insights: bool) -> WindowLayout {
    let layout = current(window, preference, show_insights);
    let size = LogicalSize::new(layout.width, layout.height);
    // tauri.conf.json's minimum is the standard size, which would stop the
    // window from getting any shorter - lift it, resize, then pin the new size
    // as the minimum.
    let _ = window.set_min_size(None::<LogicalSize<f64>>);
    if let Err(err) = window.set_size(size) {
        log::warn!(
            "Could not resize the window for the {} layout: {err}",
            preference
        );
    }
    let _ = window.set_min_size(Some(size));
    let _ = window.center();
    layout
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn auto_keeps_the_standard_window_wherever_it_fits() {
        for area in [BIG_MONITOR, FULL_HD] {
            let layout = resolve("auto", true, Some(area));
            assert_eq!(layout.kind, LayoutKind::Standard);
            assert_eq!(size(layout), (1100.0, 750.0));
        }
    }

    #[test]
    fn auto_uses_compact_on_a_short_but_wide_screen() {
        assert_eq!(
            resolve("auto", true, Some(SMALL_LAPTOP)).kind,
            LayoutKind::Compact
        );
        assert_eq!(
            resolve("auto", true, Some(SCALED_1080P)).kind,
            LayoutKind::Compact
        );
    }

    #[test]
    fn auto_uses_focus_on_a_short_and_narrow_screen() {
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
    fn auto_never_picks_wide() {
        for area in EVERY_SCREEN {
            assert_ne!(resolve("auto", true, Some(area)).kind, LayoutKind::Wide);
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
            ("standard", (1100.0, 750.0)),
            ("wide", (1420.0, 820.0)),
            ("compact", (1320.0, 660.0)),
            ("focus", (1040.0, 600.0)),
        ];
        for (name, expected) in sizes {
            assert_eq!(
                size(resolve(name, true, Some(BIG_MONITOR))),
                expected,
                "{name}"
            );
        }
    }

    // The space goes with the column: switching the card off makes the window
    // narrower by exactly the column's width, instead of stretching the main
    // pane across where it was.
    #[test]
    fn switching_apps_and_screenshots_off_takes_the_column_and_its_width_away() {
        let wide = resolve("wide", false, Some(BIG_MONITOR));
        assert!(!wide.side_column);
        assert_eq!(size(wide), (1420.0 - 374.0, 820.0));

        let compact = resolve("compact", false, Some(BIG_MONITOR));
        assert!(!compact.side_column);
        assert_eq!(size(compact), (1320.0 - 310.0, 660.0));
    }

    #[test]
    fn only_wide_and_compact_have_a_side_column() {
        assert!(resolve("wide", true, None).side_column);
        assert!(resolve("compact", true, None).side_column);
        assert!(!resolve("standard", true, None).side_column);
        assert!(!resolve("focus", true, None).side_column);
    }

    #[test]
    fn standard_and_focus_keep_their_size_whatever_the_setting() {
        for name in ["standard", "focus"] {
            assert_eq!(
                size(resolve(name, true, Some(BIG_MONITOR))),
                size(resolve(name, false, Some(BIG_MONITOR))),
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
        let standard = resolve("standard", true, Some(SCALED_900P));
        assert_eq!(standard.kind, LayoutKind::Standard);
        assert_eq!(size(standard), (1100.0, 750.0));
    }

    #[test]
    fn a_squeezed_layout_never_goes_below_its_minimum() {
        assert_eq!(
            size(resolve("wide", true, Some(SCALED_900P))),
            (1300.0, 700.0)
        );
        assert_eq!(
            size(resolve("focus", true, Some((800.0, 480.0)))),
            (960.0, 520.0)
        );
        // Without the column it still never gets narrower than the tiles fit.
        assert_eq!(
            resolve("compact", false, Some((800.0, 480.0))).width,
            NARROWEST
        );
    }

    #[test]
    fn no_readable_monitor_keeps_the_standard_layout() {
        assert_eq!(resolve("auto", true, None).kind, LayoutKind::Standard);
        assert_eq!(size(resolve("compact", true, None)), (1320.0, 660.0));
    }

    #[test]
    fn an_unknown_preference_behaves_like_auto() {
        assert_eq!(
            resolve("", true, Some(SCALED_1080P)).kind,
            LayoutKind::Compact
        );
        assert_eq!(
            resolve("banana", true, Some(FULL_HD)).kind,
            LayoutKind::Standard
        );
    }
}
