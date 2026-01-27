//! Room Commands
//!
//! Tauri commands for managing rooms and room recording.

use crate::commands::auth::get_auth_token_async;
use crate::state::RoomState;
use crate::utils;
use serde::{Deserialize, Serialize};
use std::sync::mpsc;
use std::thread;
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

/// Start recording for a room with streaming
#[tauri::command]
pub async fn start_room_recording(
    app: AppHandle,
    room_id: String,
    state: State<'_, RoomState>,
) -> Result<(), String> {
    // Check if already recording (drop lock before await)
    {
        let is_recording = state.is_recording.lock().unwrap();
        if *is_recording {
            return Err("Already recording".to_string());
        }
    }

    // Get JWT token for WebSocket authentication
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or("Authentication required")?;

    // Get language from app config
    let app_config = crate::commands::app_config::get_app_config(app.clone())
        .await
        .map_err(|e| format!("Failed to load app config: {}", e))?;
    
    // Get first language from config, default to "auto"
    let language_code = app_config
        .languages
        .and_then(|langs| langs.first().cloned())
        .unwrap_or_else(|| "auto".to_string());

    // Create channel for streaming audio data (std::mpsc for audio_recorder)
    let (audio_tx, audio_rx) = mpsc::channel::<Vec<u8>>();

    // Create WebSocket connection (async) - this will spawn tasks internally
    let mut websocket = crate::room_websocket::RoomWebSocket::new(
        app.clone(),
        room_id.clone(),
        auth_token,
        language_code,
    );

    websocket
        .connect()
        .await
        .map_err(|e| format!("Failed to connect WebSocket: {}", e))?;

    // Get the audio_tx from websocket to forward chunks
    let websocket_audio_tx = websocket.audio_tx.clone();

    // Spawn thread to forward audio chunks from std::mpsc to WebSocket's tokio channel
    // Use a blocking runtime handle to send to async channel from sync context
    let rt_handle =
        tokio::runtime::Handle::try_current().map_err(|_| "No tokio runtime available")?;

    thread::spawn(move || {
        loop {
            match audio_rx.recv() {
                Ok(chunk) => {
                    let guard = websocket_audio_tx.lock().unwrap();
                    if let Some(ref tx) = *guard {
                        // Send to tokio channel using blocking send
                        let tx_clone = tx.clone();
                        if let Err(e) = rt_handle.block_on(tx_clone.send(chunk)) {
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

    // Start audio recorder in a dedicated thread (AudioRecorder is not Send+Sync)
    let app_for_recorder = app.clone();
    let (recorder_tx, recorder_rx) = mpsc::channel::<()>();

    thread::spawn(move || {
        let mut recorder = crate::audio_recorder::AudioRecorder::new();

        if let Err(e) = recorder.start_recording(Some(audio_tx)) {
            eprintln!("Failed to start recording: {}", e);
            let _ =
                app_for_recorder.emit("room-websocket-error", format!("Recording failed: {}", e));
            return;
        }

        // Wait for stop signal
        let _ = recorder_rx.recv();

        // Stop recording
        let _ = recorder.stop_recording();
    });

    // Store stop channel in state (this is Send+Sync)
    *state.command_tx.lock().unwrap() = Some(recorder_tx);
    *state.is_recording.lock().unwrap() = true;

    // Note: WebSocket connection is managed by spawned tasks in RoomWebSocket::connect()
    // It will stay alive as long as the tasks are running

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

    // Send stop signal to recorder thread
    {
        let mut command_tx_guard = state.command_tx.lock().unwrap();
        if let Some(tx) = command_tx_guard.take() {
            let _ = tx.send(());
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
