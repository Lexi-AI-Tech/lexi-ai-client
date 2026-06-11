//! Notes Commands
//!
//! Tauri commands for managing notes (CRUD operations).

use crate::commands::auth::get_auth_token_async;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub team_id: String,
    pub created_by: String,
    pub updated_by: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedNotesResponse {
    pub notes: Vec<Note>,
    pub total: i32,
    pub page: i32,
    pub page_size: i32,
    pub total_pages: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateNoteRequest {
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateNoteRequest {
    pub content: Option<String>,
}

/// Get paginated list of notes
#[tauri::command]
pub async fn get_notes(
    app: AppHandle,
    page: Option<i32>,
    page_size: Option<i32>,
) -> Result<PaginatedNotesResponse, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Ok(token) => token,
        Err(e) => {
            crate::commands::auth::handle_auth_error(&app, &e);
            return Err("Authentication required".to_string());
        }
    };

    let page = page.unwrap_or(1);
    let page_size = page_size.unwrap_or(20);

    let params = [
        ("page", page.to_string()),
        ("page_size", page_size.to_string()),
    ];

    let query_string = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let url = format!(
        "{}/api/v1/notes?{}",
        crate::config::api_base_url(),
        query_string
    );

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
    let notes_data = if data.get("data").is_some() {
        &data["data"]
    } else {
        &data
    };

    serde_json::from_value(notes_data.clone())
        .map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// Get a specific note by ID
#[tauri::command]
pub async fn get_note(app: AppHandle, note_id: String) -> Result<Note, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Ok(token) => token,
        Err(e) => {
            crate::commands::auth::handle_auth_error(&app, &e);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!("{}/api/v1/notes/{}", crate::config::api_base_url(), note_id);

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
    let note_data = if data.get("data").is_some() {
        &data["data"]
    } else {
        &data
    };

    serde_json::from_value(note_data.clone())
        .map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// Create a new note
#[tauri::command]
pub async fn create_note(app: AppHandle, content: String) -> Result<Note, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Ok(token) => token,
        Err(e) => {
            crate::commands::auth::handle_auth_error(&app, &e);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!("{}/api/v1/notes", crate::config::api_base_url());

    let request_body = CreateNoteRequest { content };

    let client = crate::utils::create_http_client();
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Content-Type", "application/json")
        .json(&request_body)
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
    let note_data = if data.get("data").is_some() {
        &data["data"]
    } else {
        &data
    };

    serde_json::from_value(note_data.clone())
        .map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// Update an existing note
#[tauri::command]
pub async fn update_note(
    app: AppHandle,
    note_id: String,
    content: Option<String>,
) -> Result<Note, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Ok(token) => token,
        Err(e) => {
            crate::commands::auth::handle_auth_error(&app, &e);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!("{}/api/v1/notes/{}", crate::config::api_base_url(), note_id);

    let request_body = UpdateNoteRequest { content };

    let client = crate::utils::create_http_client();
    let response = client
        .put(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Content-Type", "application/json")
        .json(&request_body)
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
    let note_data = if data.get("data").is_some() {
        &data["data"]
    } else {
        &data
    };

    serde_json::from_value(note_data.clone())
        .map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// Delete a note by ID
#[tauri::command]
pub async fn delete_note(app: AppHandle, note_id: String) -> Result<(), String> {
    let auth_token = match get_auth_token_async(&app).await {
        Ok(token) => token,
        Err(e) => {
            crate::commands::auth::handle_auth_error(&app, &e);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!("{}/api/v1/notes/{}", crate::config::api_base_url(), note_id);

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
