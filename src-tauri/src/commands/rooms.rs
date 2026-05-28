//! Rooms Commands
//!
//! Tauri commands for managing rooms and room recording/streaming.

use crate::commands::auth::get_auth_token_async;
use crate::state::RoomState;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct RoomTranscriptSegment {
    pub id: String,
    pub segment_index: i32,
    pub start_time: String,
    pub end_time: String,
    pub speaker_label: String,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Room {
    pub id: String,
    pub created_by: String,
    pub updated_by: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub speaker_map: Option<serde_json::Value>,
    #[serde(default)]
    pub transcripts: Option<Vec<RoomTranscriptSegment>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateRoomRequest {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateRoomRequest {
    pub name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SpeakerUpdateRequest {
    pub speaker_map: serde_json::Value,
}

/// Create a new room
#[tauri::command]
pub async fn create_room(app: AppHandle, name: String) -> Result<Room, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .map_err(|_| "Authentication required")?;

    let url = format!("{}/api/v1/rooms", crate::config::api_base_url());
    let client = crate::utils::create_http_client();

    let payload = CreateRoomRequest { name };
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
    response
        .json::<Room>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

/// List rooms for current user
#[tauri::command]
pub async fn list_rooms(app: AppHandle) -> Result<Vec<Room>, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .map_err(|_| "Authentication required")?;

    let url = format!("{}/api/v1/rooms", crate::config::api_base_url());
    let client = crate::utils::create_http_client();
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }
    response
        .json::<Vec<Room>>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

/// Get room details (including transcripts)
#[tauri::command]
pub async fn get_room_details(app: AppHandle, room_id: String) -> Result<Room, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .map_err(|_| "Authentication required")?;

    let url = format!(
        "{}/api/v1/rooms/{}",
        crate::config::api_base_url(),
        room_id
    );
    let client = crate::utils::create_http_client();
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }
    response
        .json::<Room>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

/// Update room fields
#[tauri::command]
pub async fn update_room(
    app: AppHandle,
    room_id: String,
    name: Option<String>,
) -> Result<Room, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .map_err(|_| "Authentication required")?;

    let url = format!(
        "{}/api/v1/rooms/{}",
        crate::config::api_base_url(),
        room_id
    );
    let client = crate::utils::create_http_client();
    let payload = UpdateRoomRequest { name };
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
    response
        .json::<Room>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

/// Update speaker names mapping
#[tauri::command]
pub async fn update_speaker(
    app: AppHandle,
    room_id: String,
    speaker_map: serde_json::Value,
) -> Result<Room, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .map_err(|_| "Authentication required")?;

    let url = format!(
        "{}/api/v1/rooms/{}/speakers",
        crate::config::api_base_url(),
        room_id
    );
    let client = crate::utils::create_http_client();
    let payload = SpeakerUpdateRequest { speaker_map };
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
    response
        .json::<Room>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

/// Start room recording: connects WebSocket + streams mic audio.
#[tauri::command]
pub async fn start_room_recording(
    app: AppHandle,
    room_id: String,
    state: State<'_, RoomState>,
) -> Result<(), String> {
    {
        let is_recording = state.is_recording.lock().unwrap();
        if *is_recording {
            return Err("Already recording".to_string());
        }
    }

    let auth_token = get_auth_token_async(&app)
        .await
        .map_err(|_| "Authentication required")?;

    // Connect room WS
    let language_code = crate::commands::app_config::get_primary_language_from_store(&app);
    let mut websocket =
        crate::room_websocket::RoomWebSocket::new(app.clone(), room_id.clone(), auth_token, language_code);
    websocket
        .connect()
        .await
        .map_err(|e| format!("Failed to connect WebSocket: {}", e))?;

    // Wait for server ready
    let ready_rx = { websocket.ready_rx.lock().unwrap().take() };
    if let Some(ready_rx) = ready_rx {
        tokio::time::timeout(tokio::time::Duration::from_secs(10), ready_rx)
            .await
            .map_err(|_| "Timeout waiting for server ready signal".to_string())?
            .map_err(|_| "Server ready channel closed unexpectedly".to_string())?;
    } else {
        return Err("Ready channel not initialized".to_string());
    }

    let ws_audio_tx = websocket
        .audio_tx
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "WebSocket audio channel not initialized".to_string())?;

    // Audio recorder thread (mic only)
    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    *state.command_tx.lock().unwrap() = Some(stop_tx);

    let app_for_thread = app.clone();
    std::thread::spawn(move || {
        let mut rec = crate::audio::recorder::AudioRecorder::new();
        let tx_clone = ws_audio_tx.clone();
        // Bridge cpal callback -> tokio mpsc sender via blocking_send
        let (pcm_tx, pcm_rx) = std::sync::mpsc::channel::<Vec<u8>>();
        if rec.start_recording(Some(pcm_tx)).is_err() {
            let _ = app_for_thread.emit("room-recording-error", "Failed to start microphone");
            return;
        }
        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }
            match pcm_rx.recv_timeout(std::time::Duration::from_millis(50)) {
                Ok(chunk) => {
                    let _ = tx_clone.blocking_send(chunk);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => break,
            }
        }
        rec.release_stream();
    });

    *state.is_recording.lock().unwrap() = true;
    let _ = app.emit(
        "room-recording-started",
        serde_json::json!({ "roomId": room_id }),
    );
    Ok(())
}

/// Stop room recording (best-effort).
#[tauri::command]
pub async fn stop_room_recording_and_process(
    app: AppHandle,
    state: State<'_, RoomState>,
) -> Result<(), String> {
    let stop_tx = { state.command_tx.lock().unwrap().take() };
    if let Some(tx) = stop_tx {
        let _ = tx.send(());
    }
    *state.is_recording.lock().unwrap() = false;
    let _ = app.emit("room-recording-stopped", ());
    Ok(())
}

