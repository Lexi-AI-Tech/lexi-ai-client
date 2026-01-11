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
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
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
    pub id: String,
    pub email: String,
    pub name: String,
    pub picture: Option<String>,
}

pub(crate) fn get_jwt_exp_claim(token: &str) -> Option<u64> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }

    let payload = parts[1];
    let padding = (4 - payload.len() % 4) % 4;
    let padded = format!("{}{}", payload, "=".repeat(padding));

    if let Ok(decoded) = URL_SAFE_NO_PAD.decode(&padded) {
        if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&decoded) {
            if let Some(exp) = json.get("exp").and_then(|v| v.as_u64()) {
                return Some(exp);
            }
        }
    }
    None
}

impl From<AuthDataRequest> for AuthData {
    fn from(request: AuthDataRequest) -> Self {
        let expires_at = if request.expires_at.is_none() {
            if let Some(exp) = get_jwt_exp_claim(&request.access_token) {
                Some(exp)
            } else if let Some(expires_in) = request.expires_in {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                Some(now + expires_in)
            } else {
                None
            }
        } else {
            request.expires_at
        };

        Self {
            access_token: request.access_token,
            refresh_token: request.refresh_token,
            expires_at,
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
            id: request.id,
            email: request.email,
            name: request.name,
            picture: request.picture,
        }
    }
}

impl From<UserData> for UserDataRequest {
    fn from(data: UserData) -> Self {
        Self {
            id: data.id,
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

/// Refresh the access token using the refresh token
///
/// This function calls the backend refresh endpoint to get a new access token.
/// It updates the stored auth data with the new tokens.
///
/// # Arguments
/// * `app` - The Tauri AppHandle to access secure storage
/// * `refresh_token` - The refresh token to use for refreshing
///
/// # Returns
/// * `Result<Option<String>, String>` - The new access token if successful, None if refresh failed, Err if error occurred
async fn refresh_access_token(
    app: &AppHandle,
    refresh_token: &str,
) -> Result<Option<String>, String> {
    use crate::api_endpoints::auth;
    use reqwest;
    use serde_json::json;

    use crate::commands::utils;

    let client = reqwest::Client::new();
    let url = auth::refresh_url();

    let device_type = utils::get_device_type();
    let system_type = utils::get_system_type();

    let request_body = json!({
        "refresh_token": refresh_token,
        "system_type": system_type,
        "device_type": device_type,
    });

    println!("🔄 Attempting to refresh access token...");

    match client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<serde_json::Value>().await {
                    Ok(data) => {
                        // Handle both direct response and wrapped response
                        let token_data = if data.get("data").is_some() {
                            &data["data"]
                        } else {
                            &data
                        };

                        if let Some(access_token) =
                            token_data.get("access_token").and_then(|v| v.as_str())
                        {
                            let refresh_token_new = token_data
                                .get("refresh_token")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());

                            let expires_at = get_jwt_exp_claim(access_token).or_else(|| {
                                token_data.get("expires_in").and_then(|v| v.as_u64()).map(
                                    |expires_in| {
                                        std::time::SystemTime::now()
                                            .duration_since(std::time::UNIX_EPOCH)
                                            .unwrap()
                                            .as_secs()
                                            + expires_in
                                    },
                                )
                            });

                            let expires_in = token_data.get("expires_in").and_then(|v| v.as_u64());

                            // Get existing user data to preserve it
                            let existing_auth = secure_storage::get_auth_data(app)?;
                            let user = existing_auth.and_then(|a| a.user);

                            // Update stored auth data
                            let new_auth_data = secure_storage::AuthData {
                                access_token: access_token.to_string(),
                                refresh_token: refresh_token_new,
                                expires_at,
                                expires_in,
                                user,
                            };

                            secure_storage::store_auth_data(app, &new_auth_data)?;
                            println!("✅ Access token refreshed successfully");
                            Ok(Some(access_token.to_string()))
                        } else {
                            eprintln!("⚠️  Refresh response missing access_token");
                            Ok(None)
                        }
                    }
                    Err(e) => {
                        eprintln!("⚠️  Failed to parse refresh response: {}", e);
                        Ok(None)
                    }
                }
            } else {
                let status = response.status();
                let error_text = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unknown error".to_string());
                eprintln!("⚠️  Token refresh failed: {} - {}", status, error_text);
                Ok(None)
            }
        }
        Err(e) => {
            eprintln!("⚠️  Token refresh request failed: {}", e);
            Err(format!("Token refresh request failed: {}", e))
        }
    }
}

/// Get the current authentication token (helper for internal Rust code)
///
/// This function checks if the token is expired or expiring soon (within 5 minutes),
/// and automatically refreshes it if needed. For full auth data, use `get_auth_data()` instead.
///
/// # Arguments
/// * `app` - The Tauri AppHandle to access secure storage
///
/// # Returns
/// * `Option<String>` - The current access token if available, None otherwise
pub async fn get_auth_token_async(app: &AppHandle) -> Option<String> {
    // Read auth data from secure storage
    let auth_data = match secure_storage::get_auth_data(app) {
        Ok(Some(data)) => data,
        Ok(None) => return None,
        Err(e) => {
            eprintln!("⚠️  Failed to read auth token from secure storage: {}", e);
            return None;
        }
    };

    // Check if token is expired or expiring soon (within 5 minutes)
    let buffer_time = 5 * 60; // 5 minutes in seconds
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let needs_refresh = if let Some(expires_at) = auth_data.expires_at {
        expires_at <= now + buffer_time
    } else {
        // If expires_at is not set, assume token might be expired and try to refresh
        // This is a safety measure for tokens stored before expires_at was tracked
        true
    };

    if needs_refresh {
        if let Some(refresh_token) = &auth_data.refresh_token {
            println!("🔄 Token expired or expiring soon, refreshing...");
            match refresh_access_token(app, refresh_token).await {
                Ok(Some(new_token)) => return Some(new_token),
                Ok(None) => {
                    eprintln!("⚠️  Token refresh returned None");
                    // Fall through to return existing token (might still work)
                }
                Err(e) => {
                    eprintln!("⚠️  Token refresh failed: {}", e);
                    // Fall through to return existing token (might still work)
                }
            }
        } else {
            eprintln!("⚠️  Token expired but no refresh token available");
            // Return None to force re-authentication
            return None;
        }
    }

    // Token is still valid, return it
    Some(auth_data.access_token)
}

// ============================================================================
// OAuth Commands
// ============================================================================

// Re-export OAuth commands
pub use google_oauth::get_pkce_verifier;
pub use google_oauth::start_google_login;

// ============================================================================
// User Info Commands
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub picture: Option<String>,
}

/// Get current user information from backend
#[tauri::command]
pub async fn get_current_user(app: AppHandle) -> Result<UserInfo, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or_else(|| "Authentication required".to_string())?;

    let url = format!("{}/api/v1/auth/me", crate::config::api_base_url());

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Server error ({}): {}", status, error_text));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let user_data = if data.get("data").is_some() {
        &data["data"]
    } else {
        &data
    };

    serde_json::from_value(user_data.clone())
        .map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// Logout from backend
#[tauri::command]
pub async fn logout(app: AppHandle) -> Result<(), String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or_else(|| "Authentication required".to_string())?;

    let url = format!("{}/api/v1/auth/logout", crate::config::api_base_url());

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    // Even if logout fails on backend, we'll clear local auth
    if !response.status().is_success() {
        eprintln!("⚠️  Backend logout failed, clearing local auth anyway");
    }

    // Clear local auth data
    secure_storage::clear_auth_data(&app)?;

    Ok(())
}
