use std::io::Cursor;
use std::sync::Arc;
use std::thread;

use parking_lot::Mutex;
use serde_json::{json, Value};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

use crate::auth::link_flow::AgentLinkFlow;
use crate::client::api::ApiClient;
use crate::constants::{
    AGENT_NAME, APP_VERSION, CREDENTIALS_LINK_PATH, HEALTH_PATH, RESUME_LINK_PATH,
};

pub struct AuthServer {
    port: u16,
    api_url: String,
    web_url: String,
    api: Arc<Mutex<ApiClient>>,
    link_flow: Arc<AgentLinkFlow>,
    stop: Arc<Mutex<bool>>,
}

impl AuthServer {
    pub fn new(
        port: u16,
        api_url: String,
        web_url: String,
        api: Arc<Mutex<ApiClient>>,
        link_flow: Arc<AgentLinkFlow>,
    ) -> Self {
        Self {
            port,
            api_url,
            web_url,
            api,
            link_flow,
            stop: Arc::new(Mutex::new(false)),
        }
    }

    pub fn start(&self) {
        let addr = format!("127.0.0.1:{}", self.port);
        let server = match Server::http(&addr) {
            Ok(s) => s,
            Err(err) => {
                log::error!("Failed to bind health server on {addr}: {err}");
                return;
            }
        };
        log::info!("Agent health listening on http://{addr}");

        let api_url = self.api_url.clone();
        let web_url = self.web_url.clone();
        let api = Arc::clone(&self.api);
        let link_flow = Arc::clone(&self.link_flow);
        let stop = Arc::clone(&self.stop);

        thread::Builder::new()
            .name("vt-health-server".into())
            .spawn(move || {
                for request in server.incoming_requests() {
                    if *stop.lock() {
                        break;
                    }
                    handle_request(request, &api_url, &web_url, &api, &link_flow);
                }
            })
            .ok();
    }

    pub fn stop(&self) {
        *self.stop.lock() = true;
        // Wake the server with a local request.
        let _ = reqwest::blocking::Client::new()
            .get(format!("http://127.0.0.1:{}/health", self.port))
            .timeout(std::time::Duration::from_millis(200))
            .send();
    }
}

fn handle_request(
    mut request: Request,
    api_url: &str,
    web_url: &str,
    api: &Arc<Mutex<ApiClient>>,
    link_flow: &Arc<AgentLinkFlow>,
) {
    let method = request.method().clone();
    let url = request.url().to_string();
    let path = url.split('?').next().unwrap_or(&url);

    if method == Method::Options {
        let _ = respond_empty(request, StatusCode(204), web_url);
        return;
    }

    if method == Method::Get && path == HEALTH_PATH {
        let link_token = link_flow.pending_link_token();
        let payload = json!({
            "ok": true,
            "agent": AGENT_NAME,
            "version": APP_VERSION,
            "apiUrl": api_url,
            "authenticated": api.lock().is_authenticated(),
            "linkPending": link_token.is_some(),
            "linkToken": link_token,
        });
        let _ = respond_json(request, StatusCode(200), &payload, web_url);
        return;
    }

    if method == Method::Post && path == RESUME_LINK_PATH {
        let resumed = link_flow.resume_existing();
        let link_token = link_flow.pending_link_token();
        let payload = json!({
            "ok": resumed,
            "linkPending": link_token.is_some(),
            "authenticated": api.lock().is_authenticated(),
        });
        let _ = respond_json(
            request,
            if resumed {
                StatusCode(200)
            } else {
                StatusCode(409)
            },
            &payload,
            web_url,
        );
        return;
    }

    if method == Method::Post && path == CREDENTIALS_LINK_PATH {
        let body = read_body(&mut request);
        let link_token = body
            .get("linkToken")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let id_token = body.get("idToken").and_then(|v| v.as_str()).unwrap_or("");
        let refresh_token = body
            .get("refreshToken")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if link_token.is_empty() || id_token.is_empty() {
            let _ = respond_json(
                request,
                StatusCode(400),
                &json!({"ok": false, "error": "Invalid credentials payload"}),
                web_url,
            );
            return;
        }
        let applied = link_flow.apply_web_credentials(link_token, id_token, refresh_token);
        let payload = json!({
            "ok": applied,
            "authenticated": api.lock().is_authenticated(),
        });
        let _ = respond_json(
            request,
            if applied {
                StatusCode(200)
            } else {
                StatusCode(409)
            },
            &payload,
            web_url,
        );
        return;
    }

    let _ = respond_json(
        request,
        StatusCode(404),
        &json!({"success": false, "error": "Not found"}),
        web_url,
    );
}

fn read_body(request: &mut Request) -> Value {
    let mut buf = Vec::new();
    let reader = request.as_reader();
    if std::io::Read::read_to_end(reader, &mut buf).is_err() {
        return json!({});
    }
    serde_json::from_slice(&buf).unwrap_or_else(|_| json!({}))
}

/// Only the configured dashboard origin may read these responses — this server
/// is reachable by any process on localhost, and a wildcard origin would let
/// any webpage the user has open (via a cross-origin fetch) read auth state
/// and the live link token off it.
fn cors_headers(origin: &str) -> Vec<Header> {
    vec![
        Header::from_bytes("Access-Control-Allow-Origin", origin).unwrap_or_else(|_| {
            Header::from_bytes("Access-Control-Allow-Origin", "null").expect("static header")
        }),
        Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap(),
        Header::from_bytes("Access-Control-Allow-Headers", "Content-Type").unwrap(),
        Header::from_bytes("Access-Control-Allow-Private-Network", "true").unwrap(),
        Header::from_bytes("Content-Type", "application/json").unwrap(),
    ]
}

fn respond_json(
    request: Request,
    status: StatusCode,
    payload: &Value,
    origin: &str,
) -> Result<(), std::io::Error> {
    let body = serde_json::to_vec(payload).unwrap_or_else(|_| b"{}".to_vec());
    let response = Response::new(
        status,
        cors_headers(origin),
        Cursor::new(body.clone()),
        Some(body.len()),
        None,
    );
    request.respond(response)
}

fn respond_empty(request: Request, status: StatusCode, origin: &str) -> Result<(), std::io::Error> {
    let mut headers = cors_headers(origin);
    headers.pop(); // drop Content-Type for empty
    let response = Response::new(status, headers, Cursor::new(Vec::new()), Some(0), None);
    request.respond(response)
}
