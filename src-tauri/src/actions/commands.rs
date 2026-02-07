//! Action Commands
//!
//! Tauri commands for managing action history.

use crate::commands::auth::get_auth_token_async;
use crate::utils;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
pub struct ActionHistory {
    pub id: String,
    pub created_by: String,
    pub updated_by: String,
    pub action_command: String,
    pub app_name: Option<String>,
    pub selected_text: Option<String>,
    pub action_type: String,
    pub output_value: Option<String>,
    pub output_audio_file_path: Option<String>,
    pub output_audio_file_size: Option<i32>,
    pub output_audio_file_url: Option<String>,
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

    utils::log_api_request("Get paginated action history", "GET", &url);

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

    utils::log_api_request("Delete action history entry", "DELETE", &url);

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
