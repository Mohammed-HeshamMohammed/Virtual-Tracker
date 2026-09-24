//! Tests for uia_url.rs.

#[allow(unused_imports)]
use super::*;

#[cfg(test)]
mod tests {
    use super::normalize_url;

    #[test]
    fn full_urls_pass_through() {
        assert_eq!(
            normalize_url("https://github.com/x?y=1"),
            Some("https://github.com/x?y=1".into())
        );
        assert_eq!(normalize_url("  http://example.com  "), Some("http://example.com".into()));
    }

    #[test]
    fn a_scheme_less_host_gets_https() {
        assert_eq!(normalize_url("example.com"), Some("https://example.com".into()));
        assert_eq!(
            normalize_url("amplifiedprop.readymode.com/#"),
            Some("https://amplifiedprop.readymode.com/#".into())
        );
    }

    #[test]
    fn omnibox_text_that_is_not_a_url_is_rejected() {
        // A half-typed search, an empty bar, or a place name - never a URL.
        for text in ["", "   ", "how to fix uia", "Search Google or type a URL", "readymode"] {
            assert_eq!(normalize_url(text), None, "should reject {text:?}");
        }
    }

    #[test]
    fn a_trailing_or_leading_dot_is_not_a_host() {
        assert_eq!(normalize_url(".com"), None);
        assert_eq!(normalize_url("example."), None);
        assert_eq!(normalize_url("example.4"), None);
    }

    /// End-to-end against a real browser.
    #[cfg(windows)]
    #[test]
    #[ignore = "needs a real desktop session and Chrome installed"]
    fn reads_a_live_browser_address_bar() {
        use std::process::Command;
        use std::time::{Duration, Instant};

        const TARGET: &str = "https://example.com/";
        let chrome = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ]
        .into_iter()
        .find(|p| std::path::Path::new(p).exists())
        .expect("Chrome not installed");

        let profile = std::env::temp_dir().join(format!("vt-uia-test-{}", std::process::id()));
        let mut child = Command::new(chrome)
            .args([
                &format!("--user-data-dir={}", profile.display()),
                "--no-first-run",
                "--no-default-browser-check",
                "--new-window",
                TARGET,
            ])
            .spawn()
            .expect("launch chrome");

        // Chrome forks; the window belongs to whichever chrome.exe owns it, so ask the OS
        // rather than assuming it's our direct child.
        let hwnd = (|| {
            let deadline = Instant::now() + Duration::from_secs(30);
            while Instant::now() < deadline {
                let out = Command::new("powershell")
                    .args([
                        "-NoProfile",
                        "-Command",
                        "(Get-Process chrome -ErrorAction SilentlyContinue | \
                         Where-Object { $_.MainWindowHandle -ne 0 } | \
                         Select-Object -First 1).MainWindowHandle",
                    ])
                    .output()
                    .ok()?;
                let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if let Ok(handle) = text.parse::<usize>() {
                    if handle != 0 {
                        return Some(handle);
                    }
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            None
        })();

        let result = hwnd.and_then(|hwnd| {
            // First read pays for the tree search, later ones use the cache.
            let mut last = None;
            let deadline = Instant::now() + Duration::from_secs(20);
            while Instant::now() < deadline && last.is_none() {
                last = super::read_url(hwnd, Duration::from_secs(8));
                if last.is_none() {
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
            // Second read should be the cheap cached path.
            let started = Instant::now();
            let cached = super::read_url(hwnd, Duration::from_secs(8));
            eprintln!("cached read took {}ms -> {cached:?}", started.elapsed().as_millis());
            last
        });

        // Solution C: the first read subscribes to the omnibox, so navigating now should
        // surface without anyone polling for it.
        let mut observed: Vec<String> = Vec::new();
        if result.is_some() {
            let _ = super::drain_url_changes(); // discard the initial settle
            let _ = Command::new(chrome)
                .args([
                    &format!("--user-data-dir={}", profile.display()),
                    "https://example.net/",
                ])
                .spawn()
                .map(|mut c| {
                    let _ = c.wait();
                });
            let deadline = Instant::now() + Duration::from_secs(20);
            while Instant::now() < deadline && observed.is_empty() {
                std::thread::sleep(Duration::from_millis(500));
                observed = super::drain_url_changes()
                    .into_iter()
                    .map(|o| o.url)
                    .collect();
            }
            eprintln!("event-driven observations: {observed:?}");
        }

        let _ = child.kill();
        let _ = child.wait();
        let _ = Command::new("taskkill").args(["/F", "/IM", "chrome.exe"]).output();
        let _ = std::fs::remove_dir_all(&profile);

        let url = result.expect("no URL read from a live Chrome window");
        eprintln!("read: {url}");
        assert!(
            url.starts_with("https://example.com"),
            "expected example.com, got {url}"
        );
        assert!(
            observed.iter().any(|u| u.contains("example.net")),
            "value-changed subscription never reported the navigation; saw {observed:?}"
        );
    }
}
