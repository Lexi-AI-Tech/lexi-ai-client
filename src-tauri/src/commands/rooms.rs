//! Room Commands
//!
//! Tauri commands for managing rooms and room recording.

use crate::audio_recorder::AudioRecorder;
use crate::commands::auth::get_auth_token_async;
use crate::state::RoomState;
use serde::{Deserialize, Serialize};
use std::sync::{mpsc, Mutex};
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
    state: State<'_, RoomState>,
) -> Result<(), String> {
    let mut is_recording = state.is_recording.lock().unwrap();
    if *is_recording {
        return Err("Already recording".to_string());
    }

    let mut recorder_guard = state.recorder.lock().unwrap();
    let mut recorder = AudioRecorder::new();
    
    // Create channel for streaming audio data
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    
    // Spawn a thread to forward chunks to the frontend
    let app_handle = app.clone();
    thread::spawn(move || {
        while let Ok(chunk) = rx.recv() {
            // Emit "audio-chunk" event to frontend
            // Payload is Vec<u8> (serialized as array of numbers in JS)
             if let Err(e) = app_handle.emit("audio-chunk", chunk) {
                 eprintln!("Failed to emit audio chunk: {}", e);
                 break;
             }
        }
        println!("Streaming thread finished");
    });
    
    recorder.start_recording(Some(tx))
        .map_err(|e| format!("Failed to start recording: {}", e))?;
    
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

    {
        let mut recorder_guard = state.recorder.lock().unwrap();
        if let Some(mut recorder) = recorder_guard.take() {
            // Just stop the recorder. We don't need the audio buffer since we streamed it.
            // But we call stop_recording to cleanly close the stream.
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
pub async fn get_room_details(app: AppHandle, room_id: String) -> Result<serde_json::Value, String> {
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
pub async fn finalize_room(
    app: AppHandle,
    room_id: String,
) -> Result<serde_json::Value, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .ok_or("Authentication required")?;

    let client = reqwest::Client::new();
    let url = format!("{}/api/v1/rooms/{}/finalize", crate::config::api_base_url(), room_id);

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
    let url = format!("{}/api/v1/rooms/{}/export", crate::config::api_base_url(), room_id);

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
    let url = format!("{}/api/v1/rooms/{}/speakers", crate::config::api_base_url(), room_id);

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
