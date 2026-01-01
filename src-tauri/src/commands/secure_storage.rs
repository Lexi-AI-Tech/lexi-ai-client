//! Secure Storage Commands
//!
//! Provides Tauri commands for securely storing and retrieving authentication tokens.
//! In dev mode: Uses Tauri Store (to avoid keychain prompts)
//! In production: Uses OS keychain/credential manager

use crate::secure_storage::{self, AuthData, UserData};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthDataRequest {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<u64>,
    pub expires_in: Option<u64>,
    pub user: Option<UserDataRequest>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserDataRequest {
    pub email: String,
    pub name: String,
    pub picture: Option<String>,
}

/// Store authentication data securely
///
/// In dev mode: Uses Tauri Store (to avoid keychain prompts)
/// In production: Uses OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
#[tauri::command]
pub async fn store_auth_data_secure(app: AppHandle, data: AuthDataRequest) -> Result<(), String> {
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
/// In dev mode: Uses Tauri Store
/// In production: Uses OS keychain
#[tauri::command]
pub async fn get_auth_data_secure(app: AppHandle) -> Result<Option<AuthDataRequest>, String> {
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
/// In dev mode: Uses Tauri Store
/// In production: Uses OS keychain
#[tauri::command]
pub async fn clear_auth_data_secure(app: AppHandle) -> Result<(), String> {
    secure_storage::clear_auth_data(&app)?;
    Ok(())
}

/// Check if authentication data exists
///
/// In dev mode: Uses Tauri Store
/// In production: Uses OS keychain
#[tauri::command]
pub async fn has_auth_data_secure(app: AppHandle) -> Result<bool, String> {
    secure_storage::has_auth_data(&app)
}
