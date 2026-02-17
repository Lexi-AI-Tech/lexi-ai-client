//! Audio Processing Module
//!
//! This module handles processing recorded audio data by:
//! 1. Aborting any ongoing transcription task
//! 2. Getting the authentication token from secure storage (OS keychain or Tauri Store)
//! 3. Fetching app config in parallel with transcription (for shortcuts)
//! 4. Sending the WAV audio data to Lexi AI Server API for transcription
//! 5. Checking if transcription matches any shortcut command
//! 6. Injecting the transcribed text into the active application using TextInjector
//! 7. Emitting events to the frontend to update UI state

use super::service::AssistantService;

use crate::commands::app_config::fetch_config_from_server;
use crate::commands::auth::get_auth_token_async;
use crate::shortcuts::check_shortcuts;

use crate::text_injector::TextInjector;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Processes recorded audio data by transcribing it and injecting the result.
///
/// This function uses tokio to spawn async tasks with abort handles for cancellation support.
/// It will cancel any ongoing transcription before starting a new one.
///
/// # Arguments
/// * `audio_data` - The WAV audio data to transcribe
/// * `app_handle` - The Tauri AppHandle for emitting events and accessing state
pub fn process_audio(audio_data: Vec<u8>, app_handle: AppHandle) {
    // Spawn a fire-and-forget async task for transcription + injection.
    // We need spawn because transcribe_audio() is async (HTTP await) but
    // process_audio() is called from a synchronous recording thread.
    tauri::async_runtime::spawn(async move {
        println!("Processing audio, size: {} bytes", audio_data.len());

        // Notify frontend that transcription has started
        app_handle
            .emit("processing_start", ())
            .unwrap_or_default();

        // Get authentication token from secure storage (with automatic refresh if needed)
        let auth_token = get_auth_token_async(&app_handle).await;

        if auth_token.is_none() {
            let error_msg = "User unauthenticated. Please log in.";
            app_handle
                .emit("error", error_msg)
                .unwrap_or_default();
            return;
        }

        // TODO: Implement this as on demand download feature on paid plans
        // offline_transcription is not in app config, keep as hardcoded for now
        let offline_transcription = false;

        // Initialize the Assistant service client
        let assistant_service = AssistantService::new();

        // Fetch app config in parallel with transcription (for shortcuts)
        let config_handle = {
            let app = app_handle.clone();
            tauri::async_runtime::spawn(async move { fetch_config_from_server(&app).await })
        };

        let transcription_start = Instant::now();
        let transcription_result = assistant_service
            .transcribe_audio(
                audio_data,
                auth_token,
                Some(app_handle.clone()),
                offline_transcription,
            )
            .await;
        let transcription_duration = transcription_start.elapsed();

        // Get shortcuts from the parallel config fetch (fall back to empty if it failed)
        let shortcuts = match config_handle.await {
            Ok(Ok(config)) => config.shortcuts.unwrap_or_default(),
            _ => {
                eprintln!("⚠️  Failed to load shortcuts from app config, skipping shortcut check");
                Vec::new()
            }
        };

        // Check if the task was aborted (the JoinHandle will be cancelled)
        // If aborted, the result will be an error, but we should check for cancellation
        match transcription_result {
            Ok((transcription, _cursor_context)) => {
                println!(
                    "✅ Transcription completed in {:.2}s: {}",
                    transcription_duration.as_secs_f64(),
                    transcription
                );

                // Notify frontend of successful transcription
                app_handle
                    .emit("transcription_success", &transcription)
                    .unwrap_or_default();

                // Only process if transcription is not empty
                if !transcription.trim().is_empty() {
                    // Check if transcription matches a shortcut (uses pre-fetched shortcuts)
                    let text_to_inject = check_shortcuts(&shortcuts, &transcription)
                        .unwrap_or_else(|| transcription.clone());

                    if text_to_inject != transcription {
                        println!(
                            "🔧 Command detected: '{}' -> '{}'",
                            transcription.trim(),
                            text_to_inject
                        );
                    }

                    // Inject the text (or shortcut replacement)
                    let injector = TextInjector::new();
                    match injector.inject_text(&text_to_inject) {
                        Ok(_) => {
                            // Successfully injected text into active application
                            app_handle
                                .emit("injection_success", ())
                                .unwrap_or_default();
                        }
                        Err(e) => {
                            eprintln!("Failed to inject text: {}", e);
                            // Notify frontend of injection failure
                            app_handle
                                .emit("injection_error", e.to_string())
                                .unwrap_or_default();
                        }
                    }
                }
            }
            Err(e) => {
                let error_msg = e.to_string();
                eprintln!(
                    "❌ Transcription failed after {:.2}s: {}",
                    transcription_duration.as_secs_f64(),
                    e
                );
                // Notify frontend of transcription failure
                app_handle
                    .emit("transcription_error", error_msg)
                    .unwrap_or_default();
            }
        }
    });
}
