//! Suggestion #14: shared test-only helpers for exercising real HTTP code
//! (`ApiClient`'s network methods, `ActivityTracker::tick()`, `AuthServer`'s
//! routes) without a mocking crate. Compiled only under `#[cfg(test)]` - see
//! the `mod test_support;` declaration in `lib.rs`.

use std::thread;

use base64::Engine;
use tiny_http::{Response, Server};

/// Minimal in-process HTTP server for exercising client code against real
/// HTTP over a real socket. `tiny_http` is already a direct dependency - it
/// backs the real local auth callback server in `auth/server.rs` - so this
/// reuses it as a test double instead of adding a mocking crate or hand-
/// parsing raw sockets. `handler` decides the status/body for each request it
/// sees; it runs on the server's own background thread for the lifetime of
/// the test process, so keep it fast and panic-free.
pub fn fake_server<F>(mut handler: F) -> String
where
    F: FnMut(&tiny_http::Request) -> (u16, String) + Send + 'static,
{
    let server = Server::http("127.0.0.1:0").expect("bind fake test server");
    let addr = server.server_addr();
    thread::Builder::new()
        .name("vt-test-fake-server".into())
        .spawn(move || {
            for request in server.incoming_requests() {
                let (status, body) = handler(&request);
                let response = Response::from_string(body).with_status_code(status);
                let _ = request.respond(response);
            }
        })
        .expect("spawn fake test server thread");
    format!("http://{addr}")
}

/// A syntactically valid (unsigned) JWT carrying only the `exp` claim that
/// matters to `FirebaseTokenService::id_token_expiry_ms`. Lets a test hand
/// `ApiClient` an id token it treats as still valid, so `authorized()`'s
/// refresh check passes without a real Firebase round-trip.
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
