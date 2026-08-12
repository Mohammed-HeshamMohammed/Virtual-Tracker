use std::time::Duration;

use base64::Engine;
use reqwest::blocking::Client;
use serde_json::Value;

use crate::constants::HTTP_TIMEOUT_SEC;

/// Why a token refresh failed. Collapsing these into one "it didn't work" is
/// what made a dead session indistinguishable from a flaky network - they need
/// opposite responses: retry vs. re-authenticate this device.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshOutcome {
    Ok,
    /// Network or backend problem; the credentials are probably still fine.
    Unreachable,
    /// Firebase rejected the refresh token outright (revoked, password change,
    /// disabled account). Retrying will never succeed.
    Rejected,
}

/// Why an email/password sign-in failed, in the agent's own vocabulary.
/// `NeedsBrowser` is the important one: a second factor or a provider we can't
/// drive from a native form, where the honest answer is to hand the user to
/// the browser link flow rather than fail with a Firebase error code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PasswordSignInError {
    BadCredentials,
    Disabled,
    RateLimited,
    NeedsBrowser,
    Unreachable,
}

impl PasswordSignInError {
    pub fn message(&self) -> &'static str {
        match self {
            Self::BadCredentials => "Email or password is incorrect.",
            Self::Disabled => "This account has been disabled. Contact your administrator.",
            Self::RateLimited => {
                "Too many attempts. Wait a few minutes, or use Link account instead."
            }
            Self::NeedsBrowser => {
                "This account needs an extra verification step. Use Link account to continue in your browser."
            }
            Self::Unreachable => "Could not reach the sign-in service. Check your connection.",
        }
    }

    /// Maps Identity Toolkit's `error.message` code. Anything unrecognised is
    /// treated as bad credentials rather than surfacing a raw Google string -
    /// every code this endpoint returns for a *failed* password sign-in is
    /// some flavour of "that login didn't work".
    pub fn from_firebase_code(code: &str) -> Self {
        // Codes arrive as "INVALID_PASSWORD" or "TOO_MANY_ATTEMPTS_TRY_LATER : <detail>".
        let code = code.split(':').next().unwrap_or(code).trim();
        match code {
            "USER_DISABLED" => Self::Disabled,
            "TOO_MANY_ATTEMPTS_TRY_LATER" => Self::RateLimited,
            "MFA_REQUIRED" | "SECOND_FACTOR_REQUIRED" => Self::NeedsBrowser,
            _ => Self::BadCredentials,
        }
    }
}

/// Why an in-app account-creation call failed, in the agent's own vocabulary
/// - mirrors `PasswordSignInError`'s shape for the same reason: every code
/// Identity Toolkit's `accounts:signUp` can return for a *failed* signup is
/// collapsed into one of a few user-facing outcomes instead of a raw string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignUpError {
    EmailInUse,
    WeakPassword,
    InvalidEmail,
    Unreachable,
    Other(String),
}

impl SignUpError {
    pub fn message(&self) -> String {
        match self {
            Self::EmailInUse => "This email is already in use. Try signing in instead.".into(),
            Self::WeakPassword => "Password must be at least 6 characters.".into(),
            Self::InvalidEmail => "Enter a valid email address.".into(),
            Self::Unreachable => "Could not reach the sign-in service. Check your connection.".into(),
            Self::Other(msg) => msg.clone(),
        }
    }

    pub fn from_firebase_code(code: &str) -> Self {
        let code = code.split(':').next().unwrap_or(code).trim();
        match code {
            "EMAIL_EXISTS" => Self::EmailInUse,
            "WEAK_PASSWORD" => Self::WeakPassword,
            "INVALID_EMAIL" | "MISSING_EMAIL" => Self::InvalidEmail,
            _ => Self::Other("Could not create account. Try again.".into()),
        }
    }
}

pub struct FirebaseTokenService {
    auth_url: String,
    client: Client,
    api_key: Option<String>,
}

impl FirebaseTokenService {
    /// `auth_url` is Auth-Backend, the only service that serves the Firebase
    /// web config - the dashboard API 404s it on purpose.
    pub fn new(auth_url: String, client: Client) -> Self {
        Self {
            auth_url,
            client,
            api_key: None,
        }
    }

    fn firebase_api_key(&mut self) -> Option<String> {
        if let Some(key) = &self.api_key {
            return Some(key.clone());
        }
        let url = format!("{}/api/auth/firebase-config", self.auth_url);
        match self
            .client
            .get(&url)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
        {
            Ok(res) if res.status().is_success() => {
                let body: Value = res.json().ok()?;
                // serverApiKey is unrestricted (or restricted only to Identity
                // Toolkit) - apiKey is the browser's referrer-restricted key,
                // which Google 403s for this agent's direct (no-Referer)
                // calls to securetoken/identitytoolkit. Fall back to apiKey
                // for older Auth-Backend deployments that predate the field.
                let key = body
                    .pointer("/config/serverApiKey")
                    .or_else(|| body.pointer("/config/apiKey"))
                    .and_then(|v| v.as_str())
                    .filter(|k| k.len() > 10)?
                    .to_string();
                self.api_key = Some(key.clone());
                Some(key)
            }
            Ok(_) | Err(_) => {
                log::warn!("Firebase config fetch failed");
                None
            }
        }
    }

    pub fn id_token_expiry_ms(id_token: &str) -> Option<i64> {
        let parts: Vec<&str> = id_token.split('.').collect();
        if parts.len() < 2 {
            return None;
        }
        let padded = format!("{}{}", parts[1], "=".repeat((4 - parts[1].len() % 4) % 4));
        let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(padded.trim_end_matches('=').as_bytes())
            .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(padded.as_bytes()))
            .ok()?;
        let payload: Value = serde_json::from_slice(&decoded).ok()?;
        payload.get("exp").and_then(|v| v.as_i64()).map(|e| e * 1000)
    }

    pub fn refresh(&mut self, refresh_token: &str) -> (RefreshOutcome, Option<(String, String)>) {
        // No refresh token at all is a dead end, not a network blip.
        if refresh_token.is_empty() {
            return (RefreshOutcome::Rejected, None);
        }
        // The API key comes from our own backend, so failing to get it means
        // the backend is unreachable - not that the credentials are bad.
        let Some(api_key) = self.firebase_api_key() else {
            return (RefreshOutcome::Unreachable, None);
        };
        let url = format!("https://securetoken.googleapis.com/v1/token?key={api_key}");
        let res = match self
            .client
            .post(url)
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
            ])
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
        {
            Ok(r) => r,
            Err(err) => {
                log::warn!("Token refresh network error: {err}");
                return (RefreshOutcome::Unreachable, None);
            }
        };

        let status = res.status();
        if !status.is_success() {
            // 4xx is Firebase telling us the credential is bad; 5xx is Google
            // having a bad day and is worth retrying.
            let outcome = if status.is_client_error() {
                log::warn!("Token refresh rejected ({})", status.as_u16());
                RefreshOutcome::Rejected
            } else {
                RefreshOutcome::Unreachable
            };
            return (outcome, None);
        }

        let Ok(data) = res.json::<Value>() else {
            return (RefreshOutcome::Unreachable, None);
        };
        let Some(id_token) = data.get("id_token").and_then(|v| v.as_str()) else {
            return (RefreshOutcome::Unreachable, None);
        };
        let next_refresh = data
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .unwrap_or(refresh_token)
            .to_string();
        (RefreshOutcome::Ok, Some((id_token.to_string(), next_refresh)))
    }

    /// Trades a backend-minted custom token for a real id/refresh pair. This is
    /// what lets the agent recover using its own device credential instead of
    /// sending the user back through a browser link.
    pub fn sign_in_with_custom_token(&mut self, custom_token: &str) -> Option<(String, String)> {
        let api_key = self.firebase_api_key()?;
        let url = format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key={api_key}"
        );
        let res = self
            .client
            .post(url)
            .json(&serde_json::json!({
                "token": custom_token,
                "returnSecureToken": true,
            }))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .ok()?;
        if !res.status().is_success() {
            log::warn!("Custom-token sign-in failed ({})", res.status().as_u16());
            return None;
        }
        let data: Value = res.json().ok()?;
        let id_token = data.get("idToken")?.as_str()?.to_string();
        let refresh = data
            .get("refreshToken")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Some((id_token, refresh))
    }
}

impl FirebaseTokenService {
    /// Email/password sign-in, the same Identity Toolkit call the web app makes
    /// through the Firebase SDK. The password is used once here and never
    /// stored, logged or echoed back.
    pub fn sign_in_with_password(
        &mut self,
        email: &str,
        password: &str,
    ) -> Result<(String, String), PasswordSignInError> {
        let Some(api_key) = self.firebase_api_key() else {
            return Err(PasswordSignInError::Unreachable);
        };
        let url = format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={api_key}"
        );
        let res = self
            .client
            .post(url)
            .json(&serde_json::json!({
                "email": email,
                "password": password,
                "returnSecureToken": true,
            }))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|err| {
                log::warn!("Password sign-in network error: {err}");
                PasswordSignInError::Unreachable
            })?;

        let status = res.status();
        let data: Value = res.json().map_err(|_| PasswordSignInError::Unreachable)?;

        if !status.is_success() {
            let code = data
                .pointer("/error/message")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            log::warn!("Password sign-in rejected ({})", status.as_u16());
            return Err(PasswordSignInError::from_firebase_code(code));
        }

        // A successful response carrying an MFA challenge instead of tokens -
        // the second factor cannot be answered from this form.
        if data.get("mfaPendingCredential").is_some() {
            return Err(PasswordSignInError::NeedsBrowser);
        }

        let id_token = data
            .get("idToken")
            .and_then(|v| v.as_str())
            .ok_or(PasswordSignInError::Unreachable)?
            .to_string();
        let refresh = data
            .get("refreshToken")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok((id_token, refresh))
    }

    /// Which providers exist for an email, straight from Auth-Backend. Lets the
    /// form say "this account signs in with Google" instead of letting Firebase
    /// answer a password attempt with a generic failure.
    pub fn sign_in_methods(&self, email: &str) -> Option<Vec<String>> {
        let url = format!("{}/api/auth/resolve-sign-in-methods", self.auth_url);
        let res = self
            .client
            .post(url)
            .json(&serde_json::json!({ "email": email }))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .ok()?;
        if !res.status().is_success() {
            return None;
        }
        let body: Value = res.json().ok()?;
        Some(
            body.get("methods")?
                .as_array()?
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
        )
    }

    /// In-app account creation, the same Identity Toolkit call
    /// `createUserWithEmailAndPassword` makes on the web. Returns fresh
    /// tokens for the new account; the caller decides whether to keep them
    /// (this agent signs back out and asks the user to verify + sign in
    /// normally, matching the web form).
    pub fn sign_up_with_password(
        &mut self,
        email: &str,
        password: &str,
    ) -> Result<(String, String), SignUpError> {
        let Some(api_key) = self.firebase_api_key() else {
            return Err(SignUpError::Unreachable);
        };
        let url =
            format!("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={api_key}");
        let res = self
            .client
            .post(url)
            .json(&serde_json::json!({
                "email": email,
                "password": password,
                "returnSecureToken": true,
            }))
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|err| {
                log::warn!("Sign-up network error: {err}");
                SignUpError::Unreachable
            })?;

        let status = res.status();
        let data: Value = res.json().map_err(|_| SignUpError::Unreachable)?;
        if !status.is_success() {
            let code = data
                .pointer("/error/message")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            log::warn!("Sign-up rejected ({})", status.as_u16());
            return Err(SignUpError::from_firebase_code(code));
        }

        let id_token = data
            .get("idToken")
            .and_then(|v| v.as_str())
            .ok_or(SignUpError::Unreachable)?
            .to_string();
        let refresh = data
            .get("refreshToken")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok((id_token, refresh))
    }

    /// Identity Toolkit's out-of-band email call. `request_type` is
    /// `"VERIFY_EMAIL"` (needs `id_token`, no `email`) or `"PASSWORD_RESET"`
    /// (needs `email`, no auth). Returns the raw `error.message` code on
    /// failure so callers can decide what it means for them - a
    /// `PASSWORD_RESET` caller treats `EMAIL_NOT_FOUND` as success (see
    /// `send_password_reset_email`), a `VERIFY_EMAIL` caller just logs it.
    fn send_oob_code(
        &mut self,
        request_type: &str,
        email: Option<&str>,
        id_token: Option<&str>,
    ) -> Result<(), String> {
        let Some(api_key) = self.firebase_api_key() else {
            return Err(String::new());
        };
        let url = format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key={api_key}"
        );
        let mut body = serde_json::json!({ "requestType": request_type });
        if let Some(e) = email {
            body["email"] = serde_json::json!(e);
        }
        if let Some(t) = id_token {
            body["idToken"] = serde_json::json!(t);
        }
        let res = self
            .client
            .post(url)
            .json(&body)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
            .map_err(|err| {
                log::warn!("sendOobCode ({request_type}) network error: {err}");
                String::new()
            })?;
        let status = res.status();
        if status.is_success() {
            return Ok(());
        }
        let data: Value = res.json().unwrap_or(Value::Null);
        Err(data
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string())
    }

    /// Best-effort: a freshly created account not getting its verification
    /// email is annoying, not fatal, and the account still exists either way.
    pub fn send_email_verification(&mut self, id_token: &str) {
        if let Err(code) = self.send_oob_code("VERIFY_EMAIL", None, Some(id_token)) {
            log::warn!("Could not send verification email: {code}");
        }
    }

    /// Enumeration-safe, same as the web's `sendFirebasePasswordResetEmail`:
    /// an unknown email reports the same success as a real one.
    pub fn send_password_reset_email(&mut self, email: &str) -> Result<(), String> {
        match self.send_oob_code("PASSWORD_RESET", Some(email), None) {
            Ok(()) => Ok(()),
            Err(code) => {
                let head = code.split(':').next().unwrap_or(&code).trim();
                match head {
                    "EMAIL_NOT_FOUND" => Ok(()),
                    "INVALID_EMAIL" | "MISSING_EMAIL" => {
                        Err("Enter a valid email address.".into())
                    }
                    "TOO_MANY_ATTEMPTS_TRY_LATER" => {
                        Err("Too many attempts. Wait a few minutes and try again.".into())
                    }
                    _ => Err("Could not reach the sign-in service. Check your connection.".into()),
                }
            }
        }
    }
}

pub fn jwt_payload(id_token: &str) -> Value {
    let parts: Vec<&str> = id_token.split('.').collect();
    if parts.len() < 2 {
        return Value::Object(Default::default());
    }
    let padded = format!("{}{}", parts[1], "=".repeat((4 - parts[1].len() % 4) % 4));
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(padded.trim_end_matches('=').as_bytes())
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(padded.as_bytes()));
    match decoded {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|_| Value::Object(Default::default())),
        Err(_) => Value::Object(Default::default()),
    }
}

#[cfg(test)]
mod tests {
    use super::PasswordSignInError;

    #[test]
    fn wrong_password_and_unknown_email_read_the_same() {
        // Deliberate: telling the two apart is an account-enumeration oracle,
        // and Firebase itself now collapses them into INVALID_LOGIN_CREDENTIALS.
        for code in ["INVALID_PASSWORD", "EMAIL_NOT_FOUND", "INVALID_LOGIN_CREDENTIALS"] {
            assert_eq!(
                PasswordSignInError::from_firebase_code(code),
                PasswordSignInError::BadCredentials
            );
        }
    }

    #[test]
    fn disabled_and_rate_limited_are_distinct_from_bad_credentials() {
        assert_eq!(
            PasswordSignInError::from_firebase_code("USER_DISABLED"),
            PasswordSignInError::Disabled
        );
        assert_eq!(
            PasswordSignInError::from_firebase_code("TOO_MANY_ATTEMPTS_TRY_LATER"),
            PasswordSignInError::RateLimited
        );
    }

    #[test]
    fn codes_carrying_a_detail_suffix_still_match() {
        assert_eq!(
            PasswordSignInError::from_firebase_code(
                "TOO_MANY_ATTEMPTS_TRY_LATER : Access to this account has been temporarily disabled."
            ),
            PasswordSignInError::RateLimited
        );
    }

    #[test]
    fn second_factor_sends_the_user_to_the_browser() {
        assert_eq!(
            PasswordSignInError::from_firebase_code("MFA_REQUIRED"),
            PasswordSignInError::NeedsBrowser
        );
        assert!(PasswordSignInError::NeedsBrowser
            .message()
            .contains("Link account"));
    }

    #[test]
    fn unrecognised_codes_never_leak_the_raw_firebase_string() {
        let err = PasswordSignInError::from_firebase_code("SOME_NEW_GOOGLE_CODE");
        assert_eq!(err, PasswordSignInError::BadCredentials);
        assert!(!err.message().contains("SOME_NEW_GOOGLE_CODE"));
    }
}
