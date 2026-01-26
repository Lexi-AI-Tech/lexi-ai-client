//! Room Commands
//!
//! Tauri commands for managing rooms and room recording.

use crate::commands::auth::get_auth_token_async;
use crate::utils;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
pub struct Room {
    pub id: String,
    pub name: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RoomCreate {
    pub name: String,
}

/// Create a new room
#[tauri::command]
pub async fn create_room(app: AppHandle, name: String) -> Result<Room, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or("Authentication required")?;

    let client = reqwest::Client::new();
    let url = format!("{}/api/v1/rooms", crate::config::api_base_url());

    let payload = RoomCreate { name };

    utils::log_api_request("Create a new room", "POST", &url);

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }

    let room: Room = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(room)
}

/// List user's rooms
#[tauri::command]
pub async fn list_rooms(app: AppHandle) -> Result<Vec<Room>, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or("Authentication required")?;

    let client = reqwest::Client::new();
    let url = format!("{}/api/v1/rooms", crate::config::api_base_url());

    utils::log_api_request("List user's rooms", "GET", &url);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }

    let rooms: Vec<Room> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(rooms)
}

/// Get room details
#[tauri::command]
pub async fn get_room_details(
    app: AppHandle,
    room_id: String,
) -> Result<serde_json::Value, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or("Authentication required")?;

    let client = reqwest::Client::new();
    let url = format!("{}/api/v1/rooms/{}", crate::config::api_base_url(), room_id);

    utils::log_api_request("Get room details", "GET", &url);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }

    let room: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(room)
}

/// Finalize room (mark as completed)
#[tauri::command]
pub async fn finalize_room(app: AppHandle, room_id: String) -> Result<serde_json::Value, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or("Authentication required")?;

    let client = reqwest::Client::new();
    let url = format!(
        "{}/api/v1/rooms/{}/finalize",
        crate::config::api_base_url(),
        room_id
    );

    utils::log_api_request("Finalize room (mark as completed)", "POST", &url);

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }

    let room: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(room)
}

/// Export room transcript as JSON
#[tauri::command]
pub async fn export_room_transcript(
    app: AppHandle,
    room_id: String,
) -> Result<serde_json::Value, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or("Authentication required")?;

    let client = reqwest::Client::new();
    let url = format!(
        "{}/api/v1/rooms/{}/export",
        crate::config::api_base_url(),
        room_id
    );

    utils::log_api_request("Export room transcript as JSON", "GET", &url);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }

    let export_data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(export_data)
}

/// Update speaker name
#[tauri::command]
pub async fn update_speaker(
    app: AppHandle,
    room_id: String,
    speaker_label: String,
    new_name: String,
) -> Result<serde_json::Value, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or("Authentication required")?;

    let client = reqwest::Client::new();
    let url = format!(
        "{}/api/v1/rooms/{}/speakers",
        crate::config::api_base_url(),
        room_id
    );

    let payload = serde_json::json!({
        "speaker_label": speaker_label,
        "new_name": new_name
    });

    utils::log_api_request("Update speaker name in room", "PATCH", &url);

    let response = client
        .patch(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }

    let room: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(room)
}
