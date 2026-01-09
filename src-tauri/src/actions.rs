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
use crate::commands::auth::get_auth_token;
use crate::cursor_context::CursorContext;
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

/// Normalizes text by removing punctuation and normalizing whitespace.
///
/// This helps handle STT errors like:
/// - "hey, lexi" -> "hey lexi"
/// - "hey? lexi" -> "hey lexi"
/// - "hey  lexi" -> "hey lexi"
/// - "heylexi" -> "hey lexi" (handles missing space)
///
/// # Arguments
/// * `text` - The text to normalize
///
/// # Returns
/// * `String` - The normalized text
fn normalize_text(text: &str) -> String {
    let mut normalized = String::new();
    let mut prev_was_alphanumeric = false;

    for ch in text.chars() {
        if ch.is_alphanumeric() {
            normalized.push(ch.to_lowercase().next().unwrap_or(ch));
            prev_was_alphanumeric = true;
        } else if prev_was_alphanumeric {
            // Add space when transitioning from alphanumeric to non-alphanumeric
            normalized.push(' ');
            prev_was_alphanumeric = false;
        }
        // Skip punctuation and whitespace (except we add space when needed)
    }

    normalized.trim().to_string()
}

/// Finds the end position of a trigger phrase in the original text (case-insensitive).
///
/// This searches for the trigger phrase in the original text, handling case variations.
/// It looks for the sequence of characters in order, skipping any non-alphanumeric characters between them.
///
/// # Arguments
/// * `text` - The original transcription text
/// * `trigger_phrase` - The trigger phrase to search for (e.g., "hey lexi")
///
/// # Returns
/// * `Option<usize>` - The byte position after the trigger phrase (and any following punctuation/whitespace) if found, None otherwise
fn find_trigger_end_position(text: &str, trigger_phrase: &str) -> Option<usize> {
    let lowercased = text.to_lowercase();
    let trigger_lower = trigger_phrase.to_lowercase();
    let trigger_chars: Vec<char> = trigger_lower.chars().collect();

    if trigger_chars.is_empty() {
        return None;
    }

    // Collect all alphanumeric characters with their original positions
    let alphanumeric_positions: Vec<(usize, char)> = lowercased
        .char_indices()
        .filter(|(_, ch)| ch.is_alphanumeric())
        .collect();

    // Search for trigger phrase in the alphanumeric sequence
    for window in alphanumeric_positions.windows(trigger_chars.len()) {
        let matches = window
            .iter()
            .zip(trigger_chars.iter())
            .all(|((_, ch), &expected)| *ch == expected);

        if matches {
            // Found trigger phrase, get the position after the last character
            let last_char_pos = window.last().unwrap().0;
            let last_char = window.last().unwrap().1;
            let mut end_pos = last_char_pos + last_char.len_utf8();

            // Skip any punctuation/whitespace after the trigger phrase in the original text
            let remaining = &text[end_pos..];
            for (offset, ch) in remaining.char_indices() {
                if ch.is_alphanumeric() {
                    end_pos += offset;
                    break;
                }
            }

            return Some(end_pos);
        }
    }

    None
}

/// Checks if the transcription starts with any active action trigger phrase.
///
/// This function is robust to STT errors and handles cases like:
/// - "hey lexi" (normal)
/// - "heylexi" (no space)
/// - "hey, lexi" (comma)
/// - "hey? lexi" (question mark)
/// - "Hey Lexi" (capitalization)
///
/// Returns `Some((trigger_phrase, action_command))` if the transcription starts with a trigger,
/// where `trigger_phrase` is the matched trigger and `action_command` is the rest of the transcription after the trigger.
/// Returns `None` if the transcription doesn't start with any trigger.
///
/// Matching is case-insensitive and handles punctuation/whitespace variations.
///
/// # Arguments
/// * `transcription` - The transcription text to check for action triggers
/// * `triggers` - List of active action trigger phrases to check against
///
/// # Example
/// ```
/// use lexi_ai_client::actions::check_action_trigger;
///
/// let triggers = vec!["hey lexi".to_string()];
/// assert_eq!(check_action_trigger("hey lexi summarise this text", &triggers), Some(("hey lexi".to_string(), "summarise this text".to_string())));
/// assert_eq!(check_action_trigger("Hey Lexi do something", &triggers), Some(("hey lexi".to_string(), "do something".to_string())));
/// assert_eq!(check_action_trigger("just some text", &triggers), None);
/// ```
pub fn check_action_trigger(transcription: &str, triggers: &[String]) -> Option<(String, String)> {
    let trimmed = transcription.trim();

    // Normalize the text to handle STT errors (punctuation, spacing, etc.)
    let normalized = normalize_text(trimmed);

    // Check against each trigger phrase
    for trigger_phrase in triggers {
        let trigger_normalized = normalize_text(trigger_phrase);

        // Check if normalized text starts with the normalized trigger
        if normalized.starts_with(&trigger_normalized) {
            // Find where the trigger phrase ends in the original text to extract the command properly
            if let Some(end_pos) = find_trigger_end_position(trimmed, trigger_phrase) {
                let action_command = trimmed[end_pos..].trim().to_string();
                return Some((trigger_phrase.clone(), action_command));
            } else {
                // Fallback: if we can't find exact position (shouldn't happen if normalization worked),
                // try to extract command by finding where normalized trigger ends
                let trigger_len = trigger_normalized.len();
                if normalized.len() > trigger_len {
                    // Count alphanumeric characters to find approximate position
                    let mut alnum_count = 0;
                    let mut target_count = 0;
                    for ch in trigger_normalized.chars() {
                        if ch.is_alphanumeric() {
                            target_count += 1;
                        }
                    }

                    for (pos, ch) in trimmed.char_indices() {
                        if ch.is_alphanumeric() {
                            alnum_count += 1;
                            if alnum_count > target_count {
                                return Some((
                                    trigger_phrase.clone(),
                                    trimmed[pos..].trim().to_string(),
                                ));
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

/// Performs an action based on the action command and returns the action response.
///
/// This function:
/// 1. Gets the current app name from the provided cursor context
/// 2. Captures a fresh screenshot of the current screen
/// 3. Sends the action command, app name, and screenshot to the server
/// 4. Returns the action response with action_type and value
///
/// # Arguments
/// * `action_command` - The action command extracted from the transcription
///                      (e.g., "summarise this text", "do something")
/// * `app_handle` - Tauri AppHandle for accessing state and making API calls
/// * `cursor_context` - Optional cursor context (contains app name and selected text)
///
/// # Returns
/// * `ActionResponse` - The action response with action_type and value
pub async fn perform_action(
    action_command: &str,
    app_handle: &AppHandle,
    cursor_context: Option<&CursorContext>,
) -> ActionResponse {
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

    // Capture screenshot for action
    let base64_image = crate::cursor_context::capture_current_screen();
    if let Some(ref image) = base64_image {
        println!("📸 Screen captured for action (length: {})", image.len());
    } else {
        println!("⚠️  Failed to capture screen for action");
    }

    // Get authentication token from secure storage
    let auth_token = get_auth_token(&app_handle);

    if auth_token.is_none() {
        eprintln!("⚠️  Warning: No authentication token available. Action will fail.");
        // Notify frontend that action processing has completed (with error)
        app_handle
            .emit("action_error", "Authentication required. Please log in.")
            .unwrap_or_default();
        return ActionResponse {
            action_type: "text".to_string(),
            value: "Action failed: Authentication required. Please log in.".to_string(),
        };
    }

    // Send action request to server
    let result = match send_action_request(
        action_command,
        &app_name,
        selected_text,
        base64_image,
        auth_token,
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
            action_response
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
            ActionResponse {
                action_type: "text".to_string(),
                value: error_msg,
            }
        }
    };

    result
}

/// Sends an action request to the Lexi AI Server
///
/// # Arguments
/// * `action_command` - The action command to execute
/// * `app_name` - Name of the currently focused application
/// * `selected_text` - Optional selected text that the action can operate on
/// * `base64_image` - Optional base64-encoded PNG screenshot
/// * `auth_token` - Authentication token for the request
///
/// # Returns
/// * `Ok(ActionResponse)` - The action response from the server
/// * `Err(Box<dyn Error>)` - An error if the API call fails
async fn send_action_request(
    action_command: &str,
    app_name: &str,
    selected_text: Option<String>,
    base64_image: Option<String>,
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

    // Add base64 image if provided
    if let Some(image) = base64_image {
        let image_part = multipart::Part::text(image).mime_str("text/plain")?;
        form = form.part("base64_image", image_part);
    }

    // Build the request URL using centralized endpoint
    let url = action::perform_url();
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
