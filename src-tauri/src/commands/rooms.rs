//! Room Commands
//!
//! Tauri commands for managing rooms and room recording.

use crate::audio_recorder::AudioRecorder;
use crate::commands::auth::get_auth_token_async;
use crate::state::RoomState;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

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

/// Start recording for a room with streaming
#[tauri::command]
pub async fn start_room_recording(
    app: AppHandle,
    room_id: String,
    state: State<'_, RoomState>,
) -> Result<(), String> {
    let mut is_recording = state.is_recording.lock().unwrap();
    if *is_recording {
        return Err("Already recording".to_string());
    }

    // Get JWT token for WebSocket authentication
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or("Authentication required")?;

    // Create WebSocket connection
    let mut websocket =
        crate::room_websocket::RoomWebSocket::new(app.clone(), room_id.clone(), auth_token);

    websocket
        .connect()
        .await
        .map_err(|e| format!("Failed to connect WebSocket: {}", e))?;

    // Start audio recorder
    let mut recorder_guard = state.recorder.lock().unwrap();
    let mut recorder = AudioRecorder::new();

    // Create channel for streaming audio data (std::mpsc for audio_recorder)
    let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();

    // Store WebSocket in state first
    *state.websocket.lock().unwrap() = Some(websocket);

    // Spawn task to forward audio chunks from std::mpsc to WebSocket
    let websocket_state = Arc::clone(&state.websocket);

    tokio::spawn(async move {
        loop {
            match rx.recv() {
                Ok(chunk) => {
                    if let Ok(Some(ref ws)) = websocket_state.lock() {
                        if let Err(e) = ws.send_audio_chunk(chunk) {
                            eprintln!("Failed to send audio chunk to WebSocket: {}", e);
                            break;
                        }
                    } else {
                        break;
                    }
                }
                Err(_) => {
                    // Channel closed
                    break;
                }
            }
        }
    });

    recorder
        .start_recording(Some(tx))
        .map_err(|e| format!("Failed to start recording: {}", e))?;

    // Store recorder in state
    *recorder_guard = Some(recorder);
    *is_recording = true;

    Ok(())
}

/// Stop recording (no processing needed here as it was streamed)
#[tauri::command]
pub async fn stop_room_recording_and_process(
    state: State<'_, RoomState>,
    _room_id: String, // unused but kept for compatibility/future
) -> Result<String, String> {
    let mut is_recording = state.is_recording.lock().unwrap();
    if !*is_recording {
        return Err("Not recording".to_string());
    }

    // Close WebSocket connection
    {
        let mut websocket_guard = state.websocket.lock().unwrap();
        if let Some(mut ws) = websocket_guard.take() {
            ws.close();
        }
    }

    // Stop audio recorder
    {
        let mut recorder_guard = state.recorder.lock().unwrap();
        if let Some(mut recorder) = recorder_guard.take() {
            let _ = recorder.stop_recording();
        }
    }

    *is_recording = false;
    Ok("Recording stopped".to_string())
}

/// List user's rooms
#[tauri::command]
pub async fn list_rooms(app: AppHandle) -> Result<Vec<Room>, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or("Authentication required")?;

    let client = reqwest::Client::new();
    let url = format!("{}/api/v1/rooms", crate::config::api_base_url());

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
