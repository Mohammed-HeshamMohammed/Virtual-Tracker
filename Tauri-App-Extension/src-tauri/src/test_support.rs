//! Suggestion #14: shared test-only helpers for exercising real HTTP code (`ApiClient`'s
//! network methods, `ActivityTracker::tick()`, `AuthServer`'s routes) without a mocking

use std::thread;

use base64::Engine;
use tiny_http::{Response, Server};

/// Minimal in-process HTTP server for exercising client code against real HTTP over a real
/// socket.
pub fn fake_server<F>(mut handler: F) -> String
where
    F: FnMut(&mut tiny_http::Request) -> (u16, String) + Send + 'static,
{
    let server = Server::http("127.0.0.1:0").expect("bind fake test server");
    let addr = server.server_addr();
    thread::Builder::new()
        .name("vt-test-fake-server".into())
        .spawn(move || {
            for mut request in server.incoming_requests() {
                let (status, body) = handler(&mut request);
                let response = Response::from_string(body).with_status_code(status);
                let _ = request.respond(response);
            }
        })
        .expect("spawn fake test server thread");
    format!("http://{addr}")
}

/// A `Settings` pointed at `api_url`, with every filesystem path inside its own fresh
/// temp directory so parallel tests never share state (the queue file in particular).
pub fn test_settings(api_url: String) -> crate::config::Settings {
    // Not `{:?}` of an Instant: on Windows that prints "Instant { t: 1.2s }", the ':'
    // makes the path invalid, and every queue/progress write then failed silently.
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "vt-test-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    // A recycled pid can land on a dir an earlier run left behind, queue file and all.
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create the test's temp dir");
    crate::config::Settings {
        api_url,
        web_url: "http://127.0.0.1:1".into(),
        auth_url: "http://127.0.0.1:1".into(),
        auth_port: 0,
        store_path: dir.join("store.json"),
        prefs_path: dir.join("prefs.json"),
        queue_path: dir.join("queue.jsonl"),
        classification_cache_path: dir.join("classifications.json"),
        progress_path: dir.join("progress.json"),
        log_path: dir.join("agent.log"),
        url_script_path: dir.join("missing-get-browser-url.ps1"),
        macos_url_script_path: dir.join("missing-get-browser-url.applescript"),
        app_icon_script_path: dir.join("missing-get-app-icon.ps1"),
    }
}

/// A syntactically valid (unsigned) JWT carrying only the `exp` claim that matters to
/// `FirebaseTokenService::id_token_expiry_ms`.
pub fn fake_jwt(exp_offset_secs: i64) -> String {
    let exp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock")
        .as_secs() as i64
        + exp_offset_secs;
    let payload = serde_json::json!({ "exp": exp });
    let encoded =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes());
    format!("header.{encoded}.sig")
}
