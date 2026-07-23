use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::client::api::ApiClient;
use crate::util::open_url_in_launcher_or_browser;

pub type OnTokens = Arc<dyn Fn(String, String) + Send + Sync>;
pub type OnError = Arc<dyn Fn(String) + Send + Sync>;

#[derive(Clone)]
struct PendingSession {
    link_token: String,
    agent_secret: String,
}

pub struct AgentLinkFlow {
    api: Arc<Mutex<ApiClient>>,
    web_url: String,
    pending: Arc<Mutex<Option<PendingSession>>>,
    poll_generation: Arc<AtomicU64>,
    on_tokens: Arc<Mutex<Option<OnTokens>>>,
    on_error: Arc<Mutex<Option<OnError>>>,
}

impl AgentLinkFlow {
    pub fn new(api: Arc<Mutex<ApiClient>>, web_url: String) -> Self {
        Self {
            api,
            web_url,
            pending: Arc::new(Mutex::new(None)),
            poll_generation: Arc::new(AtomicU64::new(0)),
            on_tokens: Arc::new(Mutex::new(None)),
            on_error: Arc::new(Mutex::new(None)),
        }
    }

    pub fn pending_link_token(&self) -> Option<String> {
        self.pending.lock().as_ref().map(|p| p.link_token.clone())
    }

    pub fn ensure_polling(&self, on_tokens: OnTokens, on_error: Option<OnError>) -> bool {
        let Some(session) = self.pending.lock().clone() else {
            return false;
        };
        *self.on_tokens.lock() = Some(on_tokens);
        *self.on_error.lock() = on_error;
        let generation = self.poll_generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.spawn_poll(session, generation);
        log::info!("Resumed agent link credential exchange");
        true
    }

    pub fn start(&self, on_tokens: OnTokens, on_error: Option<OnError>) -> bool {
        let generation = self.poll_generation.fetch_add(1, Ordering::SeqCst) + 1;
        *self.on_tokens.lock() = Some(on_tokens);
        *self.on_error.lock() = on_error;

        let session = self.api.lock().create_link_session();
        let Some((link_token, agent_secret)) = session else {
            log::warn!("Could not start agent link session");
            if let Some(cb) = self.on_error.lock().as_ref() {
                cb(
                    "Could not reach the server. Check your internet connection and try again."
                        .into(),
                );
            }
            return false;
        };

        let pending = PendingSession {
            link_token: link_token.clone(),
            agent_secret,
        };
        *self.pending.lock() = Some(pending.clone());
        let encoded = urlencoding::encode(&link_token);
        let sign_in_url = format!("{}/?link={encoded}", self.web_url);
        open_url_in_launcher_or_browser(&sign_in_url, Some(&link_token));
        log::info!("Opened sign-in page: {sign_in_url}");
        self.spawn_poll(pending, generation);
        true
    }

    pub fn apply_web_credentials(
        &self,
        link_token: &str,
        id_token: &str,
        refresh_token: &str,
    ) -> bool {
        if id_token.is_empty() {
            return false;
        }
        {
            let pending = self.pending.lock();
            match pending.as_ref() {
                Some(session) if session.link_token == link_token => {}
                _ => {
                    log::warn!("Rejected browser credentials: no matching pending link session");
                    return false;
                }
            }
        }
        self.poll_generation.fetch_add(1, Ordering::SeqCst);
        let on_tokens = self.on_tokens.lock().clone();
        if let Some(cb) = on_tokens {
            cb(id_token.to_string(), refresh_token.to_string());
            *self.pending.lock() = None;
            log::info!("Applied credentials from browser link handoff");
            return true;
        }
        false
    }

    pub fn stop(&self) {
        self.poll_generation.fetch_add(1, Ordering::SeqCst);
        *self.pending.lock() = None;
    }

    /// Resume exchange polling using the callbacks from the last `start` / `ensure_polling`.
    pub fn resume_existing(&self) -> bool {
        let on_tokens = self.on_tokens.lock().clone();
        let on_error = self.on_error.lock().clone();
        let Some(on_tokens) = on_tokens else {
            return self.pending_link_token().is_some();
        };
        self.ensure_polling(on_tokens, on_error)
    }

    fn spawn_poll(&self, session: PendingSession, generation: u64) {
        let api = Arc::clone(&self.api);
        let poll_generation = Arc::clone(&self.poll_generation);
        let pending = Arc::clone(&self.pending);
        let on_tokens = Arc::clone(&self.on_tokens);
        let on_error = Arc::clone(&self.on_error);
        let cancelled = Arc::new(AtomicBool::new(false));
        let _ = cancelled;

        thread::Builder::new()
            .name("vt-link-poll".into())
            .spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(900);
                let mut attempt = 0u64;
                let preview = session.link_token.chars().take(8).collect::<String>();
                log::info!("Link exchange polling started for session {preview}…");

                while Instant::now() < deadline {
                    if poll_generation.load(Ordering::SeqCst) != generation {
                        return;
                    }
                    attempt += 1;
                    let (status, result) = api
                        .lock()
                        .poll_link_exchange(&session.link_token, &session.agent_secret);

                    if let Some((id_token, refresh_token)) = result {
                        log::info!("Link exchange succeeded (200) after {attempt} poll(s)");
                        if poll_generation.load(Ordering::SeqCst) == generation {
                            if let Some(cb) = on_tokens.lock().as_ref() {
                                cb(id_token, refresh_token);
                            }
                            *pending.lock() = None;
                        }
                        return;
                    }

                    if status == 409 && (attempt == 1 || attempt % 15 == 0) {
                        log::info!(
                            "Link exchange not ready yet (409) — waiting for browser link/complete (poll #{attempt})"
                        );
                    } else if status != 0 && status != 409 && (attempt == 1 || attempt % 15 == 0) {
                        log::warn!("Link exchange failed ({status}) on poll #{attempt}");
                    } else if status == 0 && (attempt == 1 || attempt % 15 == 0) {
                        log::warn!("Link exchange unreachable on poll #{attempt}");
                    }
                    thread::sleep(Duration::from_secs(1));
                }

                if poll_generation.load(Ordering::SeqCst) != generation {
                    return;
                }
                *pending.lock() = None;
                log::warn!("Agent link session timed out before credentials were exchanged");
                if let Some(cb) = on_error.lock().as_ref() {
                    cb(
                        "Link timed out. Keep the agent open, click Sign In, then Link this account again."
                            .into(),
                    );
                }
            })
            .ok();
    }
}
