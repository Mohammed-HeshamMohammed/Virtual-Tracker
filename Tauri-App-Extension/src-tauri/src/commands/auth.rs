//! Signing in and out. Every one of these ends in the browser link
//! flow rather than collecting credentials in the app.

use std::sync::Arc;

use crate::run_blocking;
use crate::AppState;
use crate::types::{SignInResult};

/// `hint` is an optional `key=value` query pair forwarded to the browser link
/// page - `"provider=google"`/`"provider=apple"` for social sign-in,
/// `"mode=signup"`/`"mode=forgot-password"` for account creation and
/// password reset. All three still link this device, unlike the old
/// plain-`open_web_app` buttons they replace.
// Tauri requires an async command taking a reference input (`State`) to
// return `Result` - these never actually fail at the Rust level (failure is
// already a field inside the returned value), so every `Err` arm below is
// unreachable in practice; `Ok(...)` is just satisfying that constraint.
#[tauri::command]
pub async fn sign_in(state: tauri::State<'_, AppState>, hint: Option<String>) -> Result<SignInResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.open_sign_in(hint.as_deref())).await)
}

/// In-app email/password sign-in, no browser round-trip. The password is
/// passed straight through to the sign-in call and is never persisted.
#[tauri::command]
pub async fn sign_in_with_password(
    state: tauri::State<'_, AppState>,
    email: String,
    password: String,
) -> Result<SignInResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.sign_in_with_password(&email, &password)).await)
}

/// In-app account creation, no browser round-trip.
#[tauri::command]
pub async fn sign_up(
    state: tauri::State<'_, AppState>,
    email: String,
    password: String,
    first_name: String,
    last_name: String,
    phone: String,
) -> Result<SignInResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.sign_up(&email, &password, &first_name, &last_name, &phone)).await)
}

/// In-app "forgot password" request, no browser round-trip.
#[tauri::command]
pub async fn send_password_reset(
    state: tauri::State<'_, AppState>,
    email: String,
) -> Result<SignInResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.request_password_reset(&email)).await)
}

/// Distinct from sign_in/"Re-link account": ends the session and clears
/// tokens, but does not start a new browser link flow afterward.
#[tauri::command]
pub async fn sign_out(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.sign_out()).await)
}
