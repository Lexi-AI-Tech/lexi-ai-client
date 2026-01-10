//! Action Commands
//!
//! Tauri commands for managing action history and triggers.

use crate::commands::auth::get_auth_token_async;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
pub struct ActionHistory {
    pub id: String,
    pub user_id: String,
    pub action_command: String,
    pub app_name: Option<String>,
    pub selected_text: Option<String>,
    pub action_type: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedActionHistoryResponse {
    pub actions: Vec<ActionHistory>,
    pub total: i32,
    pub page: i32,
    pub page_size: i32,
    pub total_pages: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActionTrigger {
    pub id: String,
    pub trigger_phrase: String,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActionTriggerCreateRequest {
    pub trigger_phrase: String,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActionTriggerUpdateRequest {
    pub trigger_phrase: Option<String>,
    pub is_active: Option<bool>,
}

/// Get paginated action history
#[tauri::command]
pub async fn get_action_history(
    app: AppHandle,
    page: Option<i32>,
    page_size: Option<i32>,
    order_by: Option<String>,
    order_direction: Option<String>,
) -> Result<PaginatedActionHistoryResponse, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or_else(|| "Authentication required".to_string())?;

    let page = page.unwrap_or(1);
    let page_size = page_size.unwrap_or(20);
    let order_by = order_by.unwrap_or_else(|| "created_at".to_string());
    let order_direction = order_direction.unwrap_or_else(|| "desc".to_string());

    let query_string = format!(
        "page={}&page_size={}&order_by={}&order_direction={}",
        page, page_size, order_by, order_direction
    );

    let url = format!(
        "{}/api/v1/actions/history?{}",
        crate::config::api_base_url(),
        query_string
    );

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

    let history_data = if data.get("data").is_some() {
        &data["data"]
    } else {
        &data
    };

    serde_json::from_value(history_data.clone())
        .map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// Delete an action history entry
#[tauri::command]
pub async fn delete_action_history(app: AppHandle, action_id: String) -> Result<(), String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or_else(|| "Authentication required".to_string())?;

    let url = format!(
        "{}/api/v1/actions/history/{}",
        crate::config::api_base_url(),
        action_id
    );

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

/// Get all action triggers
#[tauri::command]
pub async fn get_action_triggers(
    app: AppHandle,
    system_type: Option<String>,
    include_inactive: Option<bool>,
) -> Result<Vec<ActionTrigger>, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or_else(|| "Authentication required".to_string())?;

    let system_type = system_type.unwrap_or_else(|| "macos".to_string());
    let include_inactive = include_inactive.unwrap_or(false);

    let mut query_params = vec![("system_type", system_type)];
    if include_inactive {
        query_params.push(("include_inactive", "true".to_string()));
    }

    let query_string = query_params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let url = format!(
        "{}/api/v1/actions/triggers?{}",
        crate::config::api_base_url(),
        query_string
    );

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

    let triggers_data = if data.get("data").is_some() {
        &data["data"]
    } else {
        &data
    };

    serde_json::from_value(triggers_data.clone())
        .map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// Create a new action trigger
#[tauri::command]
pub async fn create_action_trigger(
    app: AppHandle,
    request: ActionTriggerCreateRequest,
    system_type: Option<String>,
) -> Result<ActionTrigger, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or_else(|| "Authentication required".to_string())?;

    let system_type = system_type.unwrap_or_else(|| "macos".to_string());

    let url = format!(
        "{}/api/v1/actions/triggers?system_type={}",
        crate::config::api_base_url(),
        urlencoding::encode(&system_type)
    );

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

    let trigger_data = if data.get("data").is_some() {
        &data["data"]
    } else {
        &data
    };

    serde_json::from_value(trigger_data.clone())
        .map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// Update an action trigger
#[tauri::command]
pub async fn update_action_trigger(
    app: AppHandle,
    trigger_id: String,
    request: ActionTriggerUpdateRequest,
    system_type: Option<String>,
) -> Result<ActionTrigger, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or_else(|| "Authentication required".to_string())?;

    let system_type = system_type.unwrap_or_else(|| "macos".to_string());

    let url = format!(
        "{}/api/v1/actions/triggers/{}?system_type={}",
        crate::config::api_base_url(),
        trigger_id,
        urlencoding::encode(&system_type)
    );

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

    let trigger_data = if data.get("data").is_some() {
        &data["data"]
    } else {
        &data
    };

    serde_json::from_value(trigger_data.clone())
        .map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// Delete an action trigger
#[tauri::command]
pub async fn delete_action_trigger(
    app: AppHandle,
    trigger_id: String,
    system_type: Option<String>,
) -> Result<(), String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or_else(|| "Authentication required".to_string())?;

    let system_type = system_type.unwrap_or_else(|| "macos".to_string());

    let url = format!(
        "{}/api/v1/actions/triggers/{}?system_type={}",
        crate::config::api_base_url(),
        trigger_id,
        urlencoding::encode(&system_type)
    );

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
