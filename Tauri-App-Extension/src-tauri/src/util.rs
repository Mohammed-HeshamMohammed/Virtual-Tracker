use std::env;
#[cfg(not(target_os = "windows"))]
use std::process::Command;

use reqwest::blocking::Client;

pub fn server_label(api_url: &str) -> String {
    let host = api_url
        .replace("http://", "")
        .replace("https://", "");
    format!("Ext-Server: {host}")
}

pub fn open_url_in_launcher_or_browser(fallback_url: &str, link_token: Option<&str>, hint: Option<&str>) {
    let mut opened_in_launcher = false;
    if let Ok(port) = env::var("VT_LAUNCHER_PORT") {
        let mut url = format!("http://localhost:{port}/open");
        if let Some(token) = link_token {
            url.push_str(&format!("?link={}", urlencoding::encode(token)));
            // Same hint the direct-browser fallback below gets - without this
            // the launcher path always lands on the plain link page, ignoring
            // which button (Google/Apple/Create account/Forgot password) sent
            // the user there.
            if let Some(h) = hint {
                url.push('&');
                url.push_str(h);
            }
        }
        log::info!("Requesting local launcher to open URL: {url}");
        if let Ok(res) = Client::new()
            .get(&url)
            .timeout(std::time::Duration::from_secs(3))
            .send()
        {
            if res.status().is_success() {
                log::info!("Successfully opened link via local launcher");
                opened_in_launcher = true;
            }
        }
    }
    if !opened_in_launcher {
        log::info!("Falling back to default system browser for URL: {fallback_url}");
        open_system_browser(fallback_url);
    }
}

pub fn open_system_browser(url: &str) {
    #[cfg(target_os = "windows")]
    {
        // ShellExecuteW hands the URL straight to the OS's URL handler - unlike
        // `cmd /C start`, it never reparses the string as a command line, so
        // shell metacharacters (&, |, %VAR%) in `url` can't be interpreted.
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        fn to_wide(s: &str) -> Vec<u16> {
            s.encode_utf16().chain(std::iter::once(0)).collect()
        }
        let operation = to_wide("open");
        let file = to_wide(url);
        unsafe {
            ShellExecuteW(
                None,
                PCWSTR(operation.as_ptr()),
                PCWSTR(file.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            );
        }
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(url).spawn();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = Command::new("xdg-open").arg(url).spawn();
    }
}

pub fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Fixed allow-list for the `hint` query param appended to the browser
/// sign-in URL (see `agent::controller::open_sign_in` and
/// `auth::link_flow::AgentLinkFlow::start`). Unlike the link token spliced in
/// next to it, `hint` used to go into that URL unescaped/unvalidated - only
/// these exact values are ever sent by the frontend (App.tsx's sign-in
/// buttons), so anything else is dropped rather than trusted.
pub fn is_allowed_link_hint(hint: &str) -> bool {
    matches!(
        hint,
        "provider=google" | "provider=apple" | "mode=signup" | "mode=forgot-password"
    )
}

/// Where to send the browser for a given (already-validated) sign-in hint.
///
/// `provider=google` skips our own web login page entirely and opens
/// Auth-Backend's `/api/auth/google/start`, which 302s straight to Google's
/// account chooser - a genuine one-hop instead of a visible flash of our own
/// site before Firebase's client SDK (running on that page) redirects away.
/// Every other hint (`provider=apple`, `mode=signup`, `mode=forgot-password`,
/// or none) still targets the web login page, which reads the hint itself to
/// jump to the right pane/provider.
pub fn build_link_sign_in_url(
    web_url: &str,
    auth_url: &str,
    encoded_link_token: &str,
    valid_hint: Option<&str>,
) -> String {
    if valid_hint == Some("provider=google") {
        return format!("{auth_url}/api/auth/google/start?link={encoded_link_token}");
    }
    let mut url = format!("{web_url}/?link={encoded_link_token}");
    if let Some(h) = valid_hint {
        url.push('&');
        url.push_str(h);
    }
    url
}

#[cfg(test)]
mod link_sign_in_url_tests {
    use super::build_link_sign_in_url;

    #[test]
    fn google_hint_targets_auth_backend_directly() {
        let url = build_link_sign_in_url(
            "https://app.example.com",
            "https://auth.example.com",
            "tok123",
            Some("provider=google"),
        );
        assert_eq!(url, "https://auth.example.com/api/auth/google/start?link=tok123");
    }

    #[test]
    fn apple_hint_still_targets_the_web_login_page() {
        let url = build_link_sign_in_url(
            "https://app.example.com",
            "https://auth.example.com",
            "tok123",
            Some("provider=apple"),
        );
        assert_eq!(url, "https://app.example.com/?link=tok123&provider=apple");
    }

    #[test]
    fn no_hint_targets_the_plain_web_login_page() {
        let url = build_link_sign_in_url(
            "https://app.example.com",
            "https://auth.example.com",
            "tok123",
            None,
        );
        assert_eq!(url, "https://app.example.com/?link=tok123");
    }
}
