//! Actions Module
//!
//! This module handles voice actions triggered by action trigger phrases from app config.
//! When a transcription starts with any active action trigger, instead of
//! injecting the transcription directly, it processes the action and injects the result.
//!
//! ## Implementation
//!
//! - **Action Triggers**: Fetched from app config (server-managed)
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

/// Action response from the server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionResponse {
    pub action_type: String,
    pub value: String,
}

/// Performs an action based on the action command and returns the action response.
///
/// This function:
/// 1. Gets the current app name from the provided cursor context
/// 2. Gets the selected text from the cursor context (if available)
/// 3. Sends the action command, app name, and selected text to the server
/// 4. Returns the action response with action_type and value
///
/// # Arguments
/// * `action_command` - The action command extracted from the transcription
///                      (e.g., "summarise this text", "do something")
/// * `app_handle` - Tauri AppHandle for accessing state and making API calls
/// * `cursor_context` - Optional cursor context (contains app name and selected text)
///
/// # Returns
/// * `Option<ActionResponse>` - The action response with action_type and value, or None if the action failed
pub async fn perform_action(
    action_command: &str,
    app_handle: &AppHandle,
    cursor_context: Option<&CursorContext>,
) -> Option<ActionResponse> {
    let action_start = Instant::now();
    println!("🎯 Performing action: '{}'", action_command);

    // Notify frontend that action processing has started
    app_handle.emit("processing_start", ()).unwrap_or_default();

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
    let auth_token = get_auth_token_async(&app_handle).await;

    if auth_token.is_none() {
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
    match send_action_request(action_command, &app_name, selected_text, auth_token).await {
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
///
/// # Arguments
/// * `action_command` - The action command to execute
/// * `app_name` - Name of the currently focused application
/// * `selected_text` - Optional selected text that the action can operate on
/// * `auth_token` - Authentication token for the request
///
/// # Returns
/// * `Ok(ActionResponse)` - The action response from the server
/// * `Err(Box<dyn Error>)` - An error if the API call fails
async fn send_action_request(
    action_command: &str,
    app_name: &str,
    selected_text: Option<String>,
    auth_token: Option<String>,
) -> Result<ActionResponse, Box<dyn Error>> {
    let client = reqwest::Client::new();

    // Build multipart form
    let mut form = multipart::Form::new()
        .text("action_command", action_command.to_string())
        .text("app_name", app_name.to_string());

    // Add selected text if provided
    if let Some(text) = selected_text {
        form = form.text("selected_text", text);
    }

    // Build the request URL using centralized endpoint
    let url = action::perform_url();
    utils::log_api_request("Perform voice action", "POST", &url);
    let mut request = client.post(&url).multipart(form);

    // Add authorization header if token is provided
    if let Some(token) = &auth_token {
        request = request.header("Authorization", format!("Bearer {}", token));
    } else {
        return Err("Authentication required".into());
    }

    // Send the request
    let res = request.send().await?;
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
