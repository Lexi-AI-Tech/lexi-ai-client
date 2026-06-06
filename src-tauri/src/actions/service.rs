//! Actions Module
//!
//! This module handles voice actions triggered by action trigger phrases from app config.
//! When a transcription starts with any active action trigger, instead of
//! injecting the transcription directly, it processes the action and injects the result.
//!
//! ## Implementation
//!
//! - **Action Triggers**: Triggered via configured hotkeys
//! - **Action Processing**: Extracts the action command from the transcription and
//!   calls `perform_action` to get the result text to inject
//! - **Text Injection**: The result from `perform_action` is injected instead of the
//!   original transcription

use crate::api_endpoints::action;
use crate::commands::auth::get_auth_token_async;
use crate::cursor_context::CursorContext;
use crate::utils;
use reqwest::multipart;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Action response from the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionResponse {
    pub action_type: String,
    /// Result text (for text actions; empty for voice when server returns audio).
    #[serde(default)]
    pub value: String,
    /// Base64-encoded MP3 for voice actions (server runs TTS; key in JSON is "audio").
    #[serde(default, alias = "audio")]
    pub audio_base64: Option<String>,
}

/// Action Service client for performing actions using Lexi AI Server
///
/// This struct manages HTTP requests to the Lexi AI Server endpoint for action execution.
pub struct ActionService {
    client: reqwest::Client, // HTTP client for making API requests
}

impl ActionService {
    /// Creates a new ActionService instance
    ///
    /// Initializes the HTTP client.
    pub fn new() -> Self {
        Self {
            client: crate::utils::create_http_client(),
        }
    }

    /// Sends audio and context to server; returns action_type, value, and optional audio (base64).
    pub async fn perform_action(
        &self,
        audio_data: Option<Vec<u8>>,
        app_handle: &AppHandle,
        cursor_context: Option<&CursorContext>,
        language: String,
        vocabulary: Vec<String>,
    ) -> Option<ActionResponse> {
        let action_start = Instant::now();

        println!(
            "🎯 Performing voice action (audio size: {} bytes)",
            audio_data.as_ref().map(|d| d.len()).unwrap_or(0)
        );

        // Get app name from cursor context
        let app_name = cursor_context
            .and_then(|ctx| ctx.app_name.clone())
            .unwrap_or_else(|| "Unknown".to_string());
        println!("📱 Current app: {}", app_name);

        // Get selected text from cursor context
        let selected_text = cursor_context.and_then(|ctx| ctx.selected_text.clone());
        if let Some(ref text) = selected_text {
            println!("📝 Selected text: {}", text);
        } else {
            println!("📝 No text selected");
        }

        // Get authentication token from secure storage (with automatic refresh if needed)
        let auth_token = get_auth_token_async(app_handle).await;

        if auth_token.is_err() {
            let error_msg = "Authentication required. Please log in.";
            eprintln!("⚠️  Warning: No authentication token available. Action will fail.");
            let action_duration = action_start.elapsed();
            eprintln!(
                "❌ Action failed after {:.2}s: {}",
                action_duration.as_secs_f64(),
                error_msg
            );
            // Notify frontend that action processing has completed (with error)
            app_handle
                .emit("action_error", error_msg)
                .unwrap_or_default();
            // Return None to indicate failure
            return None;
        }

        // Send action request to server
        match self
            .send_action_request(
                app_handle,
                audio_data,
                &app_name,
                selected_text,
                auth_token,
                &language,
                &vocabulary,
            )
            .await
        {
            Ok(action_response) => {
                let action_duration = action_start.elapsed();
                println!(
                    "✅ Action completed in {:.2}s - type: {}",
                    action_duration.as_secs_f64(),
                    action_response.action_type
                );
                // Notify frontend that action processing has completed successfully
                app_handle
                    .emit("action_success", &action_response.value)
                    .unwrap_or_default();
                Some(action_response)
            }
            Err(e) => {
                let action_duration = action_start.elapsed();
                let error_msg = format!("Action failed: {}", e);
                eprintln!(
                    "❌ Action failed after {:.2}s: {}",
                    action_duration.as_secs_f64(),
                    e
                );
                // Notify frontend that action processing has completed (with error)
                app_handle
                    .emit("action_error", error_msg.as_str())
                    .unwrap_or_default();
                // Return None to indicate failure
                None
            }
        }
    }

    /// Sends an action request to the Lexi AI Server
    async fn send_action_request(
        &self,
        app_handle: &AppHandle,
        audio_data: Option<Vec<u8>>,
        app_name: &str,
        selected_text: Option<String>,
        auth_token: Result<String, String>,
        language: &str,
        vocabulary: &[String],
    ) -> Result<ActionResponse, Box<dyn Error>> {
        let mut form = multipart::Form::new()
            .text("app_name", app_name.to_string())
            .text("language", language.to_string())
            .text("vocabulary", serde_json::to_string(vocabulary)?);

        // Add audio file if provided
        if let Some(data) = audio_data {
            let part = multipart::Part::bytes(data)
                .file_name("action.wav")
                .mime_str("audio/wav")?;
            form = form.part("audio_file", part);
        }

        // Add selected text if provided
        if let Some(text) = selected_text {
            form = form.text("selected_text", text);
        }

        // Build the request URL using centralized endpoint
        let url = action::perform_url();
        utils::log_api_request("POST", &url);
        let mut request = self.client.post(&url).multipart(form);

        // Add authorization header if token is provided
        if let Ok(token) = &auth_token {
            request = request.header("Authorization", format!("Bearer {}", token));
        } else {
            return Err("Authentication required".into());
        }
        request = utils::apply_feature_usage_header(app_handle, request);

        // Send the request
        let res = request.send().await?;
        utils::capture_feature_usage_header(app_handle, &res);
        let status = res.status();

        if !status.is_success() {
            let error_text = res
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!("Server error ({}): {}", status, error_text).into());
        }

        // Read response as JSON
        let action_response: ActionResponse = res.json().await?;
        Ok(action_response)
    }
}
