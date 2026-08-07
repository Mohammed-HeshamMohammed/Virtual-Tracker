//! PLAN-livesyncandagenttimer.md P10 - subscribes the agent to the same
//! presence-WebSocket change bus Dashboard-Web reuses as its live-sync
//! transport (§3/§4). Best-effort only: frames carry no data (§4.1), this
//! thread only exists to shrink the 5s SESSION_POLL_SEC gap to sub-second for
//! `changedEvent("task-assignments")`/`changedEvent("tasks")` (case 45, T4/T5).
//! The poll stays as-is and is what keeps working when this connection is
//! down - never remove it in favor of this.
//!
//! Runs on its own OS thread using a *blocking* stream (matching this app's
//! existing all-blocking-call architecture - see `run_blocking` in lib.rs for
//! why nothing here uses the tokio runtime tauri carries). A manually-built
//! `TcpStream` with a read timeout is used instead of `tungstenite::connect`
//! so the same thread can both read incoming frames and send the periodic
//! application-level `{"type":"ping"}` presence-gateway.js requires (it only
//! resets its 120s heartbeat watch on that message, not on WS-protocol control
//! frames) - see `Dashboard-Web/features/auth/services/presence-ws.ts` for the
//! client this mirrors.
use std::io::ErrorKind;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use tungstenite::Message;

use crate::client::api::ApiClient;

pub type LiveSyncCallback = Arc<dyn Fn(String) + Send + Sync>;

/// Same cadence as presence-ws.ts's HEARTBEAT_MS, well under the server's
/// 120s heartbeatStaleMs.
const PING_INTERVAL: Duration = Duration::from_secs(30);
/// How often a blocked read wakes up to check whether it's time to ping.
const READ_POLL_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Matches presence-ws.ts's reconnect backoff.
const RECONNECT_BACKOFF: Duration = Duration::from_secs(5);
const NOT_SIGNED_IN_RETRY: Duration = Duration::from_secs(5);

/// Spawns the subscriber thread. Fire-and-forget: a failure here must never
/// affect the rest of the agent, which is why this returns nothing and every
/// error inside just logs and retries.
pub fn spawn(api_url: String, api: Arc<Mutex<ApiClient>>, on_message: LiveSyncCallback) {
    thread::Builder::new()
        .name("vt-live-sync".into())
        .spawn(move || run_loop(&api_url, &api, on_message.as_ref()))
        .ok();
}

fn run_loop(api_url: &str, api: &Arc<Mutex<ApiClient>>, on_message: &(dyn Fn(String) + Send + Sync)) {
    loop {
        let token = api.lock().id_token.clone();
        let Some(token) = token else {
            thread::sleep(NOT_SIGNED_IN_RETRY);
            continue;
        };

        // Always back off before retrying, including a clean server-initiated
        // close (e.g. a rejected/expired token) - otherwise a server that
        // keeps closing the connection immediately turns into a hot loop.
        if let Err(err) = connect_and_pump(api_url, &token, on_message) {
            log::warn!("[live-sync] {err}");
        }
        thread::sleep(RECONNECT_BACKOFF);
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
    let url = format!("{scheme}://{host}:{port}/api/presence/ws?token={}", urlencoding::encode(token));

    let (mut socket, _response) = tungstenite::client_tls(&url, stream).map_err(|e| format!("handshake failed: {e}"))?;
    log::info!("[live-sync] connected");

    let mut last_ping = Instant::now();
    loop {
        match socket.read() {
            Ok(Message::Text(text)) => {
                // Re-serialize through serde_json rather than forwarding the
                // wire bytes verbatim: the callback embeds this string
                // directly into a `window.eval(...)` call (see lib.rs), so
                // this is what guarantees it's syntactically valid JSON with
                // every string properly escaped, not a trust assumption
                // about what the server happens to send.
                match serde_json::from_str::<serde_json::Value>(&text) {
                    Ok(value) => {
                        if let Ok(canonical) = serde_json::to_string(&value) {
                            on_message(canonical);
                        }
                    }
                    Err(err) => log::warn!("[live-sync] dropped non-JSON frame: {err}"),
                }
            }
            Ok(Message::Close(_)) => return Ok(()),
            Ok(_) => {}
            Err(tungstenite::Error::Io(io_err))
                if io_err.kind() == ErrorKind::WouldBlock || io_err.kind() == ErrorKind::TimedOut =>
            {
                // Just the read-timeout poll tick, not a real error - fall
                // through to the ping check below.
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

/// Returns (uses_tls, host, port). `api_url` is `https://host[:port]`
/// (Settings::load() strips any trailing slash and never leaves a path).
fn parse_ws_target(api_url: &str) -> Result<(bool, String, u16), String> {
    let (tls, rest) = if let Some(rest) = api_url.strip_prefix("https://") {
        (true, rest)
    } else if let Some(rest) = api_url.strip_prefix("http://") {
        (false, rest)
    } else {
        return Err(format!("unrecognized API URL scheme: {api_url}"));
    };
    // Strip any path in case an override includes one - the presence path is
    // appended separately in connect_and_pump.
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
