use std::env;
use std::process::Command;

use reqwest::blocking::Client;

pub fn server_label(api_url: &str) -> String {
    let host = api_url
        .replace("http://", "")
        .replace("https://", "");
    format!("Ext-Server: {host}")
}

pub fn open_url_in_launcher_or_browser(fallback_url: &str, link_token: Option<&str>) {
    let mut opened_in_launcher = false;
    if let Ok(port) = env::var("VT_LAUNCHER_PORT") {
        let mut url = format!("http://localhost:{port}/open");
        if let Some(token) = link_token {
            url.push_str(&format!("?link={}", urlencoding::encode(token)));
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
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("cmd")
            .args(["/C", "start", "", url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
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
