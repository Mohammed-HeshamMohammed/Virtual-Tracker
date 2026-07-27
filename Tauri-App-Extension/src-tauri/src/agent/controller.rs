use std::sync::Arc;
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;

use crate::agent::tracker::{ActivityTracker, StatusCallback};
use crate::auth::link_flow::{AgentLinkFlow, OnError, OnTokens};
use crate::auth::server::AuthServer;
use crate::auth::tokens::TokenStore;
use crate::capture::activity::ActivityMeter;
use crate::client::api::ApiClient;
use crate::client::firebase::jwt_payload;
use crate::config::Settings;
use crate::constants::{APP_VERSION, MIN_TOKEN_LENGTH};
use crate::prefs::{AppSettingsView, UserPreferences};
use crate::types::{
    ActionResult, AgentTask, LinkStatus, ProfileInfo, SessionInfo, SignInResult,
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
}

impl AgentController {
    pub fn new(settings: Settings) -> Arc<Self> {
        let store = TokenStore::new(settings.store_path.clone());
        let api = Arc::new(Mutex::new(ApiClient::new(settings.api_url.clone())));
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

    pub fn is_authenticated(&self) -> bool {
        self.api.lock().is_authenticated()
    }

    fn on_status_changed(self: &Arc<Self>, text: String) {
        *self.status.lock() = text.clone();
        for listener in self.status_listeners.lock().iter() {
            listener(text.clone());
        }
    }

    fn restore_session(self: &Arc<Self>) {
        let (id_token, refresh) = self.store.load();
        if id_token.len() >= MIN_TOKEN_LENGTH {
            self.apply_tokens(id_token, refresh);
        }
    }

    fn apply_tokens(self: &Arc<Self>, id_token: String, refresh_token: String) {
        self.store.save(&id_token, &refresh_token);
        {
            let mut api = self.api.lock();
            api.set_tokens(&id_token, &refresh_token);
            let store_path = self.settings.store_path.clone();
            api.on_tokens_refreshed = Some(Box::new(move |id, refresh| {
                TokenStore::new(store_path.clone()).save(&id, &refresh);
            }));
            api.register_agent();
        }
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
        self.api.lock().set_tokens("", "");
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

    /// Distinct from open_sign_in/"Re-link account": signs out cleanly (flush +
    /// stop the session, clear tokens) and stops there — no new browser link
    /// flow gets started, unlike re-link which immediately begins one.
    pub fn sign_out(self: &Arc<Self>) {
        self.link_flow.stop();
        self.flush_and_stop_tracker("sign-out");
        self.store.clear();
        self.api.lock().set_tokens("", "");
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
        self.api.lock().current_session_info()
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
            .post_session_action("stop", task_id.as_deref(), active_seconds, idle_seconds)
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

    pub fn maybe_auto_sign_in(self: &Arc<Self>) {
        let prefs = self.settings.preferences_store().load();
        if !prefs.auto_sign_in || self.is_authenticated() {
            return;
        }
        let controller = Arc::clone(self);
        thread::Builder::new()
            .name("vt-auto-signin".into())
            .spawn(move || {
                thread::sleep(Duration::from_secs(2));
                if !controller.is_authenticated() && !controller.is_link_pending() {
                    let _ = controller.open_sign_in();
                }
            })
            .ok();
    }
}
