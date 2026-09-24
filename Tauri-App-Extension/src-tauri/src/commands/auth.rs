//! Signing in and out.

use std::sync::Arc;

use crate::run_blocking;
use crate::AppState;
use crate::types::{SignInResult};

/// `hint` is an optional `key=value` query pair forwarded to the browser link page -
/// `"provider=google"`/`"provider=apple"` for social sign-in
// Tauri requires an async command taking a reference input (`State`) to return `Result`
#[tauri::command]
pub async fn sign_in(state: tauri::State<'_, AppState>, hint: Option<String>) -> Result<SignInResult, String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.open_sign_in(hint.as_deref())).await)
}

/// In-app email/password sign-in, no browser round-trip.
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

/// Distinct from sign_in/"Re-link account": ends the session and clears tokens, but does
/// not start a new browser link flow afterward.
#[tauri::command]
pub async fn sign_out(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let controller = Arc::clone(&state.controller);
    Ok(run_blocking(move || controller.sign_out()).await)
}
