//! Backend HTTP client, split by domain: this file owns the struct plus auth/token
//! plumbing shared by every call; each submodule owns one group of endpoints.
mod events;
mod link;
mod session;
mod work;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::blocking::Client;

use crate::client::firebase::FirebaseTokenService;
use crate::constants::{HTTP_TIMEOUT_SEC, TOKEN_REFRESH_BUFFER_MS};

pub struct ApiClient {
    api_url: String,
    client: Client,
    firebase: FirebaseTokenService,
    pub id_token: Option<String>,
    pub refresh_token: Option<String>,
    pub on_tokens_refreshed: Option<Box<dyn Fn(String, String) + Send>>,
}

impl ApiClient {
    pub fn new(api_url: String) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .build()
            .unwrap_or_else(|err| {
                // Unrecoverable - the app can't function without an HTTP client anyway.
                // Log the real reqwest error first so it lands in the log file the user
                // can already reach from Settings, instead of a bare panic message.
                log::error!("Failed to build HTTP client: {err}");
                panic!("Failed to build HTTP client: {err}");
            });
        let firebase = FirebaseTokenService::new(api_url.clone(), client.clone());
        Self {
            api_url,
            client,
            firebase,
            id_token: None,
            refresh_token: None,
            on_tokens_refreshed: None,
        }
    }

    pub fn set_tokens(&mut self, id_token: &str, refresh_token: &str) {
        self.id_token = if id_token.is_empty() {
            None
        } else {
            Some(id_token.to_string())
        };
        self.refresh_token = if refresh_token.is_empty() {
            None
        } else {
            Some(refresh_token.to_string())
        };
    }

    pub fn is_authenticated(&self) -> bool {
        self.id_token.is_some()
    }

    fn auth_headers(&self) -> Option<String> {
        self.id_token.as_ref().map(|t| format!("Bearer {t}"))
    }

    pub fn refresh_token_if_needed(&mut self) -> bool {
        let Some(id_token) = self.id_token.clone() else {
            return false;
        };
        let Some(refresh) = self.refresh_token.clone() else {
            return true;
        };
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        if let Some(exp) = FirebaseTokenService::id_token_expiry_ms(&id_token) {
            if exp > now_ms + TOKEN_REFRESH_BUFFER_MS {
                return true;
            }
        }
        match self.firebase.refresh(&refresh) {
            Some((id, next_refresh)) => {
                self.id_token = Some(id.clone());
                self.refresh_token = Some(next_refresh.clone());
                if let Some(cb) = &self.on_tokens_refreshed {
                    cb(id, next_refresh);
                }
                true
            }
            None => false,
        }
    }

    pub fn health_ok(&self) -> bool {
        let url = format!("{}/health", self.api_url);
        self.client
            .get(url)
            .timeout(Duration::from_secs(2))
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}
