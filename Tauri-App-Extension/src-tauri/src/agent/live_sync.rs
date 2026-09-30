//! PLAN-livesyncandagenttimer.md P10 - subscribes the agent to the same presence-WebSocket
//! change bus Dashboard-Web reuses as its live-sync transport (§3/§4).
use std::io::ErrorKind;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use tungstenite::{client::IntoClientRequest, Message};

use crate::client::api::ApiClient;

pub type LiveSyncCallback = Arc<dyn Fn(String) + Send + Sync>;

/// Same cadence as presence-ws.ts's HEARTBEAT_MS, well under the server's 120s
/// heartbeatStaleMs.
const PING_INTERVAL: Duration = Duration::from_secs(30);
/// How often a blocked read wakes up to check whether it's time to ping.
const READ_POLL_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Starts quickly, then backs off so an unavailable network is not polled continuously.
const INITIAL_RECONNECT_BACKOFF: Duration = Duration::from_secs(2);
const MAX_RECONNECT_BACKOFF: Duration = Duration::from_secs(60);
const NOT_SIGNED_IN_RETRY: Duration = Duration::from_secs(5);

/// Spawns the subscriber thread. Fire-and-forget: a failure here must never affect the
/// rest of the agent, which is why this returns nothing and every error inside just
/// logs and retries.
pub fn spawn(api_url: String, api: Arc<Mutex<ApiClient>>, on_message: LiveSyncCallback) {
    thread::Builder::new()
        .name("vt-live-sync".into())
        .spawn(move || run_loop(&api_url, &api, on_message.as_ref()))
        .ok();
}

/// The Firebase close code the presence gateway uses for a token it will not accept.
const CLOSE_UNAUTHORIZED: u16 = 4401;

/// A token good enough to open the socket with, or `None` if there is none to be had right now.
///
/// This socket is what makes the member "online" on the People page, and it is opened by an
/// open tracker whether or not a session is running - so it cannot depend on some other
/// request having refreshed the token first. A tracker that starts minimized at login holds
/// the previous run's saved token, long expired, and nothing else may touch the API for a
/// while: reading `id_token` raw meant reconnecting with that dead token every couple of
/// seconds, being refused each time, and showing the person offline.
fn fresh_token(api: &Arc<Mutex<ApiClient>>) -> Option<String> {
    let mut api = api.lock();
    if api.refresh_token_if_needed() {
        api.id_token.clone()
    } else {
        None
    }
}

fn run_loop(api_url: &str, api: &Arc<Mutex<ApiClient>>, on_message: &(dyn Fn(String) + Send + Sync)) {
    let mut reconnect_backoff = INITIAL_RECONNECT_BACKOFF;
    loop {
        if api.lock().id_token.is_none() {
            thread::sleep(NOT_SIGNED_IN_RETRY);
            continue;
        }
        let Some(token) = fresh_token(api) else {
            // Signed in, but the token cannot be renewed right now (offline, or the session
            // needs a re-link). Back off like any other failed attempt: a rejected refresh
            // token is remembered, so this costs nothing until something changes.
            thread::sleep(reconnect_backoff);
            reconnect_backoff = (reconnect_backoff * 2).min(MAX_RECONNECT_BACKOFF);
            continue;
        };

        // Always back off before retrying, including a clean server-initiated close.
        match connect_and_pump(api_url, &token, on_message) {
            Ok(()) => reconnect_backoff = INITIAL_RECONNECT_BACKOFF,
            Err(err) => {
                log::warn!("[live-sync] {err}");
                thread::sleep(reconnect_backoff);
                reconnect_backoff = (reconnect_backoff * 2).min(MAX_RECONNECT_BACKOFF);
                continue;
            }
        }
        thread::sleep(reconnect_backoff);
    }
}

fn connect_and_pump(
    api_url: &str,
    token: &str,
    on_message: &(dyn Fn(String) + Send + Sync),
) -> Result<(), String> {
    let (tls, host, port) = parse_ws_target(api_url)?;
    let addr = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|e| format!("dns lookup for {host} failed: {e}"))?
        .next()
        .ok_or_else(|| format!("no address resolved for {host}"))?;

    let stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).map_err(|e| format!("connect failed: {e}"))?;
    stream
        .set_read_timeout(Some(READ_POLL_TIMEOUT))
        .map_err(|e| format!("set_read_timeout failed: {e}"))?;

    let scheme = if tls { "wss" } else { "ws" };
    let url = format!("{scheme}://{host}:{port}/api/presence/ws");
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("invalid websocket request: {e}"))?;
    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {token}")
            .parse()
            .map_err(|_| "invalid authorization header".to_string())?,
    );

    let (mut socket, _response) = tungstenite::client_tls(request, stream)
        .map_err(|e| format!("handshake failed: {e}"))?;
    log::info!("[live-sync] connected");

    let mut last_ping = Instant::now();
    loop {
        match socket.read() {
            Ok(Message::Text(text)) => {
                // Re-serialize through serde_json rather than forwarding the wire bytes
                // verbatim: the callback embeds this string directly into a
                match serde_json::from_str::<serde_json::Value>(&text) {
                    Ok(value) => {
                        if let Ok(canonical) = serde_json::to_string(&value) {
                            on_message(canonical);
                        }
                    }
                    Err(err) => log::warn!("[live-sync] dropped non-JSON frame: {err}"),
                }
            }
            Ok(Message::Close(frame)) => {
                // A refused token is a failure to back off from and retry with a renewed
                // token - not a clean close to reconnect to in two seconds with the same one.
                if frame.as_ref().is_some_and(|f| u16::from(f.code) == CLOSE_UNAUTHORIZED) {
                    return Err("the server refused this session's token".to_string());
                }
                return Ok(());
            }
            Ok(_) => {}
            Err(tungstenite::Error::Io(io_err))
                if io_err.kind() == ErrorKind::WouldBlock || io_err.kind() == ErrorKind::TimedOut =>
            {
                // Just the read-timeout poll tick, not a real error - fall through to the
                // ping check below.
            }
            Err(err) => return Err(format!("read failed: {err}")),
        }

        if last_ping.elapsed() >= PING_INTERVAL {
            socket
                .send(Message::Text(r#"{"type":"ping"}"#.into()))
                .map_err(|e| format!("ping send failed: {e}"))?;
            last_ping = Instant::now();
        }
    }
}

/// Returns (uses_tls, host, port).
fn parse_ws_target(api_url: &str) -> Result<(bool, String, u16), String> {
    let (tls, rest) = if let Some(rest) = api_url.strip_prefix("https://") {
        (true, rest)
    } else if let Some(rest) = api_url.strip_prefix("http://") {
        (false, rest)
    } else {
        return Err(format!("unrecognized API URL scheme: {api_url}"));
    };
    // Strip any path in case an override includes one - the presence path is appended
    // separately in connect_and_pump.
    let authority = rest.split('/').next().unwrap_or(rest);
    let default_port = if tls { 443 } else { 80 };
    match authority.rsplit_once(':') {
        Some((host, port_str)) => {
            let port = port_str.parse::<u16>().map_err(|_| format!("bad port in API URL: {api_url}"))?;
            Ok((tls, host.to_string(), port))
        }
        None => Ok((tls, authority.to_string(), default_port)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    fn jwt_expiring_at(exp_secs: i64) -> String {
        let enc = |v: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v.as_bytes());
        format!("{}.{}.sig", enc(r#"{"alg":"none"}"#), enc(&format!(r#"{{"exp":{exp_secs}}}"#)))
    }

    fn api_with(id_token: &str) -> Arc<Mutex<ApiClient>> {
        let mut client = ApiClient::new("http://127.0.0.1:9".into(), "http://127.0.0.1:9".into()).expect("client");
        client.set_tokens(id_token, "");
        Arc::new(Mutex::new(client))
    }

    #[test]
    fn a_token_that_is_still_good_is_used_as_is() {
        let token = jwt_expiring_at(4_102_444_800); // year 2100
        assert_eq!(fresh_token(&api_with(&token)), Some(token));
    }

    #[test]
    fn an_expired_token_that_cannot_be_renewed_is_not_handed_to_the_socket() {
        // The old behaviour returned this dead token and looped on the server refusing it.
        let api = api_with(&jwt_expiring_at(1_000_000_000)); // 2001, no refresh token, no device credential
        assert_eq!(fresh_token(&api), None);
    }

    #[test]
    fn signed_out_has_no_token() {
        let api = Arc::new(Mutex::new(
            ApiClient::new("http://127.0.0.1:9".into(), "http://127.0.0.1:9".into()).expect("client"),
        ));
        assert_eq!(fresh_token(&api), None);
    }
}
