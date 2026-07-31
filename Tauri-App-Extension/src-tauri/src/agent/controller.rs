use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;

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
use crate::util::{open_url_in_launcher_or_browser, server_label};

pub struct AgentController {
    pub settings: Settings,
    store: TokenStore,
    api: Arc<Mutex<ApiClient>>,
    tracker: Arc<Mutex<Option<Arc<ActivityTracker>>>>,
    link_flow: Arc<AgentLinkFlow>,
    auth_server: AuthServer,
    status: Arc<Mutex<String>>,
    status_listeners: Arc<Mutex<Vec<StatusCallback>>>,
    activity: Arc<ActivityMeter>,
    /// Consecutive failed connection checks. One blip must not throw a
    /// full-screen recovery view at the user, so the UI only switches after
    /// this passes CONNECTION_FAILURE_GRACE.
    connection_failures: Arc<AtomicU32>,
}

impl AgentController {
    pub fn new(settings: Settings) -> Arc<Self> {
        let store = TokenStore::new(settings.store_path.clone());
        let api = Arc::new(Mutex::new(ApiClient::new(
            settings.api_url.clone(),
            settings.auth_url.clone(),
        )));
        let link_flow = Arc::new(AgentLinkFlow::new(
            Arc::clone(&api),
            settings.web_url.clone(),
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

        Arc::new(Self {
            settings,
            store,
            api,
            tracker: Arc::new(Mutex::new(None)),
            link_flow,
            auth_server,
            status,
            status_listeners,
            activity,
            connection_failures: Arc::new(AtomicU32::new(0)),
        })
    }

    pub fn add_status_listener(&self, listener: StatusCallback) {
        self.status_listeners.lock().push(listener);
    }

    pub fn start(self: &Arc<Self>) {
        self.auth_server.start();
        self.restore_session();
        log::info!("API: {}", self.settings.api_url);
        log::info!("Web: {}", self.settings.web_url);
    }

    pub fn stop(&self) {
        self.link_flow.stop();
        self.flush_and_stop_tracker("quit");
        self.auth_server.stop();
    }

    /// Closes the open session server-side with the tracker's real accumulated
    /// active/idle seconds (not 0s) before tearing it down — shared by a clean
    /// quit, sign-out, and re-link, so none of them silently leave the session
    /// "active" forever or drop the time already worked.
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

    fn on_status_changed(self: &Arc<Self>, text: String) {
        *self.status.lock() = text.clone();
        for listener in self.status_listeners.lock().iter() {
            listener(text.clone());
        }
    }

    fn restore_session(self: &Arc<Self>) {
        let stored = self.store.load();
        if !stored.device_id.is_empty() && !stored.agent_secret.is_empty() {
            self.api
                .lock()
                .set_device_credential(&stored.device_id, &stored.agent_secret);
        }
        if stored.id_token.len() >= MIN_TOKEN_LENGTH {
            self.apply_tokens(stored.id_token, stored.refresh_token);
        }
    }

    fn apply_tokens(self: &Arc<Self>, id_token: String, refresh_token: String) {
        {
            let mut api = self.api.lock();
            api.set_tokens(&id_token, &refresh_token);
            // Claim a device credential if we don't already hold one. This is
            // what covers the browser's loopback handoff (which never hits
            // link/exchange) and agents linked before this existed - they
            // pick one up on their next launch instead of staying stranded.
            if !api.has_device_credential() {
                api.refresh_token_if_needed();
                api.ensure_device_registered();
            }
            // Captured during link exchange or the call above; read it back
            // off the client rather than threading it through every callback.
            let device_id = api.device_id.clone().unwrap_or_default();
            let agent_secret = api.agent_secret.clone().unwrap_or_default();
            self.store.save(&StoredCredentials {
                id_token: id_token.clone(),
                refresh_token: refresh_token.clone(),
                device_id: device_id.clone(),
                agent_secret: agent_secret.clone(),
            });
            let store_path = self.settings.store_path.clone();
            api.on_tokens_refreshed = Some(Box::new(move |id, refresh| {
                // Preserve the device credential across token rotations - a
                // plain overwrite here would silently drop it and take in-app
                // recovery with it.
                TokenStore::new(store_path.clone()).save(&StoredCredentials {
                    id_token: id,
                    refresh_token: refresh,
                    device_id: device_id.clone(),
                    agent_secret: agent_secret.clone(),
                });
            }));
            api.register_agent();
        }
        self.connection_failures.store(0, Ordering::SeqCst);
        self.on_status_changed("Signed in — waiting for timer".into());
        self.start_tracker();
        log::info!("Account linked");
    }

    fn start_tracker(self: &Arc<Self>) {
        if let Some(existing) = self.tracker.lock().as_ref() {
            existing.stop();
        }
        let controller = Arc::clone(self);
        let on_status: StatusCallback = Arc::new(move |text| {
            controller.on_status_changed(text);
        });
        let tracker = Arc::new(ActivityTracker::new(
            Arc::clone(&self.api),
            &self.settings,
            Arc::clone(&self.activity),
            Some(on_status),
        ));
        tracker.start();
        *self.tracker.lock() = Some(tracker);
    }

    pub fn open_sign_in(self: &Arc<Self>) -> SignInResult {
        if let Some(pending_token) = self.link_flow.pending_link_token() {
            self.resume_link_poll();
            let encoded = urlencoding::encode(&pending_token);
            let sign_in_url = format!("{}/?link={encoded}", self.settings.web_url);
            open_url_in_launcher_or_browser(&sign_in_url, Some(&pending_token));
            self.on_status_changed("Linking account...".into());
            return SignInResult {
                success: true,
                error: None,
            };
        }

        self.link_flow.stop();
        self.flush_and_stop_tracker("re-link");
        self.store.clear();
        {
            let mut api = self.api.lock();
            api.set_tokens("", "");
            // Drop the device credential too - after an explicit sign-out or
            // re-link, this machine must not be able to quietly mint itself a
            // new session.
            api.set_device_credential("", "");
        }
        self.connection_failures.store(0, Ordering::SeqCst);
        self.on_status_changed("Linking account...".into());

        let controller = Arc::clone(self);
        let on_tokens: OnTokens = Arc::new(move |id, refresh| {
            controller.apply_tokens(id, refresh);
        });
        let controller_err = Arc::clone(self);
        let on_error: OnError = Arc::new(move |msg| {
            controller_err.on_status_changed(msg);
        });

        let ok = self.link_flow.start(on_tokens, Some(on_error));
        if ok {
            SignInResult {
                success: true,
                error: None,
            }
        } else {
            SignInResult {
                success: false,
                error: Some(
                    "Could not reach the server. Check your internet connection and try again."
                        .into(),
                ),
            }
        }
    }

    /// Email + password sign-in, entirely in-app. Same three steps the browser
    /// takes, in the same order, so the two cannot disagree about who may use
    /// this account:
    ///   1. which providers this email actually has (Auth-Backend),
    ///   2. Identity Toolkit password sign-in,
    ///   3. `/api/auth/session-bootstrap`, which owns the member record and
    ///      every reason to refuse (disabled, banned, unverified, must change
    ///      password).
    ///
    /// The password is borrowed for the duration of step 2 and never stored.
    pub fn sign_in_with_password(self: &Arc<Self>, email: &str, password: &str) -> SignInResult {
        let email = email.trim();
        if email.is_empty() || password.is_empty() {
            return SignInResult::failed("Enter your email and password.");
        }

        // A Google/Apple-only account can never succeed here, and Firebase
        // would answer with a generic credential failure. Say the useful thing
        // instead. A lookup failure is not fatal - fall through and let the
        // sign-in itself decide.
        if let Some(methods) = self.api.lock().sign_in_methods(email) {
            if !methods.is_empty() && !methods.iter().any(|m| m == "password") {
                return SignInResult::failed(
                    "This account doesn't use a password. Use Link account to sign in with your provider.",
                );
            }
        }

        let tokens = self.api.lock().sign_in_with_password(email, password);
        let (id_token, refresh_token) = match tokens {
            Ok(pair) => pair,
            Err(err) => return SignInResult::failed(err.message()),
        };

        // Persist + claim the device credential before the gate below, so a
        // refusal has something concrete to clear and a success needs no
        // second write.
        self.apply_tokens(id_token, refresh_token);

        // Bound to a `let` on purpose: a temporary lock guard inside a `match`
        // scrutinee lives until the end of the match, and `sign_out()` below
        // takes the same (non-reentrant) lock.
        let bootstrap = self.api.lock().session_bootstrap();
        match bootstrap {
            Ok(()) => {}
            Err(Some(message)) => {
                // The server rejected this account outright; holding tokens for
                // it would leave the agent looking signed in and doing nothing.
                self.sign_out();
                return SignInResult::failed(&message);
            }
            Err(None) => {
                // Network problem, not a verdict. Keep the session - the normal
                // connection-recovery path handles this.
                log::warn!("Signed in, but could not confirm authorization yet");
            }
        }

        self.on_status_changed("Signed in — waiting for timer".into());
        SignInResult {
            success: true,
            error: None,
        }
    }

    /// Distinct from open_sign_in/"Re-link account": signs out cleanly (flush +
    /// stop the session, clear tokens) and stops there — no new browser link
    /// flow gets started, unlike re-link which immediately begins one.
    pub fn sign_out(self: &Arc<Self>) {
        self.link_flow.stop();
        self.flush_and_stop_tracker("sign-out");
        self.store.clear();
        {
            let mut api = self.api.lock();
            api.set_tokens("", "");
            // Drop the device credential too - after an explicit sign-out or
            // re-link, this machine must not be able to quietly mint itself a
            // new session.
            api.set_device_credential("", "");
        }
        self.connection_failures.store(0, Ordering::SeqCst);
        self.on_status_changed("Not signed in".into());
    }

    fn resume_link_poll(self: &Arc<Self>) -> bool {
        let controller = Arc::clone(self);
        let on_tokens: OnTokens = Arc::new(move |id, refresh| {
            controller.apply_tokens(id, refresh);
        });
        let controller_err = Arc::clone(self);
        let on_error: OnError = Arc::new(move |msg| {
            controller_err.on_status_changed(msg);
        });
        self.link_flow
            .ensure_polling(on_tokens, Some(on_error))
    }

    pub fn open_web_app(&self) {
        open_url_in_launcher_or_browser(&self.settings.web_url, None);
    }

    pub fn get_app_settings(&self) -> AppSettingsView {
        AppSettingsView {
            version: APP_VERSION.to_string(),
            preferences: self.settings.preferences_store().load(),
            log_path: self.settings.log_path.to_string_lossy().to_string(),
        }
    }

    /// Opens the diagnostic log file with the OS default handler (Notepad on
    /// Windows). Errors if nothing has been logged yet.
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

    /// Whether the agent can actually talk to the backend right now, as
    /// opposed to merely holding a token. Checked on the UI's existing poll.
    ///
    /// The debounce matters: a single failed check is a blip, not a broken
    /// session, and flipping the whole window on one bad request reads as the
    /// app being broken.
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
            // Still inside the grace window - report healthy so the UI does
            // not flicker on a single dropped request.
            return ConnectionState::Connected;
        }

        // Out of grace. With a device credential we can still recover in-app;
        // without one the only route left is a browser re-link.
        if has_device {
            ConnectionState::Disconnected
        } else {
            ConnectionState::SignedOut
        }
    }

    /// The "Welcome back" action: get this machine talking to the backend
    /// again without sending the user to a browser.
    pub fn reconnect(self: &Arc<Self>) -> ReconnectResult {
        // 1. Plain refresh first - covers expiry and transient outages.
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

        // 2. The refresh token is permanently dead - fall back to this
        //    machine's own credential rather than a browser round trip.
        match self.api.lock().reauth_with_device() {
            Ok(()) => {}
            Err(terminal) => {
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
        self.on_status_changed_local("Signed in — waiting for timer".into());
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

    pub fn list_projects(&self) -> Result<Vec<crate::types::ProjectInfo>, String> {
        self.api.lock().fetch_viewer_projects()
    }

    pub fn list_tasks(&self, project_id: Option<&str>) -> Result<Vec<AgentTask>, String> {
        self.api.lock().fetch_assigned_tasks(project_id)
    }

    pub fn get_session(&self) -> SessionInfo {
        let mut session = self.api.lock().current_session_info();
        // Idle state lives in the tracker, not the server - attach it to the
        // poll the UI already runs rather than adding a second one.
        session.idle_stage = self
            .tracker
            .lock()
            .as_ref()
            .map(|t| t.idle_stage())
            .unwrap_or(0);
        session
    }

    pub fn get_task_time_tracking(&self, task_id: &str) -> Option<crate::types::TaskTimeTracking> {
        if task_id.trim().is_empty() {
            return None;
        }
        self.api.lock().fetch_task_time_tracking(task_id.trim())
    }

    pub fn get_member_limits(&self) -> Option<crate::types::MemberLimits> {
        self.api.lock().fetch_member_limits()
    }

    pub fn get_member_profile(&self) -> Option<crate::types::MemberProfile> {
        self.api.lock().fetch_member_profile()
    }

    pub fn start_task_session(&self, task_id: &str) -> ActionResult {
        if task_id.trim().is_empty() {
            return ActionResult {
                success: false,
                error: Some("Select a task first".into()),
                session: None,
            };
        }
        // Seed with the task's known cumulative totals instead of 0s so a
        // stop/resume (or a session reused across tasks) doesn't reset the
        // clock the enforcement check on the other end evaluates against.
        let tracking = self.api.lock().fetch_task_time_tracking(task_id.trim());
        let active_baseline = tracking.as_ref().map(|t| t.active_seconds).unwrap_or(0);
        let idle_baseline = tracking.as_ref().map(|t| t.idle_seconds).unwrap_or(0);
        match self.api.lock().post_session_action(
            "start",
            Some(task_id.trim()),
            None,
            active_baseline,
            idle_baseline,
        ) {
            Ok(session) => {
                self.on_status_changed_local("Task session active".into());
                ActionResult {
                    success: true,
                    error: None,
                    session: Some(session),
                }
            }
            Err(error) => ActionResult {
                success: false,
                error: Some(error),
                session: None,
            },
        }
    }

    /// Timer for a "calling" project, which has no tasks at all. Kept separate
    /// from start_task_session rather than folded into it: there is no task
    /// estimate to seed a baseline from, and the backend gates the two on
    /// different things (task assignment vs. project membership).
    pub fn start_project_session(&self, project_id: &str) -> ActionResult {
        let project_id = project_id.trim();
        if project_id.is_empty() {
            return ActionResult {
                success: false,
                error: Some("Select a project first".into()),
                session: None,
            };
        }
        match self
            .api
            .lock()
            .post_session_action("start", None, Some(project_id), 0, 0)
        {
            Ok(session) => {
                self.on_status_changed_local("Task session active".into());
                ActionResult {
                    success: true,
                    error: None,
                    session: Some(session),
                }
            }
            Err(error) => ActionResult {
                success: false,
                error: Some(error),
                session: None,
            },
        }
    }

    pub fn stop_session(&self) -> ActionResult {
        let (task_id, active_seconds, idle_seconds) = self
            .tracker
            .lock()
            .as_ref()
            .map(|t| t.current_task_progress())
            .unwrap_or((None, 0, 0));
        match self
            .api
            .lock()
            .post_session_action("stop", task_id.as_deref(), None, active_seconds, idle_seconds)
        {
            Ok(session) => {
                self.on_status_changed_local("Signed in — waiting for timer".into());
                ActionResult {
                    success: true,
                    error: None,
                    session: Some(session),
                }
            }
            Err(error) => ActionResult {
                success: false,
                error: Some(error),
                session: None,
            },
        }
    }

    fn on_status_changed_local(&self, text: String) {
        *self.status.lock() = text.clone();
        for listener in self.status_listeners.lock().iter() {
            listener(text.clone());
        }
    }

    /// Whether closing the window should hide it instead of quitting.
    /// Read from disk each time - the preference can change while running and
    /// this is one small file read, not a hot path.
    pub fn close_to_tray(&self) -> bool {
        self.settings.preferences_store().load().close_to_tray
    }

    /// True when nothing at all is stored for this machine - no cached token,
    /// no device credential. Deliberately *not* "is currently authenticated":
    /// a stale or rejected token still identifies a user, and that user gets
    /// the Welcome Back / switch-account panel instead of a browser window
    /// thrown over the top of it.
    fn has_stored_identity(&self) -> bool {
        let stored = self.store.load();
        stored.id_token.len() >= MIN_TOKEN_LENGTH
            || (!stored.device_id.is_empty() && !stored.agent_secret.is_empty())
    }

    pub fn maybe_auto_sign_in(self: &Arc<Self>) {
        let prefs = self.settings.preferences_store().load();
        if !prefs.auto_sign_in || self.has_stored_identity() {
            return;
        }
        let controller = Arc::clone(self);
        thread::Builder::new()
            .name("vt-auto-signin".into())
            .spawn(move || {
                thread::sleep(Duration::from_secs(2));
                if !controller.has_stored_identity() && !controller.is_link_pending() {
                    let _ = controller.open_sign_in();
                }
            })
            .ok();
    }
}
