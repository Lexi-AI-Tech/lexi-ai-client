//! Meeting Commands
//!
//! Tauri commands for managing meetings and meeting recording.

use crate::commands::auth::get_auth_token_async;
use crate::state::MeetingState;
use crate::utils;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

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

    // Create WebSocket connection (async) - language is resolved from app config on the server
    let mut websocket = crate::meetings::websocket::MeetingWebSocket::new(
        app.clone(),
        meeting_id.clone(),
        auth_token,
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
    if let Some(tx) = websocket.text_tx.lock().unwrap().take() {
        *state.meeting_ws_text_tx.lock().unwrap() = Some(tx);
    }
    *state.is_recording.lock().unwrap() = true;

    // Broadcast so key listener disables assistant/action hotkeys while meeting is running
    if let Ok(tx) = state.meeting_recording_tx.lock() {
        let _ = tx.send(true);
    }

    // Hide pill overlay so it doesn't show during meeting recording
    if let Some(pill_window) = app.get_webview_window("pill") {
        let _ = pill_window.hide();
    }

    // Update tray to "Stop Meeting" while recording
    if let Some(ref item) = *state.tray_start_meeting.lock().unwrap() {
        let _ = item.set_text("Stop Meeting");
    }

    // Note: WebSocket connection is managed by spawned tasks in MeetingWebSocket::connect()
    // It will stay alive as long as the tasks are running

    Ok(())
}

/// Stop recording and finalize the meeting
#[tauri::command]
pub async fn stop_meeting_recording(
    app: AppHandle,
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

    // Send end event so Lexi AI server can finalize and close the stream (no reliance on timeout)
    let ws_tx = state.meeting_ws_text_tx.lock().unwrap().take();
    if let Some(tx) = ws_tx {
        let _ = tx
            .send(r#"{"type":"end_recording"}"#.to_string())
            .await;
    }

    // Broadcast so key listener re-enables assistant/action hotkeys
    if let Ok(tx) = state.meeting_recording_tx.lock() {
        let _ = tx.send(false);
    }

    // Show pill overlay again
    if let Some(pill_window) = app.get_webview_window("pill") {
        let _ = pill_window.show();
    }

    // Restore tray to "Start Meeting"
    if let Some(ref item) = *state.tray_start_meeting.lock().unwrap() {
        let _ = item.set_text("Start Meeting");
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


/// Add a user note to the meeting transcript (typed during the meeting).
#[tauri::command]
pub async fn add_meeting_note(
    app: AppHandle,
    meeting_id: String,
    text: String,
) -> Result<serde_json::Value, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .map_err(|_| "Authentication required")?;

    let client = crate::utils::create_http_client();
    let url = format!(
        "{}/api/v1/meetings/{}/notes",
        crate::config::api_base_url(),
        meeting_id
    );

    let body = serde_json::json!({ "text": text.trim() });
    if text.trim().is_empty() {
        return Err("Note text is required".to_string());
    }

    utils::log_api_request("Add meeting note", "POST", &url);

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server error: {}", response.status()));
    }

    let segment: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(segment)
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
