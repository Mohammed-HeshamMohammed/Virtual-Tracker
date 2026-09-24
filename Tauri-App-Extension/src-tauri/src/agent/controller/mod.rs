use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;

use crate::agent::live_sync::{self, LiveSyncCallback};
use crate::agent::tracker::{ActivityTracker, StatusCallback};
use crate::auth::link_flow::{AgentLinkFlow, OnError, OnTokens};
use crate::auth::server::AuthServer;
use crate::auth::tokens::{StoredCredentials, TokenStore};
use crate::capture::activity::ActivityMeter;
use crate::client::api::ApiClient;
use crate::client::firebase::jwt_payload;
use crate::config::Settings;
use crate::client::firebase::RefreshOutcome;
use crate::constants::{APP_VERSION, CONNECTION_FAILURE_GRACE, MIN_TOKEN_LENGTH};
use crate::prefs::{AppSettingsView, UserPreferences};
use crate::types::{
    ActionResult, AgentTask, ConnectionState, LinkStatus, ProfileInfo, ReconnectResult, SessionInfo,
    SignInResult,
};
use crate::util::{build_link_sign_in_url, is_allowed_link_hint, open_url_in_launcher_or_browser, server_label};

pub struct AgentController {
    pub settings: Settings,
    store: TokenStore,
    api: Arc<Mutex<ApiClient>>,
    tracker: Arc<Mutex<Option<Arc<ActivityTracker>>>>,
    link_flow: Arc<AgentLinkFlow>,
    auth_server: AuthServer,
    status: Arc<Mutex<String>>,
    status_listeners: Arc<Mutex<Vec<StatusCallback>>>,
    /// Separate from `status_listeners` on purpose: status text is routine (shown in the
    /// UI's status line, refetched on every change) and would be noisy to toast on every
    warning_listeners: Arc<Mutex<Vec<StatusCallback>>>,
    live_sync_listeners: Arc<Mutex<Vec<LiveSyncCallback>>>,
    activity: Arc<ActivityMeter>,
    /// Consecutive failed connection checks.
    connection_failures: Arc<AtomicU32>,
}

mod api;
mod auth;
mod session;

impl AgentController {
    pub fn new(settings: Settings) -> Result<Arc<Self>, String> {
        let store = TokenStore::new(settings.store_path.clone());
        let api = Arc::new(Mutex::new(ApiClient::new(
            settings.api_url.clone(),
            settings.auth_url.clone(),
        )?));
        let link_flow = Arc::new(AgentLinkFlow::new(
            Arc::clone(&api),
            settings.web_url.clone(),
            settings.auth_url.clone(),
        ));
        let auth_server = AuthServer::new(
            settings.auth_port,
            settings.api_url.clone(),
            settings.web_url.clone(),
            Arc::clone(&api),
            Arc::clone(&link_flow),
        );
        let activity = ActivityMeter::new();
        let status = Arc::new(Mutex::new("Not signed in".to_string()));
        let status_listeners = Arc::new(Mutex::new(Vec::new()));
        let warning_listeners = Arc::new(Mutex::new(Vec::new()));
        let live_sync_listeners = Arc::new(Mutex::new(Vec::new()));

        Ok(Arc::new(Self {
            settings,
            store,
            api,
            tracker: Arc::new(Mutex::new(None)),
            link_flow,
            auth_server,
            status,
            status_listeners,
            warning_listeners,
            live_sync_listeners,
            activity,
            connection_failures: Arc::new(AtomicU32::new(0)),
        }))
    }

    pub fn add_status_listener(&self, listener: StatusCallback) {
        self.status_listeners.lock().push(listener);
    }

    pub fn add_warning_listener(&self, listener: StatusCallback) {
        self.warning_listeners.lock().push(listener);
    }

    fn on_warning(&self, text: String) {
        for listener in self.warning_listeners.lock().iter() {
            listener(text.clone());
        }
    }

    /// PLAN-livesyncandagenttimer.md P10 - `listener` receives the raw JSON text of every
    /// "changed"/"scope-changed" frame the presence WebSocket delivers.
    pub fn add_live_sync_listener(&self, listener: LiveSyncCallback) {
        self.live_sync_listeners.lock().push(listener);
    }

    pub fn start(self: &Arc<Self>) {
        self.auth_server.start();
        self.restore_session();
        log::info!("API: {}", self.settings.api_url);
        log::info!("Web: {}", self.settings.web_url);

        let listeners = Arc::clone(&self.live_sync_listeners);
        live_sync::spawn(
            self.settings.api_url.clone(),
            Arc::clone(&self.api),
            Arc::new(move |text: String| {
                for listener in listeners.lock().iter() {
                    listener(text.clone());
                }
            }),
        );
    }

    pub fn stop(&self) {
        self.link_flow.stop();
        self.flush_and_stop_tracker("quit");
        self.auth_server.stop();
    }

    /// Closes the open session server-side with the tracker's real accumulated active/idle
    /// seconds (not 0s) before tearing it down — shared by a clean quit, sign-out, and
    fn stop_reason_for(reason: &str) -> &'static str {
        match reason {
            "quit" => "agent_quit",
            "sign-out" => "agent_signout",
            "re-link" => "agent_relink",
            _ => "unspecified",
        }
    }

    fn flush_and_stop_tracker(&self, reason: &str) {
        if let Some(tracker) = self.tracker.lock().as_ref() {
            if let Some(session_id) = tracker.current_session_id() {
                let (task_id, active_seconds, idle_seconds) = tracker.current_task_progress();
                let _ = self.api.lock().post_session_action(
                    "stop",
                    task_id.as_deref(),
                    None,
                    active_seconds,
                    idle_seconds,
                    None,
                    Some(Self::stop_reason_for(reason)),
                );
                log::info!("Closed session {session_id} on {reason} ({active_seconds}s active)");
            }
            tracker.stop();
        }
    }

    pub fn status(&self) -> String {
        self.status.lock().clone()
    }

    pub fn is_link_pending(&self) -> bool {
        self.link_flow.pending_link_token().is_some()
    }

    fn on_status_changed(&self, text: String) {
        *self.status.lock() = text.clone();
        for listener in self.status_listeners.lock().iter() {
            listener(text.clone());
        }
    }










    pub fn open_web_app(&self) {
        open_url_in_launcher_or_browser(&self.settings.web_url, None, None);
    }

    pub fn get_app_settings(&self) -> AppSettingsView {
        AppSettingsView {
            version: APP_VERSION.to_string(),
            preferences: self.settings.preferences_store().load(),
            log_path: self.settings.log_path.to_string_lossy().to_string(),
        }
    }

    /// Opens the diagnostic log file with the OS default handler (Notepad on Windows).
    pub fn open_log_file(&self) -> Result<(), String> {
        if !self.settings.log_path.exists() {
            return Err("No log file yet — run the agent for a bit first.".into());
        }
        crate::util::open_system_browser(&self.settings.log_path.to_string_lossy());
        Ok(())
    }

    pub fn save_preferences(&self, preferences: UserPreferences) -> Result<(), String> {
        self.settings.preferences_store().save(&preferences)
    }

    pub fn get_profile(&self) -> ProfileInfo {
        let server = server_label(&self.settings.api_url);
        let status = self.status().to_lowercase();
        let link_pending = status.contains("linking");
        let token = self.api.lock().id_token.clone();
        let Some(token) = token else {
            return ProfileInfo {
                signed_in: false,
                link_pending,
                name: if link_pending {
                    "Finish linking in browser".into()
                } else {
                    "Not signed in".into()
                },
                email: String::new(),
                avatar_url: String::new(),
                server_label: server,
            };
        };
        let claims = jwt_payload(&token);
        let email = claims
            .get("email")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let name = claims
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| if email.is_empty() { "Signed in".into() } else { email.clone() });
        let avatar_url = claims
            .get("picture")
            .or_else(|| claims.get("avatar_url"))
            .or_else(|| claims.get("avatarUrl"))
            .or_else(|| claims.get("photoURL"))
            .or_else(|| claims.get("photo_url"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        ProfileInfo {
            signed_in: true,
            link_pending: false,
            name,
            email,
            avatar_url,
            server_label: server,
        }
    }

    /// Whether the agent can actually talk to the backend right now, as opposed to merely
    /// holding a token.
    pub fn get_connection_state(&self) -> ConnectionState {
        let (has_token, has_device) = {
            let api = self.api.lock();
            (api.is_authenticated(), api.has_device_credential())
        };
        if !has_token {
            self.connection_failures.store(0, Ordering::SeqCst);
            return ConnectionState::SignedOut;
        }

        let healthy = self.api.lock().refresh_token_if_needed();
        if healthy {
            self.connection_failures.store(0, Ordering::SeqCst);
            return ConnectionState::Connected;
        }

        let failures = self.connection_failures.fetch_add(1, Ordering::SeqCst) + 1;
        if failures < CONNECTION_FAILURE_GRACE {
            // Still inside the grace window - report healthy so the UI does not flicker on
            // a single dropped request.
            return ConnectionState::Connected;
        }

        // Out of grace.
        if has_device {
            ConnectionState::Disconnected
        } else {
            ConnectionState::SignedOut
        }
    }

    /// The "Welcome back" action: get this machine talking to the backend again without
    /// sending the user to a browser.
    pub fn reconnect(self: &Arc<Self>) -> ReconnectResult {
        // 1.
        if self.api.lock().refresh_token_if_needed() {
            return self.finish_reconnect();
        }

        let outcome = self.api.lock().last_refresh;
        if outcome == RefreshOutcome::Unreachable {
            return ReconnectResult {
                success: false,
                needs_relink: false,
                error: Some(
                    "Still can't reach the server. Check your connection and try again.".into(),
                ),
            };
        }

        // 2.
        match self.api.lock().reauth_with_device() {
            Ok(()) => {}
            Err(err) => {
                // `is_rejected()` is the same terminal/retryable split the old `Result<(),
                // bool>` contract carried as `Err(true)`/`Err(false)`.
                let terminal = err.is_rejected();
                return ReconnectResult {
                    success: false,
                    needs_relink: terminal,
                    error: Some(if terminal {
                        "This device is no longer linked to your account.".into()
                    } else {
                        "Still can't reach the server. Check your connection and try again.".into()
                    }),
                };
            }
        }

        // Persist the newly minted tokens and restart tracking cleanly.
        let (id_token, refresh_token) = {
            let api = self.api.lock();
            (
                api.id_token.clone().unwrap_or_default(),
                api.refresh_token.clone().unwrap_or_default(),
            )
        };
        if id_token.is_empty() {
            return ReconnectResult {
                success: false,
                needs_relink: true,
                error: Some("Could not restore your session.".into()),
            };
        }
        self.apply_tokens(id_token, refresh_token);
        self.finish_reconnect()
    }

    fn finish_reconnect(self: &Arc<Self>) -> ReconnectResult {
        self.connection_failures.store(0, Ordering::SeqCst);
        if !self.api.lock().health_ok() {
            return ReconnectResult {
                success: false,
                needs_relink: false,
                error: Some("Signed in, but the server is not responding yet.".into()),
            };
        }
        self.api.lock().register_agent();
        if self.tracker.lock().is_none() {
            self.start_tracker();
        }
        self.on_status_changed("Signed in — waiting for timer".into());
        ReconnectResult {
            success: true,
            needs_relink: false,
            error: None,
        }
    }

    pub fn get_link_status(&self) -> LinkStatus {
        let connected = self.api.lock().health_ok();
        LinkStatus {
            connected,
            server_label: server_label(&self.settings.api_url),
            status: self.status(),
        }
    }


































    /// Whether closing the window should hide it instead of quitting.
    pub fn close_to_tray(&self) -> bool {
        self.settings.preferences_store().load().close_to_tray
    }


}

/// Cheap shape check alongside MIN_TOKEN_LENGTH before treating a stored value as a
/// plausible id token - three non-empty dot-separated segments, the same structural shape
fn looks_like_jwt(token: &str) -> bool {
    let parts: Vec<&str> = token.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty())
}
