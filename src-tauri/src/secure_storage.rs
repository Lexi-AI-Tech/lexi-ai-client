//! Secure Storage Module
//!
//! Provides secure storage for sensitive data (JWT tokens) using OS keychain/credential manager.
//! On macOS: Uses Keychain
//! On Windows: Uses Credential Manager
//! On Linux: Uses Secret Service (libsecret)
//!
//! This is much more secure than storing tokens in localStorage or plaintext files.

use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE_NAME: &str = "com.lexi.ai";
const ACCESS_TOKEN_KEY: &str = "access_token";
const REFRESH_TOKEN_KEY: &str = "refresh_token";
const USER_DATA_KEY: &str = "user_data";
const EXPIRES_AT_KEY: &str = "expires_at";
const EXPIRES_IN_KEY: &str = "expires_in";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthData {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<u64>,
    pub expires_in: Option<u64>,
    pub user: Option<UserData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserData {
    pub email: String,
    pub name: String,
    pub picture: Option<String>,
}

/// Store authentication data securely in OS keychain
pub fn store_auth_data(data: &AuthData) -> Result<(), String> {
    // Store access token
    let access_entry = Entry::new(SERVICE_NAME, ACCESS_TOKEN_KEY)
        .map_err(|e| format!("Failed to create keyring entry for access token: {}", e))?;
    access_entry
        .set_password(&data.access_token)
        .map_err(|e| format!("Failed to store access token: {}", e))?;

    // Store refresh token if available
    if let Some(refresh_token) = &data.refresh_token {
        let refresh_entry = Entry::new(SERVICE_NAME, REFRESH_TOKEN_KEY)
            .map_err(|e| format!("Failed to create keyring entry for refresh token: {}", e))?;
        refresh_entry
            .set_password(refresh_token)
            .map_err(|e| format!("Failed to store refresh token: {}", e))?;
    }

    // Store user data as JSON (less sensitive, but still in keychain)
    if let Some(user) = &data.user {
        let user_json = serde_json::to_string(user)
            .map_err(|e| format!("Failed to serialize user data: {}", e))?;
        let user_entry = Entry::new(SERVICE_NAME, USER_DATA_KEY)
            .map_err(|e| format!("Failed to create keyring entry for user data: {}", e))?;
        user_entry
            .set_password(&user_json)
            .map_err(|e| format!("Failed to store user data: {}", e))?;
    }

    // Store expiration data if available
    if let Some(expires_at) = data.expires_at {
        let expires_entry = Entry::new(SERVICE_NAME, EXPIRES_AT_KEY)
            .map_err(|e| format!("Failed to create keyring entry for expires_at: {}", e))?;
        expires_entry
            .set_password(&expires_at.to_string())
            .map_err(|e| format!("Failed to store expires_at: {}", e))?;
    }

    if let Some(expires_in) = data.expires_in {
        let expires_in_entry = Entry::new(SERVICE_NAME, EXPIRES_IN_KEY)
            .map_err(|e| format!("Failed to create keyring entry for expires_in: {}", e))?;
        expires_in_entry
            .set_password(&expires_in.to_string())
            .map_err(|e| format!("Failed to store expires_in: {}", e))?;
    }

    Ok(())
}

/// Retrieve authentication data from OS keychain
pub fn get_auth_data() -> Result<Option<AuthData>, String> {
    // Get access token
    let access_entry = Entry::new(SERVICE_NAME, ACCESS_TOKEN_KEY)
        .map_err(|e| format!("Failed to create keyring entry for access token: {}", e))?;

    let access_token = match access_entry.get_password() {
        Ok(token) => token,
        Err(keyring::Error::NoEntry) => return Ok(None), // No stored data
        Err(e) => return Err(format!("Failed to retrieve access token: {}", e)),
    };

    // Get refresh token (optional)
    let refresh_token = Entry::new(SERVICE_NAME, REFRESH_TOKEN_KEY)
        .map_err(|e| format!("Failed to create keyring entry for refresh token: {}", e))
        .ok()
        .and_then(|entry| entry.get_password().ok());

    // Get user data (optional)
    let user = Entry::new(SERVICE_NAME, USER_DATA_KEY)
        .map_err(|e| format!("Failed to create keyring entry for user data: {}", e))
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .and_then(|json| serde_json::from_str::<UserData>(&json).ok());

    // Get expiration data (optional)
    let expires_at = Entry::new(SERVICE_NAME, EXPIRES_AT_KEY)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .and_then(|s| s.parse::<u64>().ok());

    let expires_in = Entry::new(SERVICE_NAME, EXPIRES_IN_KEY)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .and_then(|s| s.parse::<u64>().ok());

    Ok(Some(AuthData {
        access_token,
        refresh_token,
        expires_at,
        expires_in,
        user,
    }))
}

/// Clear all authentication data from OS keychain
pub fn clear_auth_data() -> Result<(), String> {
    // Clear access token
    if let Ok(entry) = Entry::new(SERVICE_NAME, ACCESS_TOKEN_KEY) {
        let _ = entry.delete_password();
    }

    // Clear refresh token
    if let Ok(entry) = Entry::new(SERVICE_NAME, REFRESH_TOKEN_KEY) {
        let _ = entry.delete_password();
    }

    // Clear user data
    if let Ok(entry) = Entry::new(SERVICE_NAME, USER_DATA_KEY) {
        let _ = entry.delete_password();
    }

    // Clear expiration data
    if let Ok(entry) = Entry::new(SERVICE_NAME, EXPIRES_AT_KEY) {
        let _ = entry.delete_password();
    }

    if let Ok(entry) = Entry::new(SERVICE_NAME, EXPIRES_IN_KEY) {
        let _ = entry.delete_password();
    }

    Ok(())
}

/// Check if authentication data exists in keychain
pub fn has_auth_data() -> Result<bool, String> {
    let entry = Entry::new(SERVICE_NAME, ACCESS_TOKEN_KEY)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("Failed to check keychain: {}", e)),
    }
}
