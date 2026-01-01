//! Authentication Commands
//!
//! This module provides all Tauri commands for managing authentication.
//! This is the unified interface for all authentication-related operations.
//!
//! ## Authentication Storage
//! - Store/retrieve authentication data from secure storage (OS keychain or Tauri Store)
//! - All auth data is stored securely and read directly when needed (no in-memory caching)
//!
//! ## OAuth Flow
//! - Google OAuth 2.0 authentication with PKCE
//! - Token exchange and management

use crate::google_oauth;
use crate::secure_storage::{self, AuthData, UserData};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

// ============================================================================
// Authentication Data Types
// ============================================================================

/// Request structure for storing authentication data
#[derive(Debug, Serialize, Deserialize)]
pub struct AuthDataRequest {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<u64>,
    pub expires_in: Option<u64>,
    pub user: Option<UserDataRequest>,
}

/// User data structure for authentication
#[derive(Debug, Serialize, Deserialize)]
pub struct UserDataRequest {
    pub email: String,
    pub name: String,
    pub picture: Option<String>,
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
/// # Arguments
/// * `data` - Authentication data including tokens and user information
#[tauri::command]
pub async fn store_auth_data(app: AppHandle, data: AuthDataRequest) -> Result<(), String> {
    let auth_data = AuthData {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at,
        expires_in: data.expires_in,
        user: data.user.map(|u| UserData {
            email: u.email,
            name: u.name,
            picture: u.picture,
        }),
    };

    secure_storage::store_auth_data(&app, &auth_data)?;
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
    match secure_storage::get_auth_data(&app)? {
        Some(data) => Ok(Some(AuthDataRequest {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: data.expires_at,
            expires_in: data.expires_in,
            user: data.user.map(|u| UserDataRequest {
                email: u.email,
                name: u.name,
                picture: u.picture,
            }),
        })),
        None => Ok(None),
    }
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
// Internal Functions (Rust Code Only)
// ============================================================================

/// Get the current authentication token (internal function)
///
/// Reads directly from secure storage (OS keychain in production, Tauri Store in dev).
/// This is the internal function used by Rust code. For frontend access, use the
/// `get_auth_data` Tauri command instead.
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

// ============================================================================
// Legacy Commands (Backward Compatibility)
// ============================================================================

/// Set the authentication token from frontend
///
/// This command is kept for backward compatibility but is now a no-op.
/// The frontend should use `store_auth_data` to persist tokens.
/// Tokens are read directly from secure storage when needed.
///
/// # Arguments
/// * `token` - Optional access token (ignored, kept for API compatibility)
#[tauri::command]
pub fn set_auth_token(_token: Option<String>) {
    // No-op: Tokens are now stored via store_auth_data and read directly from keychain
    println!("🔐 set_auth_token called (no-op - tokens are read directly from secure storage)");
}

// ============================================================================
// OAuth Commands
// ============================================================================

// Re-export OAuth commands
pub use google_oauth::get_pkce_verifier;
pub use google_oauth::start_google_login;
