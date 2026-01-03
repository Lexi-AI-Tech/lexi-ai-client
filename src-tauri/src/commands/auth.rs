//! Authentication Commands
//!
//! This module provides all Tauri commands for managing authentication.
//! This is the unified interface for all authentication-related operations.
//!
//! ## Authentication Storage
//! - Store/retrieve authentication data from secure storage (OS keychain or Tauri Store)
//! - All auth data is stored securely and read directly when needed
//!
//! ## OAuth Flow
//! - Google OAuth 2.0 authentication with PKCE
//! - Token exchange and management

use crate::commands::app_config;
use crate::google_oauth;
use crate::secure_storage::{self, AuthData, UserData};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

// ============================================================================
// Authentication Data Types
// ============================================================================

/// Request structure for storing authentication data (frontend interface)
///
/// This is the public-facing type used in Tauri commands. It's converted to
/// `AuthData` internally for storage operations.
#[derive(Debug, Serialize, Deserialize)]
pub struct AuthDataRequest {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<u64>,
    pub expires_in: Option<u64>,
    pub user: Option<UserDataRequest>,
}

/// User data structure for authentication (frontend interface)
#[derive(Debug, Serialize, Deserialize)]
pub struct UserDataRequest {
    pub email: String,
    pub name: String,
    pub picture: Option<String>,
}

// Conversion implementations for cleaner code
impl From<AuthDataRequest> for AuthData {
    fn from(request: AuthDataRequest) -> Self {
        Self {
            access_token: request.access_token,
            refresh_token: request.refresh_token,
            expires_at: request.expires_at,
            expires_in: request.expires_in,
            user: request.user.map(Into::into),
        }
    }
}

impl From<AuthData> for AuthDataRequest {
    fn from(data: AuthData) -> Self {
        Self {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: data.expires_at,
            expires_in: data.expires_in,
            user: data.user.map(Into::into),
        }
    }
}

impl From<UserDataRequest> for UserData {
    fn from(request: UserDataRequest) -> Self {
        Self {
            email: request.email,
            name: request.name,
            picture: request.picture,
        }
    }
}

impl From<UserData> for UserDataRequest {
    fn from(data: UserData) -> Self {
        Self {
            email: data.email,
            name: data.name,
            picture: data.picture,
        }
    }
}

// ============================================================================
// Secure Storage Commands (Frontend Interface)
// ============================================================================

/// Store authentication data securely
///
/// Stores authentication tokens and user data in secure storage.
/// In dev mode: Uses Tauri Store (to avoid keychain prompts)
/// In production: Uses OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
///
/// After storing auth data, fetches app config from server and saves it to Tauri Store.
/// This ensures we get the default settings from the server on first login.
///
/// # Arguments
/// * `data` - Authentication data including tokens and user information
#[tauri::command]
pub async fn store_auth_data(app: AppHandle, data: AuthDataRequest) -> Result<(), String> {
    let auth_data: AuthData = data.into();
    secure_storage::store_auth_data(&app, &auth_data)?;

    // After login, force fetch config from server and save it to Tauri Store
    // This ensures we get default settings from server and override any first launch config
    match app_config::fetch_config_from_server(&app).await {
        Ok(mut config) => {
            println!("✅ App config fetched and saved after login");
            // Sync autostart status with OS based on server config
            app_config::sync_autostart_status(&app, &mut config);
        }
        Err(e) => {
            eprintln!("⚠️  Failed to fetch app config after login: {}", e);
            // Don't fail the login if config fetch fails, but log it
        }
    }

    Ok(())
}

/// Retrieve authentication data
///
/// Reads authentication tokens and user data from secure storage.
/// In dev mode: Uses Tauri Store
/// In production: Uses OS keychain
///
/// # Returns
/// * `Option<AuthDataRequest>` - Authentication data if found, None otherwise
#[tauri::command]
pub async fn get_auth_data(app: AppHandle) -> Result<Option<AuthDataRequest>, String> {
    Ok(secure_storage::get_auth_data(&app)?.map(Into::into))
}

/// Clear all authentication data
///
/// Removes all stored authentication tokens and user data from secure storage.
/// In dev mode: Uses Tauri Store
/// In production: Uses OS keychain
#[tauri::command]
pub async fn clear_auth_data(app: AppHandle) -> Result<(), String> {
    secure_storage::clear_auth_data(&app)?;
    Ok(())
}

/// Check if authentication data exists
///
/// Checks whether authentication data is stored in secure storage.
/// In dev mode: Uses Tauri Store
/// In production: Uses OS keychain
///
/// # Returns
/// * `bool` - true if authentication data exists, false otherwise
#[tauri::command]
pub async fn has_auth_data(app: AppHandle) -> Result<bool, String> {
    secure_storage::has_auth_data(&app)
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

/// Get the current authentication token (helper for internal Rust code)
///
/// Convenience function that reads from secure storage and returns just the access token.
/// For full auth data, use `get_auth_data()` instead. This is used internally by Rust code
/// that only needs the token for API requests.
///
/// # Arguments
/// * `app` - The Tauri AppHandle to access secure storage
///
/// # Returns
/// * `Option<String>` - The current access token if available, None otherwise
pub fn get_auth_token(app: &AppHandle) -> Option<String> {
    // Read directly from secure storage
    match secure_storage::get_auth_data(app) {
        Ok(Some(auth_data)) => Some(auth_data.access_token),
        Ok(None) => None,
        Err(e) => {
            eprintln!("⚠️  Failed to read auth token from secure storage: {}", e);
            None
        }
    }
}

// ============================================================================
// OAuth Commands
// ============================================================================

// Re-export OAuth commands
pub use google_oauth::get_pkce_verifier;
pub use google_oauth::start_google_login;
