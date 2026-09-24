//! Personal messaging apps and sites the agent blurs a screenshot for, rather than skip
//! capturing entirely.

/// Executable names (Windows) or bundle-derived process names (macOS), lowercased; the
/// caller trims any `.exe` before comparing.
const MESSAGING_EXES: &[&str] = &[
    "telegram",
    "whatsapp",
    "messenger",
    "discord",
    "slack",
    "signal",
    "skype",
    "viber",
    "wechat",
    "line",
    "element",
    "teams",     // classic Microsoft Teams
    "ms-teams",  // the newer client
    "messages",  // macOS iMessage
];

/// Hosts whose every page is a conversation.
const MESSAGING_URL_HOSTS: &[&str] = &[
    "web.whatsapp.com",
    "messenger.com",
    "web.telegram.org",
    "discord.com",
    "slack.com",
    "teams.microsoft.com",
    "teams.live.com",
    "web.skype.com",
    "element.io",
    "chat.google.com",
    "web.wechat.com",
    "app.chanty.com",
];

/// Conversations that live at a path inside an ordinary site, so the host alone cannot
/// identify them.
const MESSAGING_URL_PATHS: &[(&str, &str)] = &[
    ("facebook.com", "/messages"),
    ("instagram.com", "/direct"),
    ("x.com", "/messages"),
    ("twitter.com", "/messages"),
    ("linkedin.com", "/messaging"),
    ("discord.com", "/channels"),
];

/// Words that identify a messaging app when they appear as a whole word in a window title.
const TITLE_WORDS: &[&str] = &[
    "whatsapp",
    "telegram",
    "discord",
    "messenger",
    "imessage",
    "viber",
    "wechat",
    "snapchat",
];

/// Multi-word titles for apps whose name is too common to match on its own.
const TITLE_PHRASES: &[&str] = &[
    "microsoft teams",
    "signal desktop",
    "google chat",
    "facebook messenger",
    "slack |", // Slack's own title format: "Slack | general | Workspace"
];

/// Whether this foreground window is one of the messaging apps/sites a screenshot should be
/// blurred for.
pub fn is_messaging_target(process_name: &str, url: Option<&str>, title: Option<&str>) -> bool {
    if process_matches(process_name) {
        return true;
    }
    if url.is_some_and(url_matches) {
        return true;
    }
    title.is_some_and(title_matches)
}

fn process_matches(process_name: &str) -> bool {
    // Lowercase before trimming ".exe" - trim_end_matches is case-sensitive, so trimming
    // first left "TELEGRAM.EXE" untouched and never matched.
    let lowered = process_name.trim().to_lowercase();
    let exe = lowered.trim_end_matches(".exe");
    !exe.is_empty() && MESSAGING_EXES.iter().any(|candidate| *candidate == exe)
}

fn url_matches(url: &str) -> bool {
    let Some(host) = url_host(url) else {
        return false;
    };
    let host_is = |marker: &str| host == marker || host.ends_with(&format!(".{marker}"));

    if MESSAGING_URL_HOSTS.iter().any(|marker| host_is(marker)) {
        return true;
    }

    let path = url_path(url);
    MESSAGING_URL_PATHS.iter().any(|(marker_host, marker_path)| {
        host_is(marker_host) && (path == *marker_path || path.starts_with(&format!("{marker_path}/")))
    })
}

/// Whole-word matching, so "WhatsApp" in a title is a hit but "whatsappish" is not, and a
/// phrase only counts where its words are adjacent.
fn title_matches(title: &str) -> bool {
    let lowered = title.to_lowercase();
    if TITLE_PHRASES.iter().any(|phrase| lowered.contains(phrase)) {
        return true;
    }
    lowered
        .split(|c: char| !c.is_alphanumeric())
        .any(|word| TITLE_WORDS.contains(&word))
}

/// The lowercased host of a URL, with scheme, userinfo, port, path, query and fragment all
/// stripped - e.g.
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

/// The lowercased path, without query or fragment.
fn url_path(url: &str) -> String {
    let after_scheme = url.split("://").nth(1).unwrap_or(url);
    let Some(path_start) = after_scheme.find('/') else {
        return String::new();
    };
    let path = &after_scheme[path_start..];
    let end = path.find(['?', '#']).unwrap_or(path.len());
    path[..end].trim_end_matches('/').to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(process: &str, url: Option<&str>) -> bool {
        is_messaging_target(process, url, None)
    }

    #[test]
    fn desktop_messaging_apps_are_matched_by_process_name() {
        assert!(target("Telegram.exe", None));
        assert!(target("WhatsApp.exe", None));
        assert!(target("Messenger.exe", None));
        // MacOS has no .exe suffix on process names.
        assert!(target("Telegram", None));
    }

    #[test]
    fn the_wider_set_of_messaging_apps_is_matched_too() {
        // These were all missed before: the list only had three apps.
        for process in ["Discord.exe", "slack.exe", "Signal.exe", "Teams.exe", "ms-teams.exe", "Skype.exe"] {
            assert!(target(process, None), "{process} should blur");
        }
    }

    #[test]
    fn matching_is_case_insensitive_and_trims_whitespace() {
        assert!(target("  TELEGRAM.EXE  ", None));
    }

    #[test]
    fn browser_tabs_on_a_messaging_site_are_matched_by_url() {
        assert!(target("chrome.exe", Some("https://web.whatsapp.com/")));
        assert!(target("chrome.exe", Some("https://www.messenger.com/t/12345")));
        assert!(target("msedge.exe", Some("https://web.telegram.org/k/#@someone")));
        assert!(target("chrome.exe", Some("https://discord.com/channels/123/456")));
        assert!(target("chrome.exe", Some("https://app.slack.com/client/T1/C1")));
        assert!(target("chrome.exe", Some("https://teams.microsoft.com/_#/conversations")));
    }

    #[test]
    fn direct_messages_inside_an_ordinary_site_are_matched_by_path() {
        // A host-only rule cannot see these: the conversation lives under the same host as
        // the rest of the site.
        assert!(target("chrome.exe", Some("https://www.facebook.com/messages/t/99")));
        assert!(target("chrome.exe", Some("https://www.instagram.com/direct/inbox/")));
        assert!(target("chrome.exe", Some("https://x.com/messages/12-34")));
        assert!(target("chrome.exe", Some("https://www.linkedin.com/messaging/thread/1")));
    }

    #[test]
    fn the_rest_of_those_sites_is_not_blurred() {
        // Only the conversation paths, not the whole site - someone's LinkedIn feed is not
        // a private conversation.
        assert!(!target("chrome.exe", Some("https://www.facebook.com/somepage")));
        assert!(!target("chrome.exe", Some("https://www.instagram.com/explore/")));
        assert!(!target("chrome.exe", Some("https://www.linkedin.com/feed/")));
        // ...and a path that merely starts with the same letters is not it.
        assert!(!target("chrome.exe", Some("https://x.com/messagesomething")));
    }

    #[test]
    fn a_title_catches_what_the_process_and_url_cannot() {
        assert!(is_messaging_target("ApplicationFrameHost.exe", None, Some("WhatsApp")));
        assert!(is_messaging_target("chrome.exe", None, Some("(3) WhatsApp - Google Chrome")));
        assert!(is_messaging_target("chrome.exe", None, Some("Telegram Web")));
        assert!(is_messaging_target(
            "ApplicationFrameHost.exe",
            None,
            Some("General | MyTeam | Microsoft Teams")
        ));
    }

    #[test]
    fn a_title_word_only_matches_whole_words() {
        assert!(!is_messaging_target("code.exe", None, Some("whatsappish.md")));
        assert!(!is_messaging_target("code.exe", None, Some("telegraph.txt")));
    }

    #[test]
    fn everyday_words_do_not_blur_by_themselves() {
        // The reason "signal", "teams", "line" and "messages" are not title words: these
        // are ordinary documents, not conversations.
        assert!(!is_messaging_target("excel.exe", None, Some("signal strength report.xlsx")));
        assert!(!is_messaging_target("word.exe", None, Some("teams and responsibilities.docx")));
        assert!(!is_messaging_target("code.exe", None, Some("line endings.txt")));
        assert!(!is_messaging_target("outlook.exe", None, Some("Inbox - 42 messages")));
        assert!(!is_messaging_target("word.exe", None, Some("picking up the slack.docx")));
    }

    #[test]
    fn an_unrelated_app_or_site_is_never_matched() {
        assert!(!target("code.exe", None));
        assert!(!target("chrome.exe", Some("https://github.com/")));
        assert!(!target("chrome.exe", None));
    }

    #[test]
    fn a_domain_that_merely_contains_a_marker_as_a_substring_is_not_matched() {
        assert!(!target("chrome.exe", Some("https://trendmessenger.com/")));
        assert!(!target("chrome.exe", Some("https://example.com/go?to=messenger.com/spam")));
        assert!(!target("chrome.exe", Some("https://notdiscord.com/")));
    }

    #[test]
    fn a_subdomain_of_a_marked_host_still_matches() {
        assert!(target("chrome.exe", Some("https://sub.web.telegram.org/k/")));
    }

    #[test]
    fn userinfo_and_port_in_the_url_do_not_defeat_host_matching() {
        assert!(target("chrome.exe", Some("https://user:pass@web.whatsapp.com:443/")));
    }

    #[test]
    fn a_process_name_must_match_whole_not_merely_contain() {
        // "line" is in the app list; a process called "lineup.exe" is not it.
        assert!(!target("lineup.exe", None));
        assert!(!target("slackbuild.exe", None));
    }
}
