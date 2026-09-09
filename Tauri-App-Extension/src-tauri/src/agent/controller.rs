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
    /// Separate from `status_listeners` on purpose: status text is routine
    /// (shown in the UI's status line, refetched on every change) and would
    /// be noisy to toast on every update. A warning is the rarer case of
    /// something the user should actually notice, like a broken OS
    /// credential store - so it gets its own channel to a toast instead of
    /// being folded into the routine status stream.
    warning_listeners: Arc<Mutex<Vec<StatusCallback>>>,
    live_sync_listeners: Arc<Mutex<Vec<LiveSyncCallback>>>,
    activity: Arc<ActivityMeter>,
    /// Consecutive failed connection checks. One blip must not throw a
    /// full-screen recovery view at the user, so the UI only switches after
    /// this passes CONNECTION_FAILURE_GRACE.
    connection_failures: Arc<AtomicU32>,
}

impl AgentController {
    /// `Err` when the HTTP client itself couldn't be built (broken local
    /// TLS/cert store) - this runs before any window exists, so the caller is
    /// responsible for surfacing the failure instead of this panicking, which
    /// used to crash the app with nothing visible in a release build.
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

    /// PLAN-livesyncandagenttimer.md P10 - `listener` receives the raw JSON
    /// text of every "changed"/"scope-changed" frame the presence WebSocket
    /// delivers. Filtering by resource is the listener's job (see live_sync.rs
    /// module doc) - this stays a dumb passthrough, same as add_status_listener.
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
                    None,
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

    /// Plain `&self` (not `self: &Arc<Self>`) on purpose - it used to require
    /// an `Arc<Self>` for no reason the body actually needed, which is why a
    /// byte-for-byte duplicate (`on_status_changed_local`) existed just to be
    /// callable from methods that only had `&self`. Collapsed to one.
    fn on_status_changed(&self, text: String) {
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
        if stored.id_token.len() >= MIN_TOKEN_LENGTH && looks_like_jwt(&stored.id_token) {
            self.apply_tokens(stored.id_token, stored.refresh_token);
        }
    }

    /// Re-locks `self.api` per call rather than holding one lock scope across
    /// all of `refresh_token_if_needed`/`ensure_device_registered`/
    /// `register_agent` - each a blocking HTTP call. `ActivityTracker::tick()`
    /// needs this same lock every SESSION_POLL_SEC, so holding it across all
    /// three used to stall the tracker thread for their combined worst-case
    /// timeout on every sign-in/relink. Ordering and behavior are unchanged,
    /// only the lock scope is narrower.
    fn apply_tokens(self: &Arc<Self>, id_token: String, refresh_token: String) {
        self.api.lock().set_tokens(&id_token, &refresh_token);

        // Claim a device credential if we don't already hold one. This is
        // what covers the browser's loopback handoff (which never hits
        // link/exchange) and agents linked before this existed - they pick
        // one up on their next launch instead of staying stranded.
        if !self.api.lock().has_device_credential() {
            self.api.lock().refresh_token_if_needed();
            self.api.lock().ensure_device_registered();
        }

        // Captured during link exchange or the calls above; read it back off
        // the client rather than threading it through every callback.
        let (device_id, agent_secret) = {
            let api = self.api.lock();
            (
                api.device_id.clone().unwrap_or_default(),
                api.agent_secret.clone().unwrap_or_default(),
            )
        };
        let persisted = self.store.save(&StoredCredentials {
            id_token: id_token.clone(),
            refresh_token: refresh_token.clone(),
            device_id: device_id.clone(),
            agent_secret: agent_secret.clone(),
        });
        if !persisted {
            self.on_warning(
                "Could not save your sign-in securely on this device. \
                 You may need to sign in again after restarting."
                    .into(),
            );
        }
        let store_path = self.settings.store_path.clone();
        let warn_controller = Arc::clone(self);
        self.api.lock().on_tokens_refreshed = Some(Box::new(move |id, refresh| {
            // Preserve the device credential across token rotations - a
            // plain overwrite here would silently drop it and take in-app
            // recovery with it.
            let persisted = TokenStore::new(store_path.clone()).save(&StoredCredentials {
                id_token: id,
                refresh_token: refresh,
                device_id: device_id.clone(),
                agent_secret: agent_secret.clone(),
            });
            if !persisted {
                warn_controller.on_warning(
                    "Could not save your refreshed sign-in securely on this device. \
                     You may need to sign in again after restarting."
                        .into(),
                );
            }
        }));
        self.api.lock().register_agent();

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

    /// `hint` is an extra `key=value` query pair forwarded to the browser URL
    /// (see `AgentLinkFlow::start`) - e.g. `"provider=google"` for a social
    /// button, `"mode=signup"`/`"mode=forgot-password"` for account creation
    /// and password reset. `None` is today's plain "Link account" behavior.
    pub fn open_sign_in(self: &Arc<Self>, hint: Option<&str>) -> SignInResult {
        if let Some(pending_token) = self.link_flow.pending_link_token() {
            self.resume_link_poll();
            let encoded = urlencoding::encode(&pending_token);
            let valid_hint = hint.filter(|h| is_allowed_link_hint(h));
            if hint.is_some() && valid_hint.is_none() {
                log::warn!("Ignored unrecognized sign-in hint");
            }
            let sign_in_url = build_link_sign_in_url(
                &self.settings.web_url,
                &self.settings.auth_url,
                &encoded,
                valid_hint,
            );
            open_url_in_launcher_or_browser(&sign_in_url, Some(&pending_token), valid_hint);
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
        // on_warning, not on_status_changed: this fires from the poll thread
        // after open_sign_in has already returned success:true (a link
        // timeout, 15 minutes later), so a SignInResult return value can't
        // carry it - vt-warning/toast is the only channel left that a user
        // actually sees. vt-status exists and does carry event.detail, but
        // the frontend's own vt-status listener discards it and only uses
        // the event to trigger a refresh - status_changed here would be
        // exactly as silent as it was before this fix.
        let controller_err = Arc::clone(self);
        let on_error: OnError = Arc::new(move |msg| {
            controller_err.on_warning(msg);
        });

        let ok = self.link_flow.start(hint, on_tokens, Some(on_error));
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
            Err(crate::client::api::ApiError::Rejected(message)) => {
                // The server rejected this account outright; holding tokens for
                // it would leave the agent looking signed in and doing nothing.
                self.sign_out();
                return SignInResult::failed(&message);
            }
            Err(_) => {
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

    /// In-app account creation, no browser round-trip. Mirrors the web
    /// register form's flow: create the Firebase account, attach name/phone,
    /// send a verification email, then leave it signed out - the new account
    /// still has to verify its email and sign in normally, exactly like the
    /// web form's "Account created ... verify your email, then sign in."
    pub fn sign_up(
        self: &Arc<Self>,
        email: &str,
        password: &str,
        first_name: &str,
        last_name: &str,
        phone: &str,
    ) -> SignInResult {
        let email = email.trim();
        let first_name = first_name.trim();
        let last_name = last_name.trim();
        let phone = phone.trim();
        if email.is_empty() || password.is_empty() {
            return SignInResult::failed("Enter your email and password.");
        }
        if first_name.is_empty() || last_name.is_empty() {
            return SignInResult::failed("First and last name are required.");
        }
        if phone.is_empty() {
            return SignInResult::failed("Phone number is required.");
        }

        let created = self.api.lock().sign_up_with_password(email, password);
        let (id_token, _refresh) = match created {
            Ok(pair) => pair,
            Err(err) => return SignInResult::failed(&err.message()),
        };

        if let Err(msg) = self.api.lock().patch_profile(&id_token, first_name, last_name, phone) {
            // Not fatal - the account exists either way, and the profile page
            // can fill these in later. Only the sign-up itself must succeed.
            log::warn!("Could not save profile details after sign-up: {msg}");
        }
        self.api.lock().send_email_verification(&id_token);

        SignInResult {
            success: true,
            error: None,
        }
    }

    /// In-app password reset request - sends the email directly through
    /// Identity Toolkit, no browser link needed. Enumeration-safe: `success`
    /// here means the request was accepted, not that the email has an
    /// account (see `FirebaseTokenService::send_password_reset_email`).
    pub fn request_password_reset(self: &Arc<Self>, email: &str) -> SignInResult {
        let email = email.trim();
        if email.is_empty() {
            return SignInResult::failed("Enter your email address.");
        }
        match self.api.lock().send_password_reset(email) {
            Ok(()) => SignInResult {
                success: true,
                error: None,
            },
            Err(msg) => SignInResult::failed(&msg),
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
        // Same reasoning as open_sign_in's on_error: this only ever fires
        // async, after the caller has already gotten its return value back,
        // so on_warning/vt-warning is the one channel that actually reaches
        // the user - on_status_changed's vt-status event is real but its
        // frontend listener discards event.detail.
        let controller_err = Arc::clone(self);
        let on_error: OnError = Arc::new(move |msg| {
            controller_err.on_warning(msg);
        });
        self.link_flow
            .ensure_polling(on_tokens, Some(on_error))
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
            Err(err) => {
                // `is_rejected()` is the same terminal/retryable split the old
                // `Result<(), bool>` contract carried as `Err(true)`/`Err(false)`.
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

    pub fn list_projects(&self) -> Result<Vec<crate::types::ProjectInfo>, String> {
        self.api.lock().fetch_viewer_projects()
    }

    pub fn list_tasks(&self, project_id: Option<&str>) -> Result<Vec<AgentTask>, String> {
        self.api.lock().fetch_assigned_tasks(project_id)
    }

    /// project_id must be a task-based project the viewer can manage (see
    /// ProjectInfo.can_create_tasks) - the server re-checks this regardless
    /// of what the UI already gated on.
    pub fn create_task(
        &self,
        project_id: &str,
        title: &str,
        estimate_hours: Option<f64>,
        description: Option<&str>,
        priority: Option<&str>,
        due_date: Option<&str>,
    ) -> Result<crate::types::CreateTaskResult, String> {
        self.api
            .lock()
            .create_task(project_id, title, estimate_hours, description, priority, due_date)
            .map_err(|e| e.to_string())
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
        self.api.lock().fetch_task_time_tracking(task_id.trim()).ok()
    }

    pub fn get_member_limits(&self, project_id: Option<&str>) -> Option<crate::types::MemberLimits> {
        self.api.lock().fetch_member_limits(project_id).ok()
    }

    /// `None` covers a network/auth error the same as an older backend without
    /// this route - the panels it feeds simply don't render, same convention
    /// get_dashboard_summary already uses for its own optional payload.
    pub fn get_agent_workspace(&self) -> Option<crate::types::AgentWorkspace> {
        match self.api.lock().fetch_agent_workspace() {
            Ok(workspace) => workspace,
            Err(e) => {
                // This used to be silently swallowed (.ok().flatten()), which
                // made "every panel this feeds is just missing" indistinguishable
                // from "nothing is entitled to show" from the agent's own log -
                // there was no way to tell a 401/500 apart from an older
                // backend without the route (that case returns Ok(None), not
                // Err, and never reaches here).
                log::warn!("Could not load workspace: {e}");
                None
            }
        }
    }

    /// Errors surface as their server message (Err(String)) rather than a
    /// silent None - unlike the read-only panels above, these are writes the
    /// user explicitly asked for and has to know the outcome of.
    pub fn create_time_entry(
        &self,
        member_id: &str,
        project_id: &str,
        task_id: Option<&str>,
        date: &str,
        duration_seconds: i64,
        description: &str,
    ) -> Result<(), String> {
        self.api
            .lock()
            .create_time_entry(member_id, project_id, task_id, date, duration_seconds, description)
            .map_err(|e| e.to_string())
    }

    pub fn submit_timesheet(&self, period_start: &str, period_end: &str) -> Result<(), String> {
        self.api
            .lock()
            .submit_timesheet(period_start, period_end)
            .map_err(|e| e.to_string())
    }

    pub fn request_time_off(
        &self,
        policy_id: &str,
        start_date: &str,
        end_date: &str,
        note: &str,
    ) -> Result<(), String> {
        self.api
            .lock()
            .request_time_off(policy_id, start_date, end_date, note)
            .map_err(|e| e.to_string())
    }

    /// Empty on any failure - the screenshots panel is a transparency
    /// surface, not something worth surfacing an error banner for.
    pub fn get_my_screenshots(&self, limit: u32, project_id: Option<&str>) -> Vec<crate::types::ScreenshotRef> {
        match self.api.lock().fetch_my_screenshots(limit, project_id) {
            Ok(shots) => shots,
            Err(e) => {
                log::warn!("Could not load screenshots: {e}");
                Vec::new()
            }
        }
    }

    /// Empty on any failure or an older backend without the route - same
    /// "transparency surface, not an error banner" reasoning as
    /// get_my_screenshots above.
    pub fn get_project_app_breakdown(&self, project_id: &str) -> Vec<crate::types::ProjectAppTime> {
        match self.api.lock().fetch_project_app_breakdown(project_id) {
            Ok(rows) => rows,
            Err(e) => {
                log::warn!("Could not load this project's app breakdown: {e}");
                Vec::new()
            }
        }
    }

    /// Empty string when the image can't be loaded - the caller renders a
    /// placeholder rather than a broken <img>.
    pub fn get_screenshot_image(&self, screenshot_id: &str) -> String {
        self.api
            .lock()
            .fetch_screenshot_image(screenshot_id)
            .unwrap_or_default()
    }

    pub fn get_task_detail(&self, task_id: &str) -> Option<crate::types::TaskDetail> {
        if task_id.trim().is_empty() {
            return None;
        }
        self.api.lock().fetch_task_detail(task_id.trim()).ok()
    }

    /// `None` covers a network/auth error the same as an older backend
    /// without this route yet - the sidebar widgets it feeds simply don't
    /// render rather than showing an error over what's an optional extra.
    pub fn get_dashboard_summary(&self) -> Option<crate::types::DashboardSummary> {
        self.api.lock().fetch_dashboard_summary().ok().flatten()
    }

    /// `None` covers both "network/auth error" and "no Hours-based budget
    /// configured on this project" - the UI treats them identically (no card
    /// shown), so there's nothing useful to distinguish here.
    pub fn get_project_budget_status(&self, project_id: &str) -> Option<crate::types::ProjectBudgetStatus> {
        if project_id.trim().is_empty() {
            return None;
        }
        self.api.lock().fetch_project_budget_status(project_id.trim()).ok().flatten()
    }

    pub fn get_member_profile(&self) -> Option<crate::types::MemberProfile> {
        self.api.lock().fetch_member_profile().ok()
    }

    pub fn set_member_timezone(&self, timezone: &str) -> Result<(), String> {
        self.api.lock().update_member_timezone(timezone)?;
        // Cached locally too, same reason theme is: readable synchronously
        // at startup so the picker and header clock show what was chosen
        // last, instead of this machine's own zone, before the profile
        // fetch resolves (or if it fails). Best-effort - a write failure
        // here must not undo a save the server already accepted.
        let mut prefs = self.get_app_settings().preferences;
        prefs.member_timezone = timezone.to_string();
        let _ = self.save_preferences(prefs);
        Ok(())
    }

    /// CF-2: tracking cannot start before the current disclosure notice has
    /// been acknowledged. Fails CLOSED on a network problem or a malformed
    /// response - the entire point of a consent gate is that "couldn't
    /// check" must never be silently read as "consented". `Ok(None)` from
    /// the fetch (nothing to disclose - e.g. no capability is enabled at
    /// all) is not blocked here; CF-1's default-deny already means nothing
    /// gets captured in that case.
    fn blocked_by_monitoring_notice(&self) -> Option<String> {
        match self.api.lock().fetch_monitoring_notice() {
            Ok(Some(notice)) if notice.requires_acknowledgement => {
                Some("Review the monitoring notice before starting the timer.".into())
            }
            Ok(_) => None,
            Err(_) => {
                Some("Could not verify the monitoring notice — check your connection and try again.".into())
            }
        }
    }

    /// An idle-triggered stop from the *previous* session can still be queued
    /// for delivery (`ActivityTracker::flush_pending_stop`) at the moment the
    /// user clicks Start again. The server keys the open session by member,
    /// not by session id, so letting "start" through first would let the
    /// pending stop land on the just-started session instead and kill it with
    /// stale, idle-rewound totals. Flush it first; refuse to start only if it
    /// genuinely can't be delivered right now (still offline).
    fn blocked_by_pending_idle_stop(&self) -> Option<String> {
        let tracker = self.tracker.lock();
        match tracker.as_ref() {
            Some(tracker) if !tracker.flush_pending_stop() => {
                Some("Still finishing the previous idle stop — try starting again in a moment.".into())
            }
            _ => None,
        }
    }

    /// CF-2: the current disclosure notice for the UI to show. `None` on any
    /// failure (network, not signed in) - the UI treats that the same as
    /// "nothing to show yet", not as "already acknowledged".
    pub fn get_monitoring_notice(&self) -> Option<crate::types::MonitoringNoticeView> {
        self.api.lock().fetch_monitoring_notice().ok().flatten()
    }

    /// CF-2: records that the notice was shown AND accepted - the two-step
    /// disclosure-then-consent model from CF-0.2, collapsed into one command
    /// because the UI only calls this once the user has actually clicked
    /// through the notice (there's no "shown but not yet acted on" state in
    /// this UI to represent separately). Returns false if either write
    /// failed, so the caller knows not to let the notice dismiss.
    pub fn acknowledge_monitoring_notice(&self, notice_version: &str) -> bool {
        let disclosed = self.api.lock().post_monitoring_disclosure(notice_version).is_ok();
        let consented = self.api.lock().post_monitoring_consent(notice_version).is_ok();
        disclosed && consented
    }

    pub fn start_task_session(&self, task_id: &str) -> ActionResult {
        if task_id.trim().is_empty() {
            return ActionResult {
                success: false,
                error: Some("Select a task first".into()),
                session: None,
            };
        }
        if let Some(error) = self.blocked_by_monitoring_notice() {
            return ActionResult { success: false, error: Some(error), session: None };
        }
        if let Some(error) = self.blocked_by_pending_idle_stop() {
            return ActionResult { success: false, error: Some(error), session: None };
        }
        // Seed with the task's known cumulative totals instead of 0s so a
        // stop/resume (or a session reused across tasks) doesn't reset the
        // clock the enforcement check on the other end evaluates against.
        let tracking = self.api.lock().fetch_task_time_tracking(task_id.trim()).ok();
        let active_baseline = tracking.as_ref().map(|t| t.active_seconds).unwrap_or(0);
        let idle_baseline = tracking.as_ref().map(|t| t.idle_seconds).unwrap_or(0);
        match self.api.lock().post_session_action(
            "start",
            Some(task_id.trim()),
            None,
            active_baseline,
            idle_baseline,
            None,
        ) {
            Ok(session) => {
                self.on_status_changed("Task session active".into());
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
        if let Some(error) = self.blocked_by_monitoring_notice() {
            return ActionResult { success: false, error: Some(error), session: None };
        }
        if let Some(error) = self.blocked_by_pending_idle_stop() {
            return ActionResult { success: false, error: Some(error), session: None };
        }
        match self
            .api
            .lock()
            .post_session_action("start", None, Some(project_id), 0, 0, None)
        {
            Ok(session) => {
                self.on_status_changed("Task session active".into());
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

    /// `stop_note` carries what the member said they worked on, when the
    /// project has require_stop_note on. Every other stop in this codebase is
    /// automatic (idle rewind, cap reached, shutdown) and passes None - there
    /// is no user present to ask.
    pub fn stop_session(&self, stop_note: Option<&str>) -> ActionResult {
        let tracker = self.tracker.lock();
        let (task_id, active_seconds, idle_seconds) = tracker
            .as_ref()
            .map(|t| t.current_task_progress())
            .unwrap_or((None, 0, 0));
        // TC-Y: this posts "stop" straight to the API, bypassing the tick
        // loop entirely - without this flag the next tick finds the session
        // gone and try_recover_lost_session (agent/tracker.rs) mistakes the
        // user's own Stop for a server-side abandonment and resumes it.
        if let Some(tracker) = tracker.as_ref() {
            tracker.note_stop_requested();
        }
        drop(tracker);
        match self
            .api
            .lock()
            .post_session_action("stop", task_id.as_deref(), None, active_seconds, idle_seconds, stop_note)
        {
            Ok(session) => {
                self.on_status_changed("Signed in — waiting for timer".into());
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

    /// The break button: marks the session idle (preserving its accumulated
    /// totals, unlike `stop_session`) and tells the tick loop to stop
    /// counting active time until `resume_session`.
    pub fn pause_session(&self) -> ActionResult {
        let tracker = self.tracker.lock();
        let Some(tracker) = tracker.as_ref() else {
            return ActionResult { success: false, error: Some("No active session".into()), session: None };
        };
        match tracker.pause() {
            Ok(()) => ActionResult { success: true, error: None, session: None },
            Err(error) => ActionResult { success: false, error: Some(error), session: None },
        }
    }

    pub fn resume_session(&self) -> ActionResult {
        let tracker = self.tracker.lock();
        let Some(tracker) = tracker.as_ref() else {
            return ActionResult { success: false, error: Some("No active session".into()), session: None };
        };
        match tracker.resume() {
            Ok(()) => ActionResult { success: true, error: None, session: None },
            Err(error) => ActionResult { success: false, error: Some(error), session: None },
        }
    }

    pub fn is_session_paused(&self) -> bool {
        self.tracker.lock().as_ref().is_some_and(|t| t.is_paused())
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
        (stored.id_token.len() >= MIN_TOKEN_LENGTH && looks_like_jwt(&stored.id_token))
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
                    let _ = controller.open_sign_in(None);
                }
            })
            .ok();
    }
}

/// Cheap shape check alongside MIN_TOKEN_LENGTH before treating a stored
/// value as a plausible id token - three non-empty dot-separated segments,
/// the same structural shape every JWT has. Not a signature check (the
/// server already verifies that on every request); this only screens out
/// obviously-wrong stored values (garbage, a truncated write, a non-token
/// string that happened to clear the length bar) before bothering to use
/// them.
fn looks_like_jwt(token: &str) -> bool {
    let parts: Vec<&str> = token.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty())
}
