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

pub struct FirebaseTokenService {
    api_url: String,
    client: Client,
    api_key: Option<String>,
}

impl FirebaseTokenService {
    pub fn new(api_url: String, client: Client) -> Self {
        Self {
            api_url,
            client,
            api_key: None,
        }
    }

    fn firebase_api_key(&mut self) -> Option<String> {
        if let Some(key) = &self.api_key {
            return Some(key.clone());
        }
        let url = format!("{}/api/auth/firebase-config", self.api_url);
        match self
            .client
            .get(&url)
            .timeout(Duration::from_secs(HTTP_TIMEOUT_SEC))
            .send()
        {
            Ok(res) if res.status().is_success() => {
                let body: Value = res.json().ok()?;
                let key = body
                    .pointer("/config/apiKey")
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
