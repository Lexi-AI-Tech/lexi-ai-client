//! Authentication Commands
//!
//! This module provides Tauri commands for managing authentication state.

use crate::google_oauth;
use crate::state::AuthTokenState;
use tauri::State;

/// Set the authentication token from frontend
///
/// This command allows the frontend to update the access token stored in Rust state.
/// The frontend should call this whenever the auth token changes.
///
/// # Arguments
/// * `token` - Optional access token from frontend
#[tauri::command]
pub fn set_auth_token(state: State<AuthTokenState>, token: Option<String>) {
    if let Ok(mut token_guard) = state.token.lock() {
        *token_guard = token;
        println!("🔐 Auth token updated");
    }
}

/// Get the current authentication token
///
/// # Returns
/// * `Option<String>` - The current access token if available, None otherwise
pub fn get_auth_token(state: &State<AuthTokenState>) -> Option<String> {
    if let Ok(token_guard) = state.token.lock() {
        token_guard.clone()
    } else {
        None
    }
}

// Re-export OAuth commands
pub use google_oauth::get_pkce_verifier;
pub use google_oauth::start_google_login;
