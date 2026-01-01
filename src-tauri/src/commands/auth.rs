//! Authentication Commands
//!
//! This module provides Tauri commands for managing authentication.
//! Authentication tokens are stored securely in OS keychain (or Tauri Store in dev mode)
//! and are read directly from storage when needed, with no in-memory caching.

use crate::google_oauth;
use crate::secure_storage;
use tauri::AppHandle;

/// Get the current authentication token (internal function)
///
/// Reads directly from secure storage (OS keychain in production, Tauri Store in dev).
/// This is the internal function used by Rust code. For frontend access, use the
/// `get_auth_data_secure` Tauri command from the secure_storage module.
///
/// # Arguments
/// * `app` - The Tauri AppHandle to access secure storage
///
/// # Returns
/// * `Option<String>` - The current access token if available, None otherwise
pub fn get_auth_token_internal(app: &AppHandle) -> Option<String> {
    // Read directly from secure storage (no in-memory cache)
    match secure_storage::get_auth_data(app) {
        Ok(Some(auth_data)) => Some(auth_data.access_token),
        Ok(None) => None,
        Err(e) => {
            eprintln!("⚠️  Failed to read auth token from secure storage: {}", e);
            None
        }
    }
}

/// Set the authentication token from frontend
///
/// This command is kept for backward compatibility but is now a no-op.
/// The frontend should use `store_auth_data_secure` from the secure_storage module
/// to persist tokens. Tokens are read directly from secure storage when needed.
///
/// # Arguments
/// * `token` - Optional access token (ignored, kept for API compatibility)
#[tauri::command]
pub fn set_auth_token(_token: Option<String>) {
    // No-op: Tokens are now stored via store_auth_data_secure and read directly from keychain
    println!("🔐 set_auth_token called (no-op - tokens are read directly from secure storage)");
}

// Re-export OAuth commands
pub use google_oauth::get_pkce_verifier;
pub use google_oauth::start_google_login;
