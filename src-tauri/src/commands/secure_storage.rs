//! Secure Storage Commands
//!
//! Provides Tauri commands for securely storing and retrieving authentication tokens
//! using OS keychain/credential manager instead of plaintext storage.

use crate::secure_storage::{self, AuthData, UserData};
use serde::{Deserialize, Serialize};

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

/// Store authentication data securely in OS keychain
///
/// This command stores JWT tokens in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
/// which provides encryption at rest and OS-level access control.
#[tauri::command]
pub async fn store_auth_data_secure(data: AuthDataRequest) -> Result<(), String> {
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

    secure_storage::store_auth_data(&auth_data)?;
    println!("✅ Auth data stored securely in OS keychain");
    Ok(())
}

/// Retrieve authentication data from OS keychain
///
/// Returns the stored authentication tokens and user data from secure storage.
#[tauri::command]
pub async fn get_auth_data_secure() -> Result<Option<AuthDataRequest>, String> {
    match secure_storage::get_auth_data()? {
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

/// Clear all authentication data from OS keychain
///
/// Removes all stored tokens and user data from secure storage.
#[tauri::command]
pub async fn clear_auth_data_secure() -> Result<(), String> {
    secure_storage::clear_auth_data()?;
    println!("✅ Auth data cleared from OS keychain");
    Ok(())
}

/// Check if authentication data exists in keychain
///
/// Returns true if auth data is stored, false otherwise.
#[tauri::command]
pub async fn has_auth_data_secure() -> Result<bool, String> {
    secure_storage::has_auth_data()
}
