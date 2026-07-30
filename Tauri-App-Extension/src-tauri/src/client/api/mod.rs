//! Backend HTTP client, split by domain: this file owns the struct plus auth/token
//! plumbing shared by every call; each submodule owns one group of endpoints.
mod events;
mod link;
mod session;
mod work;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::blocking::Client;

use crate::client::firebase::{FirebaseTokenService, RefreshOutcome};
use crate::constants::{HTTP_TIMEOUT_SEC, TOKEN_REFRESH_BUFFER_MS};

pub struct ApiClient {
    api_url: String,
    client: Client,
    firebase: FirebaseTokenService,
    pub id_token: Option<String>,
    pub refresh_token: Option<String>,
    /// Long-lived per-machine credential, issued at link time. Survives the
    /// death of the (borrowed) Firebase refresh token and is what makes
    /// in-app recovery possible.
    pub device_id: Option<String>,
    pub agent_secret: Option<String>,
    /// Result of the most recent refresh attempt, so callers can tell a flaky
    /// network apart from a credential that will never work again.
    pub last_refresh: RefreshOutcome,
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
            device_id: None,
            agent_secret: None,
            last_refresh: RefreshOutcome::Ok,
            on_tokens_refreshed: None,
        }
    }

    pub fn set_device_credential(&mut self, device_id: &str, agent_secret: &str) {
        self.device_id = (!device_id.is_empty()).then(|| device_id.to_string());
        self.agent_secret = (!agent_secret.is_empty()).then(|| agent_secret.to_string());
    }

    pub fn has_device_credential(&self) -> bool {
        self.device_id.is_some() && self.agent_secret.is_some()
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
            self.last_refresh = RefreshOutcome::Rejected;
            return false;
        };
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let still_valid = FirebaseTokenService::id_token_expiry_ms(&id_token)
            .is_some_and(|exp| exp > now_ms + TOKEN_REFRESH_BUFFER_MS);
        if still_valid {
            self.last_refresh = RefreshOutcome::Ok;
            return true;
        }

        // No refresh token means we cannot mint a new id token at all. This
        // used to return `true` regardless, which is why an agent whose link
        // handoff carried no refresh token looked signed in but had every
        // request rejected the moment its id token aged out (typically after
        // a restart, or an hour in). Report it honestly so recovery can run.
        let Some(refresh) = self.refresh_token.clone() else {
            log::warn!("ID token expired and no refresh token is stored");
            self.last_refresh = RefreshOutcome::Rejected;
            return false;
        };
        let (outcome, tokens) = self.firebase.refresh(&refresh);
        self.last_refresh = outcome;
        match tokens {
            Some((id, next_refresh)) => {
                self.apply_fresh_tokens(id, next_refresh);
                true
            }
            None => false,
        }
    }

    fn apply_fresh_tokens(&mut self, id_token: String, refresh_token: String) {
        self.id_token = Some(id_token.clone());
        self.refresh_token = Some(refresh_token.clone());
        self.last_refresh = RefreshOutcome::Ok;
        if let Some(cb) = &self.on_tokens_refreshed {
            cb(id_token, refresh_token);
        }
    }

    /// Mints a brand-new session from this machine's own device credential.
    /// The path that keeps recovery inside the app when the borrowed Firebase
    /// refresh token is permanently dead.
    ///
    /// `Err(true)` means the device itself is no longer linked (the backend
    /// revoked it, or the account lost access) - only then must the user go
    /// through a browser link again.
    pub fn reauth_with_device(&mut self) -> Result<(), bool> {
        let (Some(device_id), Some(secret)) = (self.device_id.clone(), self.agent_secret.clone())
        else {
            return Err(true);
        };
        let url = format!("{}/api/activity/agent/reauth", self.api_url);
        let res = self
            .client
            .post(url)
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({ "deviceId": device_id, "agentSecret": secret }))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send();

        let res = match res {
            Ok(r) => r,
            // Network problem - the device is probably still fine, so don't
            // push the user toward a re-link over a dropped connection.
            Err(err) => {
                log::warn!("Device reauth network error: {err}");
                return Err(false);
            }
        };

        let status = res.status();
        if !status.is_success() {
            // 401/403 = this device or account is finished. 5xx = try later.
            let terminal = status.as_u16() == 401 || status.as_u16() == 403;
            log::warn!("Device reauth failed ({})", status.as_u16());
            return Err(terminal);
        }

        let body: serde_json::Value = res.json().map_err(|_| false)?;
        let custom_token = body
            .pointer("/data/customToken")
            .and_then(|v| v.as_str())
            .ok_or(false)?
            .to_string();

        match self.firebase.sign_in_with_custom_token(&custom_token) {
            Some((id, refresh)) => {
                self.apply_fresh_tokens(id, refresh);
                Ok(())
            }
            None => Err(false),
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
