//! Audio Processing Module
//!
//! This module handles processing recorded audio data by:
//! 1. Aborting any ongoing transcription task
//! 2. Getting the authentication token from secure storage (OS keychain or Tauri Store)
//! 3. Getting the language preference from Tauri Store (persistent storage)
//! 4. Sending the WAV audio data to Lexi AI Server API for transcription
//! 5. Injecting the transcribed text into the active application using TextInjector
//! 6. Emitting events to the frontend to update UI state

use super::service::AssistantService;

use crate::commands::auth::get_auth_token_async;
use crate::shortcuts::check_command;

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
    let app_handle_for_task = app_handle.clone();

    // Spawn a new transcription task using Tauri's async runtime
    // This returns a JoinHandle that we can use to abort the task
    let _task = tauri::async_runtime::spawn(async move {
        println!("Processing audio, size: {} bytes", audio_data.len());

        // Notify frontend that transcription has started
        let app_handle_emit = app_handle_for_task.clone();
        tauri::async_runtime::spawn(async move {
            app_handle_emit
                .emit("processing_start", ())
                .unwrap_or_default();
        });

        // Get authentication token from secure storage (with automatic refresh if needed)
        let auth_token = get_auth_token_async(&app_handle_for_task).await;

        if auth_token.is_err() {
            let app_handle_emit = app_handle_for_task.clone();
            tauri::async_runtime::spawn(async move {
                app_handle_emit
                    .emit("error", "User unauthenticated. Please log in.")
                    .unwrap_or_default();
            });
            return;
        }

        // TODO: Implement this as on demand download feature on paid plans
        // offline_transcription is not in app config, keep as hardcoded for now
        let offline_transcription = false;

        // Initialize the Assistant service client and transcribe the audio (cursor context is fetched inside transcribe_audio)
        let assistant_service = AssistantService::new();

        let transcription_start = Instant::now();
        let transcription_result = assistant_service
            .transcribe_audio(
                audio_data,
                auth_token,
                Some(app_handle_for_task.clone()),
                offline_transcription,
            )
            .await;
        let transcription_duration = transcription_start.elapsed();

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
                let app_handle_emit = app_handle_for_task.clone();
                let transcription_clone = transcription.clone();
                tauri::async_runtime::spawn(async move {
                    app_handle_emit
                        .emit("transcription_success", &transcription_clone)
                        .unwrap_or_default();
                });

                // Only process if transcription is not empty
                if !transcription.trim().is_empty() {
                    // Check if transcription matches a shortcut command (from app config)
                    let text_to_inject = check_command(&app_handle_for_task, &transcription)
                        .await
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
                            let app_handle_emit = app_handle_for_task.clone();
                            tauri::async_runtime::spawn(async move {
                                app_handle_emit
                                    .emit("injection_success", ())
                                    .unwrap_or_default();
                            });
                        }
                        Err(e) => {
                            eprintln!("Failed to inject text: {}", e);
                            // Notify frontend of injection failure
                            let app_handle_emit = app_handle_for_task.clone();
                            let error_msg = e.to_string();
                            tauri::async_runtime::spawn(async move {
                                app_handle_emit
                                    .emit("injection_error", error_msg)
                                    .unwrap_or_default();
                            });
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
                let app_handle_emit = app_handle_for_task.clone();
                tauri::async_runtime::spawn(async move {
                    app_handle_emit
                        .emit("transcription_error", error_msg)
                        .unwrap_or_default();
                });
            }
        }
    });
}

/// Processes recorded audio for the Docs feature: transcribes only and emits
/// `doc_transcription_ready` with the transcript text (no injection).
pub fn process_audio_for_doc(audio_data: Vec<u8>, app_handle: AppHandle) {
    let app_handle_for_task = app_handle.clone();

    let _task = tauri::async_runtime::spawn(async move {
        let auth_token = get_auth_token_async(&app_handle_for_task).await;
        if auth_token.is_err() {
            let _ = app_handle_for_task.emit("doc_transcription_error", "Authentication required");
            return;
        }

        let assistant_service = AssistantService::new();
        let offline_transcription = false;
        let transcription_result = assistant_service
            .transcribe_audio(
                audio_data,
                auth_token,
                Some(app_handle_for_task.clone()),
                offline_transcription,
            )
            .await;

        match transcription_result {
            Ok((transcription, _)) => {
                let _ = app_handle_for_task.emit("doc_transcription_ready", &transcription);
            }
            Err(e) => {
                let _ = app_handle_for_task.emit("doc_transcription_error", e.to_string());
            }
        }
    });
}
