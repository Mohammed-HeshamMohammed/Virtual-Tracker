//! Backend HTTP client, split by domain: this file owns the struct plus auth/token plumbing
//! shared by every call; each submodule owns one group of endpoints.
mod classification;
mod agent_notifications;
mod compliance;
mod events;
mod link;
mod scoring;
mod session;
mod work;

use std::fmt;
use serde_json::Value;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::blocking::Client;

use crate::client::firebase::{FirebaseTokenService, PasswordSignInError, RefreshOutcome, SignUpError};
use crate::constants::{HTTP_TIMEOUT_SEC, TOKEN_REFRESH_BUFFER_MS};

/// Suggestion #13: one shared error shape for `ApiClient` methods, replacing the different
/// one-off shapes (`Result<_, ()>`, `Result<_, bool>`, `Result<(), Option<String>>`, bare
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiError {
    Network,
    Unauthorized,
    Rejected(String),
}

impl ApiError {
    /// True only for a real server-side refusal - mirrors the old `Result<(), bool>`
    /// contract on `reauth_with_device`, where `Err(true)` meant "this device/account is
    pub fn is_rejected(&self) -> bool {
        matches!(self, ApiError::Rejected(_))
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApiError::Network => {
                write!(f, "Could not reach the server. Check your connection and try again.")
            }
            ApiError::Unauthorized => write!(f, "Not signed in"),
            ApiError::Rejected(message) => write!(f, "{message}"),
        }
    }
}

pub struct ApiClient {
    api_url: String,
    client: Client,
    firebase: FirebaseTokenService,
    pub id_token: Option<String>,
    pub refresh_token: Option<String>,
    /// Long-lived per-machine credential, issued at link time.
    pub device_id: Option<String>,
    pub agent_secret: Option<String>,
    /// Result of the most recent refresh attempt, so callers can tell a flaky network apart
    /// from a credential that will never work again.
    pub last_refresh: RefreshOutcome,
    /// The refresh token Firebase has already refused. A 4xx from
    /// securetoken means the credential is expired, revoked or belongs to a
    /// disabled user - none of which a retry can change - so presenting the
    /// same token again is a guaranteed round trip to a guaranteed failure.
    /// Remembering it is what stops the storm described on
    /// refresh_token_if_needed.
    rejected_refresh_token: Option<String>,
    pub on_tokens_refreshed: Option<Box<dyn Fn(String, String) + Send>>,
}

impl ApiClient {
    /// `auth_url` is Auth-Backend and is deliberately *not* `api_url`: the dashboard
    /// API answers every `/api/auth/*` authn route with 404 "handled by Auth-Backend",
    /// so pointing token refresh at it left the agent with no Firebase API key and
    /// therefore no way to renew a session.
    ///
    /// `Err` (instead of panicking) on a broken local HTTP/TLS environment - this runs
    /// in `AgentController::new`, before any window exists, and release builds hide the
    /// console, so a panic here used to crash the app with no visible error at all. The
    /// caller is responsible for surfacing this to the user.
    pub fn new(api_url: String, auth_url: String) -> Result<Self, String> {
        let client = Client::builder()
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .build()
            .map_err(|err| {
                log::error!("Failed to build HTTP client: {err}");
                format!("Failed to build HTTP client: {err}")
            })?;
        let firebase = FirebaseTokenService::new(auth_url, client.clone());
        Ok(Self {
            api_url,
            client,
            firebase,
            id_token: None,
            refresh_token: None,
            device_id: None,
            agent_secret: None,
            last_refresh: RefreshOutcome::Ok,
            rejected_refresh_token: None,
            on_tokens_refreshed: None,
        })
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

    /// Shared prologue nearly every authenticated endpoint needs: refresh the id token if
    /// it's close to expiry, then hand back the `Authorization` header value to send with
    fn authorized(&mut self) -> Option<String> {
        if !self.refresh_token_if_needed() {
            return None;
        }
        self.auth_headers()
    }

    /// Every authenticated request calls this first, so anything it does on a
    /// failure it does once per request. When a refresh token is rejected
    /// there is nothing to back off from and nothing to fix, and without the
    /// memory below each of the tracker's several pollers re-attempted the
    /// same dead token: a real agent log shows 3,475 rejected refreshes,
    /// fifteen of them inside four seconds, each a network round trip to
    /// Google that could only ever fail.
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

        // No refresh token means we cannot mint a new id token at all.
        let Some(refresh) = self.refresh_token.clone() else {
            log::warn!("ID token expired and no refresh token is stored");
            self.last_refresh = RefreshOutcome::Rejected;
            return self.fall_back_to_device_reauth();
        };
        // Already refused once: skip the request and go straight to the
        // device credential, which is the only thing that can still recover.
        if self.rejected_refresh_token.as_deref() == Some(refresh.as_str()) {
            self.last_refresh = RefreshOutcome::Rejected;
            return self.fall_back_to_device_reauth();
        }

        let (outcome, tokens) = self.firebase.refresh(&refresh);
        self.last_refresh = outcome;
        if outcome == RefreshOutcome::Rejected {
            self.rejected_refresh_token = Some(refresh.clone());
        }
        match tokens {
            Some((id, next_refresh)) => {
                self.apply_fresh_tokens(id, next_refresh);
                true
            }
            None if outcome == RefreshOutcome::Rejected => self.fall_back_to_device_reauth(),
            None => false,
        }
    }

    fn fall_back_to_device_reauth(&mut self) -> bool {
        if !self.has_device_credential() {
            return false;
        }
        self.reauth_with_device().is_ok()
    }

    fn apply_fresh_tokens(&mut self, id_token: String, refresh_token: String) {
        self.id_token = Some(id_token.clone());
        self.refresh_token = Some(refresh_token.clone());
        self.last_refresh = RefreshOutcome::Ok;
        // A new sign-in or a device reauth issues a different token, so the
        // refusal recorded against the old one no longer applies to anything.
        self.rejected_refresh_token = None;
        if let Some(cb) = &self.on_tokens_refreshed {
            cb(id_token, refresh_token);
        }
    }

    /// Mints a brand-new session from this machine's own device credential.
    pub fn reauth_with_device(&mut self) -> Result<(), ApiError> {
        let (Some(device_id), Some(secret)) = (self.device_id.clone(), self.agent_secret.clone())
        else {
            return Err(ApiError::Rejected("No device credential stored".into()));
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
            // Network problem - the device is probably still fine, so don't push the user
            // toward a re-link over a dropped connection.
            Err(err) => {
                log::warn!("Device reauth network error: {err}");
                return Err(ApiError::Network);
            }
        };

        let status = res.status();
        if !status.is_success() {
            // 401/403 = this device or account is finished.
            let terminal = status.as_u16() == 401 || status.as_u16() == 403;
            log::warn!("Device reauth failed ({})", status.as_u16());
            return Err(if terminal {
                ApiError::Rejected(format!("Device reauth failed ({})", status.as_u16()))
            } else {
                ApiError::Network
            });
        }

        let body: serde_json::Value = res.json().map_err(|_| ApiError::Network)?;
        let custom_token = body
            .pointer("/data/customToken")
            .and_then(|v| v.as_str())
            .ok_or(ApiError::Network)?
            .to_string();

        match self.firebase.sign_in_with_custom_token(&custom_token) {
            Some((id, refresh)) => {
                self.apply_fresh_tokens(id, refresh);
                Ok(())
            }
            None => Err(ApiError::Network),
        }
    }

    /// Signs in with email + password, then leaves the tokens on this client.
    pub fn sign_in_with_password(
        &mut self,
        email: &str,
        password: &str,
    ) -> Result<(String, String), PasswordSignInError> {
        self.firebase.sign_in_with_password(email, password)
    }

    pub fn sign_in_methods(&self, email: &str) -> Option<Vec<String>> {
        self.firebase.sign_in_methods(email)
    }

    /// In-app account creation.
    pub fn sign_up_with_password(
        &mut self,
        email: &str,
        password: &str,
    ) -> Result<(String, String), SignUpError> {
        self.firebase.sign_up_with_password(email, password)
    }

    pub fn send_email_verification(&mut self, id_token: &str) {
        self.firebase.send_email_verification(id_token)
    }

    /// In-app password reset request - enumeration-safe, see
    /// `FirebaseTokenService::send_password_reset_email`.
    pub fn send_password_reset(&mut self, email: &str) -> Result<(), String> {
        self.firebase.send_password_reset_email(email)
    }

    /// Attaches first/last name + phone to a just-created account, using the fresh sign-up
    /// token directly rather than this client's stored session - there isn't one yet, since
    pub fn patch_profile(
        &self,
        id_token: &str,
        first_name: &str,
        last_name: &str,
        phone: &str,
    ) -> Result<(), String> {
        let url = format!("{}/api/auth/profile", self.api_url);
        let res = self
            .client
            .post(url)
            .header("Authorization", format!("Bearer {id_token}"))
            .json(&serde_json::json!({
                "firstName": first_name,
                "lastName": last_name,
                "phone": phone,
            }))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|err| {
                log::warn!("Profile patch network error: {err}");
                "Could not reach the server.".to_string()
            })?;
        if res.status().is_success() {
            return Ok(());
        }
        let body: serde_json::Value = res.json().unwrap_or(serde_json::Value::Null);
        Err(body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Could not save your name and phone number.")
            .to_string())
    }

    /// Change the signed-in member's own timezone (`members.timezone`).
    pub fn update_member_timezone(&mut self, timezone: &str) -> Result<(), String> {
        let auth = self.authorized().ok_or("Sign in to change your timezone.")?;
        let url = format!("{}/api/auth/profile", self.api_url);
        let res = self
            .client
            .post(url)
            .header("Authorization", auth)
            .json(&serde_json::json!({ "timezone": timezone }))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|err| {
                log::warn!("Timezone update network error: {err}");
                "Could not reach the server.".to_string()
            })?;
        if res.status().is_success() {
            return Ok(());
        }
        let body: serde_json::Value = res.json().unwrap_or(serde_json::Value::Null);
        Err(body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Could not save your timezone.")
            .to_string())
    }

    /// The same authorization gate a browser session passes (`POST
    /// /api/auth/session-bootstrap`): it creates or aligns the member record and
    /// refuses disabled, banned, unverified or must-change-password accounts. Running
    /// it after an in-app sign-in is what stops the agent accepting a user the
    /// dashboard would reject, and what keeps a freshly registered account from ending
    /// up with tokens but no member row.
    ///
    /// `Err(ApiError::Rejected(msg))` is a real refusal with the server's own wording;
    /// `Err(ApiError::Network)` is a network problem, which must not be treated as a
    /// rejection.
    pub fn session_bootstrap(&mut self) -> Result<(), ApiError> {
        let Some(auth) = self.auth_headers() else {
            return Err(ApiError::Rejected("Not signed in".into()));
        };
        let url = format!("{}/api/auth/session-bootstrap", self.api_url);
        let res = self
            .client
            .post(url)
            .header("Authorization", auth)
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({}))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send();
        let res = match res {
            Ok(r) => r,
            Err(err) => {
                log::warn!("Session bootstrap network error: {err}");
                return Err(ApiError::Network);
            }
        };
        let status = res.status();
        if status.is_success() {
            return Ok(());
        }
        // 5xx is the platform having a bad moment, not a verdict on this user.
        if status.is_server_error() {
            log::warn!("Session bootstrap unavailable ({})", status.as_u16());
            return Err(ApiError::Network);
        }
        let body: serde_json::Value = res.json().unwrap_or(serde_json::Value::Null);
        let message = body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("This account cannot use the desktop agent yet.")
            .to_string();
        log::warn!("Session bootstrap refused ({})", status.as_u16());
        Err(ApiError::Rejected(message))
    }

    /// Authorized GET returning the parsed body.
    ///
    /// Every read in this client repeated the same eight lines: take the token, build the
    pub(crate) fn get_json(&mut self, path: &str) -> Result<Value, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let res = self
            .client
            .get(format!("{}{}", self.api_url, path))
            .header("Authorization", auth)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|_| ApiError::Network)?;
        if !res.status().is_success() {
            return Err(ApiError::Network);
        }
        res.json().map_err(|_| ApiError::Network)
    }

    /// Authorized POST that only cares whether it worked. On refusal the server's own
    /// message is surfaced, falling back to `fallback` when it sent none.
    pub(crate) fn post_ok(&mut self, path: &str, body: &Value, fallback: &str) -> Result<(), ApiError> {
        match self.post_json(path, body) {
            Ok(_) => Ok(()),
            Err(ApiError::Network) => Err(ApiError::Rejected(fallback.to_string())),
            Err(other) => Err(other),
        }
    }

    /// Authorized POST. `Ok(body)` on success, the server's own message on refusal.
    pub(crate) fn post_json(&mut self, path: &str, body: &Value) -> Result<Value, ApiError> {
        self.request_json(reqwest::Method::POST, path, Some(body))
    }

    /// Authorized request with a body and the server's own message on refusal.
    /// `get_json` collapses every failure to a network error, which is right for
    /// polling but hides a message like "you can exclude up to 100 items".
    pub(crate) fn request_json(
        &mut self,
        method: reqwest::Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, ApiError> {
        let auth = self.authorized().ok_or(ApiError::Unauthorized)?;
        let mut request = self
            .client
            .request(method, format!("{}{}", self.api_url, path))
            .header("Authorization", auth)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC));
        if let Some(body) = body {
            request = request.header("Content-Type", "application/json").json(body);
        }
        let res = request.send().map_err(|_| ApiError::Network)?;
        if !res.status().is_success() {
            return Err(status_error(res));
        }
        Ok(res.json().unwrap_or_else(|_| serde_json::json!({})))
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

/// A 5xx is worth retrying, a 4xx is not - and a 4xx usually carries a message meant
/// for the person, so it is surfaced rather than flattened into "network error".
fn status_error(res: reqwest::blocking::Response) -> ApiError {
    if res.status().is_server_error() {
        return ApiError::Network;
    }
    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        return ApiError::Unauthorized;
    }
    let payload: Value = res.json().unwrap_or_else(|_| serde_json::json!({}));
    match payload.get("error").and_then(|v| v.as_str()) {
        Some(message) if !message.is_empty() => ApiError::Rejected(message.to_string()),
        _ => ApiError::Network,
    }
}

#[cfg(test)]
mod tests {
    use std::net::TcpListener;

    use super::*;
    use crate::test_support::{fake_jwt, fake_server};

    // A rejected refresh token is permanently dead: securetoken answers 4xx
    // for expired, revoked and disabled-user alike, and none of those change
    // on a retry. Every authenticated request runs refresh_token_if_needed
    // first, so without a memory of the refusal each of the tracker's pollers
    // re-attempted the same dead token - a real agent log carries 3,475 of
    // them, fifteen inside four seconds.
    fn rejecting_client() -> (ApiClient, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        let hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = std::sync::Arc::clone(&hits);
        let token_url = fake_server(move |_req| {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            (403, "{\"error\":{\"message\":\"TOKEN_EXPIRED\"}}".to_string())
        });
        let mut api = ApiClient::new("http://127.0.0.1:1".into(), "http://127.0.0.1:1".into())
            .expect("HTTP client builds in a test environment");
        api.firebase.point_at_fake_for_tests(&token_url, "fake-api-key-long-enough");
        // Already expired, so every call is forced down the refresh path.
        api.set_tokens(&fake_jwt(-3600), "dead-refresh-token");
        (api, hits)
    }

    #[test]
    fn a_rejected_refresh_token_is_only_ever_sent_once() {
        let (mut api, hits) = rejecting_client();

        for _ in 0..25 {
            assert!(!api.refresh_token_if_needed(), "a dead token can never authorize");
        }

        assert_eq!(
            hits.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "the token must be presented once; the other 24 calls are known-dead round trips"
        );
        assert_eq!(api.last_refresh, RefreshOutcome::Rejected, "and the caller still sees why");
    }

    #[test]
    fn a_new_refresh_token_is_tried_even_after_one_was_rejected() {
        // The memory is keyed on the token, not on the client: signing in
        // again must not inherit the previous credential's refusal.
        let (mut api, hits) = rejecting_client();
        assert!(!api.refresh_token_if_needed());
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1);

        api.set_tokens(&fake_jwt(-3600), "a-different-refresh-token");
        assert!(!api.refresh_token_if_needed());
        assert_eq!(
            hits.load(std::sync::atomic::Ordering::SeqCst),
            2,
            "a token that has never been refused deserves its own attempt"
        );
    }

    #[test]
    fn an_unreachable_endpoint_is_retried_rather_than_written_off() {
        // The distinction the whole thing rests on. A 5xx or a dropped
        // connection says nothing about the credential, so caching that as a
        // refusal would strand an agent whose network merely blipped.
        let hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = std::sync::Arc::clone(&hits);
        let token_url = fake_server(move |_req| {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            (503, "{}".to_string())
        });
        let mut api = ApiClient::new("http://127.0.0.1:1".into(), "http://127.0.0.1:1".into())
            .expect("HTTP client builds in a test environment");
        api.firebase.point_at_fake_for_tests(&token_url, "fake-api-key-long-enough");
        api.set_tokens(&fake_jwt(-3600), "refresh-token");

        for _ in 0..4 {
            assert!(!api.refresh_token_if_needed());
        }
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 4, "every attempt must go out");
        assert_eq!(api.last_refresh, RefreshOutcome::Unreachable);
    }

    #[test]
    fn a_still_valid_token_never_reaches_the_network_at_all() {
        let (mut api, hits) = rejecting_client();
        api.set_tokens(&fake_jwt(3600), "dead-refresh-token");
        assert!(api.refresh_token_if_needed());
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    fn authed_client(api_url: String) -> ApiClient {
        let mut api = ApiClient::new(api_url, "http://127.0.0.1:1".into())
            .expect("HTTP client builds in a test environment");
        // A not-yet-expired token means `authorized()`'s refresh check passes without ever
        // reaching the (deliberately unreachable) auth_url above.
        api.set_tokens(&fake_jwt(3600), "refresh-token");
        api
    }

    // Suggestion #14c: the shared `authorized()` prologue (added for Suggestion #10) is
    // what every migrated method now goes through - these guard that it still does its one

    #[test]
    fn authorized_prologue_attaches_the_bearer_token_as_a_header() {
        let url = fake_server(|request| {
            let has_bearer = request.headers().iter().any(|h| {
                h.field.equiv("Authorization") && h.value.as_str().starts_with("Bearer header.")
            });
            assert!(has_bearer, "request reached the server without an Authorization header");
            (200, r#"{"data": null}"#.to_string())
        });
        let mut api = authed_client(url);
        // Fetch_session is enough to exercise the prologue; its own parsing of the response
        // body isn't what this test is about.
        let _ = api.fetch_session();
    }

    #[test]
    fn distinguishes_a_network_failure_from_a_real_rejection() {
        // Case 1: nothing is listening at all - a pure network failure.
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        drop(listener);
        let mut unreachable_api = authed_client(format!("http://{addr}"));
        assert_eq!(unreachable_api.session_bootstrap(), Err(ApiError::Network));

        // Case 2: the server is reached and explicitly refuses, with its own message - this
        // must surface as `Rejected`, not `Network`, since a caller (sign_in_with_password)
        let url = fake_server(|_request| {
            (403, r#"{"error": "This account has been disabled."}"#.to_string())
        });
        let mut rejected_api = authed_client(url);
        assert_eq!(
            rejected_api.session_bootstrap(),
            Err(ApiError::Rejected("This account has been disabled.".into()))
        );
    }

    #[test]
    fn reauth_terminal_failure_is_reported_as_rejected() {
        // No device credential stored at all is the same "must re-link" outcome `Err(true)`
        // used to encode under the old `Result<(), bool>` contract - `is_rejected()` is how
        let mut api = authed_client("http://127.0.0.1:1".into());
        let err = api.reauth_with_device().expect_err("no device credential stored");
        assert!(err.is_rejected());
    }

    #[test]
    fn refresh_without_a_refresh_token_or_device_credential_fails_closed() {
        // Expired id token, no refresh token, no device credential: the device-reauth
        // fallback this exercises must decline without making any network call (nothing
        let mut api = ApiClient::new("http://127.0.0.1:1".into(), "http://127.0.0.1:1".into())
            .expect("HTTP client builds in a test environment");
        api.set_tokens(&fake_jwt(-3600), "");
        assert!(!api.refresh_token_if_needed());
    }
}
