//! Transcript Commands
//!
//! Tauri commands for managing transcripts (transcription history).

use crate::commands::auth::get_auth_token_async;
use crate::utils;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
pub struct Transcript {
    pub id: String,
    pub created_by: String,
    pub updated_by: String,
    pub original_text: String,
    pub original_text_word_count: i32,
    pub original_text_character_count: i32,
    pub is_enhanced: bool,
    pub enhanced_text: Option<String>,
    pub enhanced_text_word_count: Option<i32>,
    pub enhanced_text_character_count: Option<i32>,
    pub audio_file_url: Option<String>,
    pub audio_file_size: Option<i32>,
    pub focused_app: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedTranscriptsResponse {
    pub transcripts: Vec<Transcript>,
    pub total: i32,
    pub page: i32,
    pub page_size: i32,
    pub total_pages: i32,
}

/// Get paginated list of transcripts
#[tauri::command]
pub async fn get_transcripts(
    app: AppHandle,
    page: Option<i32>,
    page_size: Option<i32>,
    status: Option<String>,
    order_by: Option<String>,
    order_direction: Option<String>,
) -> Result<PaginatedTranscriptsResponse, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Some(token) => token,
        None => {
            crate::commands::auth::handle_auth_expired(&app);
            return Err("Authentication required".to_string());
        }
    };

    let page = page.unwrap_or(1);
    let page_size = page_size.unwrap_or(20);
    let order_by = order_by.unwrap_or_else(|| "created_at".to_string());
    let order_direction = order_direction.unwrap_or_else(|| "desc".to_string());

    let mut params = vec![
        ("page", page.to_string()),
        ("page_size", page_size.to_string()),
        ("order_by", order_by),
        ("order_direction", order_direction),
    ];

    if let Some(status) = status {
        params.push(("status", status));
    }

    let query_string = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let url = format!(
        "{}/api/v1/transcripts?{}",
        crate::config::api_base_url(),
        query_string
    );

    utils::log_api_request("Get paginated list of transcripts", "GET", &url);

    let client = crate::utils::create_http_client();
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

    // Handle both direct response and wrapped response
    let transcripts_data = if data.get("data").is_some() {
        &data["data"]
    } else {
        &data
    };

    serde_json::from_value(transcripts_data.clone())
        .map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// Get a specific transcript by ID
#[tauri::command]
pub async fn get_transcript(app: AppHandle, transcript_id: String) -> Result<Transcript, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Some(token) => token,
        None => {
            crate::commands::auth::handle_auth_expired(&app);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!(
        "{}/api/v1/transcripts/{}",
        crate::config::api_base_url(),
        transcript_id
    );

    utils::log_api_request("Get specific transcript by ID", "GET", &url);

    let client = crate::utils::create_http_client();
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

    // Handle both direct response and wrapped response
    let transcript_data = if data.get("data").is_some() {
        &data["data"]
    } else {
        &data
    };

    serde_json::from_value(transcript_data.clone())
        .map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// Delete a transcript by ID
#[tauri::command]
pub async fn delete_transcript(app: AppHandle, transcript_id: String) -> Result<(), String> {
    let auth_token = match get_auth_token_async(&app).await {
        Some(token) => token,
        None => {
            crate::commands::auth::handle_auth_expired(&app);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!(
        "{}/api/v1/transcripts/{}",
        crate::config::api_base_url(),
        transcript_id
    );

    utils::log_api_request("Delete transcript by ID", "DELETE", &url);

    let client = crate::utils::create_http_client();
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
