//! Meeting Commands
//!
//! Tauri commands for managing meetings and meeting recording.

use crate::commands::auth::get_auth_token_async;
use crate::state::MeetingState;
use crate::utils;
use serde::{Deserialize, Serialize};
use std::sync::mpsc;
use std::thread;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct Meeting {
    pub id: String,
    pub created_by: String,
    pub updated_by: String,
    pub name: String,
    pub platform: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub transcripts: Option<Vec<MeetingTranscriptSegment>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingTranscriptSegment {
    pub id: String,
    pub segment_index: i32,
    pub start_time: String,
    pub end_time: String,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingCreate {
    pub name: String,
    pub platform: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingUpdate {
    pub name: Option<String>,
}

/// Create a new meeting
#[tauri::command]
pub async fn create_meeting(app: AppHandle, name: String, platform: Option<String>) -> Result<Meeting, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .map_err(|_| "Authentication required")?;

    let client = crate::utils::create_http_client();
    let url = format!("{}/api/v1/meetings", crate::config::api_base_url());

    let payload = MeetingCreate { name, platform };

    utils::log_api_request("Create a new meeting", "POST", &url);

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

    let meeting: Meeting = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(meeting)
}

/// Start recording for a meeting with streaming
#[tauri::command]
pub async fn start_meeting_recording(
    app: AppHandle,
    meeting_id: String,
    state: State<'_, MeetingState>,
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
        .map_err(|_| "Authentication required")?;

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
    let mut websocket = crate::meetings::websocket::MeetingWebSocket::new(
        app.clone(),
        meeting_id.clone(),
        auth_token,
        language_code,
    );

    websocket
        .connect()
        .await
        .map_err(|e| format!("Failed to connect WebSocket: {}", e))?;

    // Wait for server to be ready before starting audio recording
    println!("⏳ Waiting for server ready signal...");
    let ready_rx = {
        let mut ready_rx_guard = websocket.ready_rx.lock().unwrap();
        ready_rx_guard.take()
    };

    if let Some(ready_rx) = ready_rx {
        // Wait for ready signal (with timeout)
        match tokio::time::timeout(tokio::time::Duration::from_secs(10), ready_rx).await {
            Ok(Ok(_)) => {
                println!("✅ Server ready - starting audio recording");
            }
            Ok(Err(_)) => {
                return Err("Server ready channel closed unexpectedly".to_string());
            }
            Err(_) => {
                return Err("Timeout waiting for server ready signal".to_string());
            }
        }
    } else {
        return Err("Ready channel not initialized".to_string());
    }

    // Get the audio_tx from websocket to forward chunks
    let websocket_audio_tx = websocket.audio_tx.clone();

    // Spawn thread to forward audio chunks from std::mpsc to WebSocket's tokio channel
    // Use a blocking runtime handle to send to async channel from sync context
    let rt_handle =
        tokio::runtime::Handle::try_current().map_err(|_| "No tokio runtime available")?;

    thread::spawn(move || {
        while let Ok(chunk) = audio_rx.recv() {
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
    });

    // Start audio recorder in a dedicated thread (AudioRecorder is not Send+Sync)
    let app_for_recorder = app.clone();
    let (recorder_tx, recorder_rx) = mpsc::channel::<()>();

    thread::spawn(move || {
        let mut recorder = crate::audio::recorder::AudioRecorder::new();

        if let Err(e) = recorder.start_recording(Some(audio_tx)) {
            eprintln!("Failed to start recording: {}", e);
            let _ =
                app_for_recorder.emit("meeting-websocket-error", format!("Recording failed: {}", e));
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

    // Note: WebSocket connection is managed by spawned tasks in MeetingWebSocket::connect()
    // It will stay alive as long as the tasks are running

    Ok(())
}

/// Stop recording and finalize the meeting
#[tauri::command]
pub async fn stop_meeting_recording(
    _app: AppHandle,
    state: State<'_, MeetingState>,
    _meeting_id: String,
) -> Result<String, String> {
    {
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
    }

    Ok("Recording stopped".to_string())
}

/// List user's meetings
#[tauri::command]
pub async fn list_meetings(app: AppHandle) -> Result<Vec<Meeting>, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .map_err(|_| "Authentication required")?;

    let client = crate::utils::create_http_client();
    let url = format!("{}/api/v1/meetings", crate::config::api_base_url());

    utils::log_api_request("List user's meetings", "GET", &url);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }

    let meetings: Vec<Meeting> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(meetings)
}

/// Get meeting details
#[tauri::command]
pub async fn get_meeting_details(
    app: AppHandle,
    meeting_id: String,
) -> Result<serde_json::Value, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .map_err(|_| "Authentication required")?;

    let client = crate::utils::create_http_client();
    let url = format!("{}/api/v1/meetings/{}", crate::config::api_base_url(), meeting_id);

    utils::log_api_request("Get meeting details", "GET", &url);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }

    let meeting: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(meeting)
}

/// Update meeting details (e.g. name)
#[tauri::command]
pub async fn update_meeting(
    app: AppHandle,
    meeting_id: String,
    name: Option<String>,
) -> Result<serde_json::Value, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .map_err(|_| "Authentication required")?;

    let client = crate::utils::create_http_client();
    let url = format!("{}/api/v1/meetings/{}", crate::config::api_base_url(), meeting_id);

    let payload = MeetingUpdate { name };

    utils::log_api_request("Update meeting details", "PATCH", &url);

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

    let meeting: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(meeting)
}
