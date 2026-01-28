//! Shortcut Commands
//!
//! Tauri commands for managing shortcuts.

use crate::commands::auth::get_auth_token_async;
use crate::utils;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Shortcut {
    pub id: String,
    #[serde(rename = "shortcut")]
    pub phrase: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShortcutCreateRequest {
    pub shortcut: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShortcutUpdateRequest {
    pub shortcut: Option<String>,
    pub value: Option<String>,
}

/// Get all shortcuts
#[tauri::command]
pub async fn get_shortcuts(
    app: AppHandle,
    system_type: Option<String>,
) -> Result<Vec<Shortcut>, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or_else(|| "Authentication required".to_string())?;

    let system_type = system_type.unwrap_or_else(|| "macos".to_string());

    let url = format!(
        "{}/api/v1/shortcuts?system_type={}",
        crate::config::api_base_url(),
        urlencoding::encode(&system_type)
    );

    utils::log_api_request("Get all shortcuts", "GET", &url);

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

    let shortcuts_data = if data.get("data").is_some() {
        &data["data"]
    } else {
        &data
    };

    serde_json::from_value(shortcuts_data.clone())
        .map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// Create a new shortcut
#[tauri::command]
pub async fn create_shortcut(
    app: AppHandle,
    request: ShortcutCreateRequest,
    system_type: Option<String>,
) -> Result<Shortcut, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or_else(|| "Authentication required".to_string())?;

    let system_type = system_type.unwrap_or_else(|| "macos".to_string());

    let url = format!(
        "{}/api/v1/shortcuts?system_type={}",
        crate::config::api_base_url(),
        urlencoding::encode(&system_type)
    );

    utils::log_api_request("Create new shortcut", "POST", &url);

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Content-Type", "application/json")
        .json(&request)
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

    let shortcut_data = if data.get("data").is_some() {
        &data["data"]
    } else {
        &data
    };

    serde_json::from_value(shortcut_data.clone())
        .map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// Update a shortcut
#[tauri::command]
pub async fn update_shortcut(
    app: AppHandle,
    shortcut_id: String,
    request: ShortcutUpdateRequest,
    system_type: Option<String>,
) -> Result<Shortcut, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or_else(|| "Authentication required".to_string())?;

    let system_type = system_type.unwrap_or_else(|| "macos".to_string());

    let url = format!(
        "{}/api/v1/shortcuts/{}?system_type={}",
        crate::config::api_base_url(),
        shortcut_id,
        urlencoding::encode(&system_type)
    );

    utils::log_api_request("Update shortcut", "PUT", &url);

    let client = reqwest::Client::new();
    let response = client
        .put(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Content-Type", "application/json")
        .json(&request)
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

    let shortcut_data = if data.get("data").is_some() {
        &data["data"]
    } else {
        &data
    };

    serde_json::from_value(shortcut_data.clone())
        .map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// Delete a shortcut
#[tauri::command]
pub async fn delete_shortcut(
    app: AppHandle,
    shortcut_id: String,
    system_type: Option<String>,
) -> Result<(), String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or_else(|| "Authentication required".to_string())?;

    let system_type = system_type.unwrap_or_else(|| "macos".to_string());

    let url = format!(
        "{}/api/v1/shortcuts/{}?system_type={}",
        crate::config::api_base_url(),
        shortcut_id,
        urlencoding::encode(&system_type)
    );

    utils::log_api_request("Delete shortcut", "DELETE", &url);

    let client = reqwest::Client::new();
    let response = client
        .delete(&url)
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

    Ok(())
}
