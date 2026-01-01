//! Secure Storage Module
//!
//! Provides secure storage for sensitive data (JWT tokens).
//! In dev mode: Uses Tauri Store (to avoid keychain prompts)
//! In production: Uses OS keychain/credential manager
//!   - On macOS: Uses Keychain
//!   - On Windows: Uses Credential Manager
//!   - On Linux: Uses Secret Service (libsecret)

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[cfg(not(debug_assertions))]
use keyring::Entry;

#[cfg(not(debug_assertions))]
const SERVICE_NAME: &str = "com.lexi.ai";
const ACCESS_TOKEN_KEY: &str = "access_token";
const REFRESH_TOKEN_KEY: &str = "refresh_token";
const USER_DATA_KEY: &str = "user_data";
const EXPIRES_AT_KEY: &str = "expires_at";
const EXPIRES_IN_KEY: &str = "expires_in";
const STORE_FILE: &str = ".auth.dat";

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

/// Store authentication data securely
/// In dev mode: Uses Tauri Store
/// In production: Uses OS keychain
pub fn store_auth_data(app: &AppHandle, data: &AuthData) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        // Dev mode: Use Tauri Store
        use tauri_plugin_store::StoreExt;
        let store = app
            .store(STORE_FILE)
            .map_err(|e| format!("Failed to open store: {}", e))?;

        store.set(ACCESS_TOKEN_KEY, serde_json::json!(data.access_token));

        if let Some(refresh_token) = &data.refresh_token {
            store.set(REFRESH_TOKEN_KEY, serde_json::json!(refresh_token));
        }

        if let Some(user) = &data.user {
            let user_json = serde_json::to_value(user)
                .map_err(|e| format!("Failed to serialize user data: {}", e))?;
            store.set(USER_DATA_KEY, user_json);
        }

        if let Some(expires_at) = data.expires_at {
            store.set(EXPIRES_AT_KEY, serde_json::json!(expires_at));
        }

        if let Some(expires_in) = data.expires_in {
            store.set(EXPIRES_IN_KEY, serde_json::json!(expires_in));
        }

        store
            .save()
            .map_err(|e| format!("Failed to save store: {}", e))?;
        println!("✅ Auth data stored in Tauri Store (dev mode)");
        return Ok(());
    }

    #[cfg(not(debug_assertions))]
    {
        // Production: Use OS keychain
        let access_entry = Entry::new(SERVICE_NAME, ACCESS_TOKEN_KEY)
            .map_err(|e| format!("Failed to create keyring entry for access token: {}", e))?;
        access_entry
            .set_password(&data.access_token)
            .map_err(|e| format!("Failed to store access token: {}", e))?;

        if let Some(refresh_token) = &data.refresh_token {
            let refresh_entry = Entry::new(SERVICE_NAME, REFRESH_TOKEN_KEY)
                .map_err(|e| format!("Failed to create keyring entry for refresh token: {}", e))?;
            refresh_entry
                .set_password(refresh_token)
                .map_err(|e| format!("Failed to store refresh token: {}", e))?;
        }

        if let Some(user) = &data.user {
            let user_json = serde_json::to_string(user)
                .map_err(|e| format!("Failed to serialize user data: {}", e))?;
            let user_entry = Entry::new(SERVICE_NAME, USER_DATA_KEY)
                .map_err(|e| format!("Failed to create keyring entry for user data: {}", e))?;
            user_entry
                .set_password(&user_json)
                .map_err(|e| format!("Failed to store user data: {}", e))?;
        }

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

        println!("✅ Auth data stored in OS keychain (production)");
        Ok(())
    }
}

/// Retrieve authentication data
/// In dev mode: Uses Tauri Store
/// In production: Uses OS keychain
pub fn get_auth_data(app: &AppHandle) -> Result<Option<AuthData>, String> {
    #[cfg(debug_assertions)]
    {
        // Dev mode: Use Tauri Store
        use tauri_plugin_store::StoreExt;
        let store = app
            .store(STORE_FILE)
            .map_err(|e| format!("Failed to open store: {}", e))?;

        let access_token = match store.get(ACCESS_TOKEN_KEY) {
            Some(val) => val
                .as_str()
                .ok_or_else(|| "Access token is not a string".to_string())?
                .to_string(),
            None => return Ok(None), // No stored data
        };

        let refresh_token = store
            .get(REFRESH_TOKEN_KEY)
            .and_then(|v| v.as_str().map(|s| s.to_string()));

        let user = store
            .get(USER_DATA_KEY)
            .and_then(|v| serde_json::from_value::<UserData>(v.clone()).ok());

        let expires_at = store.get(EXPIRES_AT_KEY).and_then(|v| v.as_u64());

        let expires_in = store.get(EXPIRES_IN_KEY).and_then(|v| v.as_u64());

        Ok(Some(AuthData {
            access_token,
            refresh_token,
            expires_at,
            expires_in,
            user,
        }))
    }

    #[cfg(not(debug_assertions))]
    {
        // Production: Use OS keychain
        let access_entry = Entry::new(SERVICE_NAME, ACCESS_TOKEN_KEY)
            .map_err(|e| format!("Failed to create keyring entry for access token: {}", e))?;

        let access_token = match access_entry.get_password() {
            Ok(token) => token,
            Err(keyring::Error::NoEntry) => return Ok(None), // No stored data
            Err(e) => return Err(format!("Failed to retrieve access token: {}", e)),
        };

        let refresh_token = Entry::new(SERVICE_NAME, REFRESH_TOKEN_KEY)
            .map_err(|e| format!("Failed to create keyring entry for refresh token: {}", e))
            .ok()
            .and_then(|entry| entry.get_password().ok());

        let user = Entry::new(SERVICE_NAME, USER_DATA_KEY)
            .map_err(|e| format!("Failed to create keyring entry for user data: {}", e))
            .ok()
            .and_then(|entry| entry.get_password().ok())
            .and_then(|json| serde_json::from_str::<UserData>(&json).ok());

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
}

/// Clear all authentication data
/// In dev mode: Uses Tauri Store
/// In production: Uses OS keychain
pub fn clear_auth_data(app: &AppHandle) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        // Dev mode: Use Tauri Store
        use tauri_plugin_store::StoreExt;
        let store = app
            .store(STORE_FILE)
            .map_err(|e| format!("Failed to open store: {}", e))?;

        store.delete(ACCESS_TOKEN_KEY);
        store.delete(REFRESH_TOKEN_KEY);
        store.delete(USER_DATA_KEY);
        store.delete(EXPIRES_AT_KEY);
        store.delete(EXPIRES_IN_KEY);

        store
            .save()
            .map_err(|e| format!("Failed to save store: {}", e))?;
        println!("✅ Auth data cleared from Tauri Store (dev mode)");
        Ok(())
    }

    #[cfg(not(debug_assertions))]
    {
        // Production: Use OS keychain
        if let Ok(entry) = Entry::new(SERVICE_NAME, ACCESS_TOKEN_KEY) {
            let _ = entry.delete_password();
        }
        if let Ok(entry) = Entry::new(SERVICE_NAME, REFRESH_TOKEN_KEY) {
            let _ = entry.delete_password();
        }
        if let Ok(entry) = Entry::new(SERVICE_NAME, USER_DATA_KEY) {
            let _ = entry.delete_password();
        }
        if let Ok(entry) = Entry::new(SERVICE_NAME, EXPIRES_AT_KEY) {
            let _ = entry.delete_password();
        }
        if let Ok(entry) = Entry::new(SERVICE_NAME, EXPIRES_IN_KEY) {
            let _ = entry.delete_password();
        }
        println!("✅ Auth data cleared from OS keychain (production)");
        Ok(())
    }
}

/// Check if authentication data exists
/// In dev mode: Uses Tauri Store
/// In production: Uses OS keychain
pub fn has_auth_data(app: &AppHandle) -> Result<bool, String> {
    #[cfg(debug_assertions)]
    {
        // Dev mode: Use Tauri Store
        use tauri_plugin_store::StoreExt;
        let store = app
            .store(STORE_FILE)
            .map_err(|e| format!("Failed to open store: {}", e))?;

        Ok(store.get(ACCESS_TOKEN_KEY).is_some())
    }

    #[cfg(not(debug_assertions))]
    {
        // Production: Use OS keychain
        let entry = Entry::new(SERVICE_NAME, ACCESS_TOKEN_KEY)
            .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

        match entry.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(format!("Failed to check keychain: {}", e)),
        }
    }
}
