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
use crate::commands::app_config::get_app_config;
use crate::commands::auth::get_auth_token_async;
use crate::shortcuts::check_command;
use crate::state::TranscriptionTaskState;
use crate::text_injector::TextInjector;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

/// Processes recorded audio data by transcribing it and injecting the result.
///
/// This function uses tokio to spawn async tasks with abort handles for cancellation support.
/// It will cancel any ongoing transcription before starting a new one.
///
/// # Arguments
/// * `audio_data` - The WAV audio data to transcribe
/// * `app_handle` - The Tauri AppHandle for emitting events and accessing state
pub fn process_audio(audio_data: Vec<u8>, app_handle: AppHandle) {
    // Clone app_handle for use in the task and for storing abort handle
    let app_handle_for_task = app_handle.clone();

    // Abort any ongoing transcription task
    if let Some(state) = app_handle.try_state::<TranscriptionTaskState>() {
        if let Ok(mut handle_guard) = state.task_handle.lock() {
            if let Some(handle) = handle_guard.take() {
                println!("🛑 Aborting previous transcription task");
                handle.abort();
            }
        }
    }

    // Spawn a new transcription task using Tauri's async runtime
    // This returns a JoinHandle that we can use to abort the task
    let task = tauri::async_runtime::spawn(async move {
        println!("Processing audio, size: {} bytes", audio_data.len());

        // Notify frontend that transcription has started
        app_handle_for_task
            .emit("processing_start", ())
            .unwrap_or_default();

        // Get authentication token from secure storage (with automatic refresh if needed)
        let auth_token = get_auth_token_async(&app_handle_for_task).await;

        if auth_token.is_none() {
            let error_msg = "User unauthenticated. Please log in.";
            app_handle_for_task
                .emit("error", error_msg)
                .unwrap_or_default();
            return;
        }

        // Get app config for transcription settings
        let app_config = match get_app_config(app_handle_for_task.clone()).await {
            Ok(config) => config,
            Err(e) => {
                let error_msg = format!("Failed to load app config: {}", e);
                app_handle_for_task
                    .emit("error", error_msg.as_str())
                    .unwrap_or_default();
                return;
            }
        };

        // Get first language from languages array
        // Default to "auto" if not set
        let language = app_config
            .languages
            .and_then(|langs| langs.first().cloned())
            .unwrap_or_else(|| "auto".to_string());

        // Get transcription settings from app config
        let enhance_transcription = app_config.enhance_transcription.unwrap_or(false);

        // TODO: Implement this as on demand download feature on paid plans
        // offline_transcription is not in app config, keep as hardcoded for now
        let offline_transcription = false;

        // RESEARCH: Passing certain examples to vocabulary can trick the model into generating the style of transcript.
        // Do more experiment on how we can use this trick to manipulate the model behavior.
        // Get vocabulary from app config
        let vocabulary: Vec<String> = app_config.vocabulary.clone().unwrap_or_default();

        println!(
            "⚙️  Transcription settings: enhance={}, offline={}, vocabulary_size={}",
            enhance_transcription,
            offline_transcription,
            vocabulary.len()
        );

        // Initialize the Assistant service client and transcribe the audio (cursor context is fetched inside transcribe_audio)
        let assistant_service = AssistantService::new();

        let transcription_start = Instant::now();
        let transcription_result = assistant_service
            .transcribe_audio(
                audio_data,
                auth_token,
                language,
                enhance_transcription,
                Some(app_handle_for_task.clone()),
                offline_transcription,
                vocabulary,
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
                app_handle_for_task
                    .emit("transcription_success", &transcription)
                    .unwrap_or_default();

                // Only process if transcription is not empty
                if !transcription.trim().is_empty() {
                    // Check if transcription matches a shortcut command
                    let text_to_inject =
                        check_command(&transcription).unwrap_or_else(|| transcription.clone());

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
                            app_handle_for_task
                                .emit("injection_success", ())
                                .unwrap_or_default();
                        }
                        Err(e) => {
                            eprintln!("Failed to inject text: {}", e);
                            // Notify frontend of injection failure
                            app_handle_for_task
                                .emit("injection_error", e.to_string())
                                .unwrap_or_default();
                        }
                    }
                }
            }
            Err(e) => {
                // Check if this is a cancellation error
                let error_msg = e.to_string();
                if error_msg.contains("cancelled") || error_msg.contains("aborted") {
                    println!(
                        "🛑 Transcription was cancelled after {:.2}s",
                        transcription_duration.as_secs_f64()
                    );
                    // Don't emit error event for cancellation - it's expected
                    return;
                }

                eprintln!(
                    "❌ Transcription failed after {:.2}s: {}",
                    transcription_duration.as_secs_f64(),
                    e
                );
                // Notify frontend of transcription failure
                app_handle_for_task
                    .emit("transcription_error", error_msg)
                    .unwrap_or_default();
            }
        }
    });

    // Store the task handle in state for future cancellation
    if let Some(state) = app_handle.try_state::<TranscriptionTaskState>() {
        if let Ok(mut handle_guard) = state.task_handle.lock() {
            *handle_guard = Some(task);
        }
    }
}
