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
