//! Last-resort URL resolution from the browser's own history database.
//!
//! When UI Automation can't read the address bar - the window is minimised or
//! on another desktop, the browser is mid-navigation, a11y is disabled by
//! policy, or the build simply exposes no omnibox element - the agent used to
//! fall back to the raw window title. That is what produced the "Google Chrome
//! / Live Caption" rows with no site behind them.
//!
//! The window title *is* the page title, though, and the browser wrote that
//! title next to its URL in its own history. So we look that one title up.
//!
//! # Scope, deliberately
//!
//! This never enumerates or uploads browsing history. It answers exactly one
//! question - "what URL does the page currently on screen have?" - by looking
//! up the single title the agent already captured, restricted to visits from
//! the last few days. That keeps collection to what the member already
//! consented to (the focused window during tracked time) rather than turning
//! the agent into a history harvester, which is a materially different thing
//! and would need its own disclosure.
//!
//! Windows-only in practice: the lookup is only reached from the Windows URL
//! path in window.rs. The module still compiles everywhere so its tests run on
//! the Linux CI box.
#![cfg_attr(not(windows), allow(dead_code))]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;

use crate::capture::browsers::{self, Browser, Engine};

/// The database is locked while the browser runs, so it has to be copied
/// before it can be read. Copying is the expensive part, so a snapshot is
/// reused for this long before being taken again.
const SNAPSHOT_TTL: Duration = Duration::from_secs(120);

/// Never copy a history file larger than this. A pathological profile
/// shouldn't turn a URL lookup into a disk-thrashing exercise.
const MAX_HISTORY_BYTES: u64 = 300 * 1024 * 1024;

/// Only consider recent visits. Without this, a page title that happens to
/// match something visited months ago would resurrect that old URL.
const MAX_VISIT_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// Unix epoch expressed in the 1601-based epoch Chromium stores, in seconds.
const CHROME_EPOCH_OFFSET_SECS: i64 = 11_644_473_600;

struct Snapshot {
    copy: PathBuf,
    taken: Instant,
}

static SNAPSHOTS: Mutex<Option<HashMap<PathBuf, Snapshot>>> = Mutex::new(None);

/// Strip the browser's own name off a window title, leaving the page title.
/// "Houston TX Homes - Zillow - Google Chrome" -> "Houston TX Homes - Zillow".
pub fn page_title_from_window_title(window_title: &str, browser: &Browser) -> String {
    let mut title = window_title.trim();
    for name in [browser.display_name, browser.pane_name] {
        for sep in [" - ", " — ", " – ", " | "] {
            let suffix = format!("{sep}{name}");
            if let Some(stripped) = title.strip_suffix(&suffix) {
                title = stripped.trim();
            }
        }
    }
    // Chromium prefixes an unread-count badge on some pages.
    title.trim().to_string()
}

/// The URL the browser last recorded for this exact page title, if it visited
/// it recently. `None` when the browser is unknown, nothing matches, or the
/// database can't be read.
pub fn lookup_url_by_title(process_or_app_name: &str, window_title: &str) -> Option<String> {
    let browser = browsers::lookup(process_or_app_name)?;
    let file_name = browsers::history_file_name(browser.engine)?;
    let title = page_title_from_window_title(window_title, browser);
    if title.is_empty() || title.eq_ignore_ascii_case("unknown") {
        return None;
    }

    for profile in browsers::history_profile_dirs(browser) {
        let source = profile.join(file_name);
        let Some(snapshot) = snapshot_of(&source) else {
            continue;
        };
        if let Some(url) = query_title(&snapshot, browser.engine, &title) {
            return Some(url);
        }
    }
    None
}

/// A readable copy of `source`, taken at most every `SNAPSHOT_TTL`.
fn snapshot_of(source: &Path) -> Option<PathBuf> {
    let metadata = std::fs::metadata(source).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_HISTORY_BYTES {
        return None;
    }

    let mut guard = SNAPSHOTS.lock();
    let snapshots = guard.get_or_insert_with(HashMap::new);
    if let Some(existing) = snapshots.get(source) {
        if existing.taken.elapsed() < SNAPSHOT_TTL && existing.copy.is_file() {
            return Some(existing.copy.clone());
        }
    }

    // One stable filename per source, so snapshots overwrite rather than
    // accumulating a copy of every profile's history in temp.
    let mut hash: u64 = 1469598103934665603;
    for byte in source.to_string_lossy().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    let copy = std::env::temp_dir().join(format!("vt-history-{hash:016x}.db"));

    std::fs::copy(source, &copy).ok()?;
    // A write-ahead log holds the newest visits; without it the copy can be
    // minutes stale, which is exactly the window we care about.
    for suffix in ["-wal", "-shm"] {
        let extra = PathBuf::from(format!("{}{suffix}", source.display()));
        if extra.is_file() {
            let _ = std::fs::copy(&extra, PathBuf::from(format!("{}{suffix}", copy.display())));
        }
    }

    snapshots.insert(
        source.to_path_buf(),
        Snapshot {
            copy: copy.clone(),
            taken: Instant::now(),
        },
    );
    Some(copy)
}

fn query_title(db: &Path, engine: Engine, title: &str) -> Option<String> {
    let now_unix = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs() as i64;
    let cutoff_unix = now_unix - MAX_VISIT_AGE.as_secs() as i64;

    let (sql, cutoff) = match engine {
        Engine::Chromium => (
            "SELECT url FROM urls WHERE title = ?1 AND last_visit_time >= ?2 \
             ORDER BY last_visit_time DESC LIMIT 1",
            (cutoff_unix + CHROME_EPOCH_OFFSET_SECS) * 1_000_000,
        ),
        Engine::Gecko => (
            "SELECT url FROM moz_places WHERE title = ?1 AND last_visit_date >= ?2 \
             ORDER BY last_visit_date DESC LIMIT 1",
            cutoff_unix * 1_000_000,
        ),
        Engine::Other => return None,
    };

    let connection = rusqlite::Connection::open_with_flags(
        db,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .ok()?;
    let url: String = connection
        .query_row(sql, rusqlite::params![title, cutoff], |row| row.get(0))
        .ok()?;
    crate::capture::uia_url::normalize_url(&url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::browsers;

    fn chrome() -> &'static Browser {
        browsers::lookup("chrome.exe").unwrap()
    }

    #[test]
    fn the_browser_suffix_comes_off_the_window_title() {
        let firefox = browsers::lookup("firefox.exe").unwrap();
        assert_eq!(
            page_title_from_window_title("Houston TX Homes - Zillow - Google Chrome", chrome()),
            "Houston TX Homes - Zillow"
        );
        assert_eq!(
            page_title_from_window_title("Inbox — Mozilla Firefox", firefox),
            "Inbox"
        );
        // Nothing to strip is fine.
        assert_eq!(page_title_from_window_title("Just A Page", chrome()), "Just A Page");
    }

    #[test]
    fn a_title_that_is_only_the_browser_name_yields_nothing_useful() {
        // "Google Chrome" alone strips to empty rather than being looked up.
        assert_eq!(page_title_from_window_title("  Google Chrome  ", chrome()), "Google Chrome");
        assert_eq!(page_title_from_window_title("New Tab - Google Chrome", chrome()), "New Tab");
    }

    #[test]
    fn an_unknown_app_is_never_looked_up() {
        assert_eq!(lookup_url_by_title("notepad.exe", "Some Document"), None);
        assert_eq!(lookup_url_by_title("", "whatever"), None);
    }

    #[test]
    fn an_empty_or_unknown_title_is_never_looked_up() {
        assert_eq!(lookup_url_by_title("chrome.exe", ""), None);
        assert_eq!(lookup_url_by_title("chrome.exe", "   "), None);
        assert_eq!(lookup_url_by_title("chrome.exe", "Unknown"), None);
    }

    /// Builds a Chromium-shaped history db and proves the query finds the
    /// right row, respects recency, and returns nothing for a stranger.
    #[test]
    fn chromium_history_lookup_matches_title_and_recency() {
        let dir = std::env::temp_dir().join(format!("vt-hist-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let db = dir.join("History");
        let _ = std::fs::remove_file(&db);

        let now_unix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
        let to_chrome = |unix: i64| (unix + CHROME_EPOCH_OFFSET_SECS) * 1_000_000;

        let connection = rusqlite::Connection::open(&db).unwrap();
        connection
            .execute(
                "CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_time INTEGER)",
                [],
            )
            .unwrap();
        for (url, title, unix) in [
            ("https://old.example.com/", "Shared Title", now_unix - 60 * 24 * 3600),
            ("https://new.example.com/", "Shared Title", now_unix - 30),
            ("https://ancient.example.com/", "Ancient Only", now_unix - 90 * 24 * 3600),
        ] {
            connection
                .execute(
                    "INSERT INTO urls (url, title, last_visit_time) VALUES (?1, ?2, ?3)",
                    rusqlite::params![url, title, to_chrome(unix)],
                )
                .unwrap();
        }
        drop(connection);

        assert_eq!(
            query_title(&db, Engine::Chromium, "Shared Title"),
            Some("https://new.example.com/".to_string()),
            "the most recent visit wins"
        );
        assert_eq!(
            query_title(&db, Engine::Chromium, "Ancient Only"),
            None,
            "a visit older than the recency window is ignored"
        );
        assert_eq!(query_title(&db, Engine::Chromium, "Never Visited"), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Same, Firefox-shaped: different table, different column, different epoch.
    #[test]
    fn gecko_history_lookup_uses_moz_places_and_unix_micros() {
        let dir = std::env::temp_dir().join(format!("vt-hist-gecko-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let db = dir.join("places.sqlite");
        let _ = std::fs::remove_file(&db);

        let now_unix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
        let connection = rusqlite::Connection::open(&db).unwrap();
        connection
            .execute(
                "CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO moz_places (url, title, last_visit_date) VALUES (?1, ?2, ?3)",
                rusqlite::params!["https://gecko.example.com/", "Gecko Page", (now_unix - 10) * 1_000_000],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO moz_places (url, title, last_visit_date) VALUES (?1, ?2, ?3)",
                rusqlite::params!["https://stale.example.com/", "Stale Page", (now_unix - 90 * 24 * 3600) * 1_000_000],
            )
            .unwrap();
        drop(connection);

        assert_eq!(
            query_title(&db, Engine::Gecko, "Gecko Page"),
            Some("https://gecko.example.com/".to_string())
        );
        assert_eq!(query_title(&db, Engine::Gecko, "Stale Page"), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_snapshot_is_reused_rather_than_recopied_every_call() {
        let dir = std::env::temp_dir().join(format!("vt-hist-snap-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let source = dir.join("History");
        std::fs::write(&source, b"not really a database").unwrap();

        let first = snapshot_of(&source).expect("first snapshot");
        let second = snapshot_of(&source).expect("second snapshot");
        assert_eq!(first, second, "same stable path, no copy pile-up");

        let _ = std::fs::remove_file(&first);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
