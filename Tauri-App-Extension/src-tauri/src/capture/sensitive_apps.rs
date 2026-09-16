//! Personal messaging apps and sites the agent blurs a screenshot for, rather
//! than skip capturing entirely.
//!
//! A screenshot of Telegram, WhatsApp or Messenger - desktop app or the
//! browser version - is a photo of someone's private conversation, which
//! nothing about "was the member using a messaging app during work hours"
//! requires being able to read. Excluding the app from capture altogether
//! (capture/events.rs's org-configured `excluded_apps`) drops the app-log
//! entry too, so it wouldn't even show up as time spent; blurring keeps that
//! record and the fact that a screenshot exists, while making the pixels
//! themselves unreadable.
//!
//! This list is fixed in the agent rather than org-configurable, unlike
//! `excluded_apps` - it is a baseline privacy default, not a setting.

/// Executable names (Windows) or bundle-derived process names (macOS),
/// lowercased, no extension-sensitive matching needed since the caller
/// already lowercases before comparing.
const MESSAGING_EXES: &[&str] = &[
    "telegram.exe",
    "telegram",
    "whatsapp.exe",
    "whatsapp",
    "messenger.exe",
    "messenger",
];

/// Substrings matched against the page URL when the foreground window is a
/// browser. Each covers every path/subdomain of its service (e.g.
/// "web.telegram.org" catches "/k/", "/a/", "/z/" client variants alike), so
/// a full URL parse isn't needed - the marker only has to be distinctive
/// enough not to appear in an unrelated domain, and these are.
const MESSAGING_URL_MARKERS: &[&str] = &["web.whatsapp.com", "messenger.com", "web.telegram.org"];

/// Whether this foreground window is one of the messaging apps/sites a
/// screenshot should be blurred for. `url` is the same reading
/// `EventBuilder::screenshot` already attaches to the event - no extra
/// capture happens to answer this.
pub fn is_messaging_target(process_name: &str, url: Option<&str>) -> bool {
    // Lowercase before trimming ".exe" - trim_end_matches is case-sensitive,
    // so trimming first left "TELEGRAM.EXE" untouched and never matched.
    let lowered = process_name.trim().to_lowercase();
    let exe = lowered.trim_end_matches(".exe");
    if !exe.is_empty()
        && MESSAGING_EXES
            .iter()
            .any(|candidate| candidate.trim_end_matches(".exe") == exe)
    {
        return true;
    }
    if let Some(url) = url {
        if let Some(host) = url_host(url) {
            if MESSAGING_URL_MARKERS
                .iter()
                .any(|marker| host == *marker || host.ends_with(&format!(".{marker}")))
            {
                return true;
            }
        }
    }
    false
}

/// The lowercased host of a URL, with scheme, userinfo, port, path, query and
/// fragment all stripped - e.g. `https://user@web.whatsapp.com:443/a/b?x#y`
/// becomes `web.whatsapp.com`.
///
/// A plain `url.contains(marker)` used to blur screenshots that had nothing
/// to do with the marked service - "messenger.com" as a substring also
/// matches an unrelated domain like "trendmessenger.com", and matches inside
/// a path or query string on any site at all (a shared link, a redirect
/// target, an ad-tracking parameter). Comparing only the host, and requiring
/// it to equal the marker or end with it on a label boundary (".marker"),
/// keeps every case the marker list was actually written for while dropping
/// those false positives.
fn url_host(url: &str) -> Option<String> {
    let after_scheme = url.split("://").nth(1).unwrap_or(url);
    let authority_end = after_scheme.find(['/', '?', '#']).unwrap_or(after_scheme.len());
    let authority = &after_scheme[..authority_end];
    let host_and_port = authority.rsplit_once('@').map(|(_, h)| h).unwrap_or(authority);
    let host = host_and_port.split(':').next().unwrap_or(host_and_port).trim();
    if host.is_empty() {
        None
    } else {
        Some(host.to_lowercase())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_messaging_apps_are_matched_by_process_name() {
        assert!(is_messaging_target("Telegram.exe", None));
        assert!(is_messaging_target("WhatsApp.exe", None));
        assert!(is_messaging_target("Messenger.exe", None));
        // macOS has no .exe suffix on process names.
        assert!(is_messaging_target("Telegram", None));
    }

    #[test]
    fn matching_is_case_insensitive_and_trims_whitespace() {
        assert!(is_messaging_target("  TELEGRAM.EXE  ", None));
    }

    #[test]
    fn browser_tabs_on_a_messaging_site_are_matched_by_url() {
        assert!(is_messaging_target(
            "chrome.exe",
            Some("https://web.whatsapp.com/")
        ));
        assert!(is_messaging_target(
            "chrome.exe",
            Some("https://www.messenger.com/t/12345")
        ));
        assert!(is_messaging_target(
            "msedge.exe",
            Some("https://web.telegram.org/k/#@someone")
        ));
    }

    #[test]
    fn an_unrelated_app_or_site_is_never_matched() {
        assert!(!is_messaging_target("code.exe", None));
        assert!(!is_messaging_target(
            "chrome.exe",
            Some("https://github.com/")
        ));
        assert!(!is_messaging_target("chrome.exe", None));
    }

    #[test]
    fn a_domain_that_merely_contains_a_marker_as_a_substring_is_not_matched() {
        // "messenger.com" used to match anywhere in the URL string, including
        // as a substring of an unrelated domain's name - a real false
        // positive, not a hypothetical one.
        assert!(!is_messaging_target(
            "chrome.exe",
            Some("https://trendmessenger.com/")
        ));
        assert!(!is_messaging_target(
            "chrome.exe",
            Some("https://example.com/go?to=messenger.com/spam")
        ));
    }

    #[test]
    fn a_subdomain_of_a_marked_host_still_matches() {
        assert!(is_messaging_target(
            "chrome.exe",
            Some("https://sub.web.telegram.org/k/")
        ));
    }

    #[test]
    fn userinfo_and_port_in_the_url_do_not_defeat_host_matching() {
        assert!(is_messaging_target(
            "chrome.exe",
            Some("https://user:pass@web.whatsapp.com:443/")
        ));
    }
}
