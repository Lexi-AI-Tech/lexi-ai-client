//! Meeting Commands
//!
//! Tauri commands for managing meetings and meeting recording.

use crate::commands::auth::get_auth_token_async;
use crate::state::MeetingState;
use crate::utils;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

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

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingChatRequest {
    pub content: String,
    pub history: Vec<serde_json::Value>,
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

    let rt_handle =
        tokio::runtime::Handle::try_current().map_err(|_| "No tokio runtime available")?;

    // Start meeting audio: mic + system audio (macOS), mixed and sent to WebSocket for transcription
    let handles = crate::audio::meeting::start_meeting_audio(
        app.clone(),
        websocket.audio_tx.clone(),
        rt_handle,
    )?;

    *state.command_tx.lock().unwrap() = Some(handles.recorder_stop_tx);
    *state.system_stop_tx.lock().unwrap() = handles.system_stop_tx;
    *state.is_recording.lock().unwrap() = true;

    // Disable the tray "Start Meeting" item while recording
    if let Some(ref item) = *state.tray_start_meeting.lock().unwrap() {
        let _ = item.set_enabled(false);
    }

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

        // Stop system audio capture (macOS)
        {
            let mut guard = state.system_stop_tx.lock().unwrap();
            if let Some(tx) = guard.take() {
                let _ = tx.send(());
            }
        }

        *is_recording = false;
    }

    // Re-enable the tray "Start Meeting" item
    if let Some(ref item) = *state.tray_start_meeting.lock().unwrap() {
        let _ = item.set_enabled(true);
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

/// Delete a meeting
#[tauri::command]
pub async fn delete_meeting(app: AppHandle, meeting_id: String) -> Result<(), String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .map_err(|_| "Authentication required")?;

    let client = crate::utils::create_http_client();
    let url = format!("{}/api/v1/meetings/{}", crate::config::api_base_url(), meeting_id);

    utils::log_api_request("Delete meeting", "DELETE", &url);

    let response = client
        .delete(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }

    Ok(())
}

/// Summarize a meeting
#[tauri::command]
pub async fn summarize_meeting(app: AppHandle, meeting_id: String) -> Result<serde_json::Value, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .map_err(|_| "Authentication required")?;

    let client = crate::utils::create_http_client();
    let url = format!("{}/api/v1/meetings/{}/summarize", crate::config::api_base_url(), meeting_id);

    utils::log_api_request("Summarize meeting", "POST", &url);

    let response = client
        .post(&url)
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


/// Send a chat message to a meeting
#[tauri::command]
pub async fn send_meeting_chat(
    app: AppHandle,
    meeting_id: String,
    content: String,
    history: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .map_err(|_| "Authentication required")?;

    let client = crate::utils::create_http_client();
    let url = format!("{}/api/v1/meetings/{}/chat", crate::config::api_base_url(), meeting_id);

    let payload = MeetingChatRequest { content, history };

    utils::log_api_request("Send meeting message", "POST", &url);

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

    let message: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(message)
}
