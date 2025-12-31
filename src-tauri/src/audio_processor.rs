//! Audio Processing Module
//!
//! This module handles processing recorded audio data by:
//! 1. Aborting any ongoing transcription task
//! 2. Getting the authentication token from AuthTokenState
//! 3. Sending the WAV audio data to Lexi AI Server API for transcription
//! 4. Injecting the transcribed text into the active application using TextInjector
//! 5. Emitting events to the frontend to update UI state

use crate::commands::auth::get_auth_token;
use crate::commands::config::get_language;
use crate::state::{AuthTokenState, LanguageState, TranscriptionTaskState};
use crate::stt_service::SttService;
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

    // Create cancellation channel for this request
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();

    // Abort any ongoing transcription task and send cancellation signal
    if let Some(state) = app_handle.try_state::<TranscriptionTaskState>() {
        if let Ok(mut handle_guard) = state.task_handle.lock() {
            if let Some(handle) = handle_guard.take() {
                println!("🛑 Aborting previous transcription task");
                handle.abort();
            }
        }
        // Send cancellation signal to cancel the HTTP request
        if let Ok(mut cancel_guard) = state.cancel_tx.lock() {
            if let Some(old_cancel_tx) = cancel_guard.take() {
                let _ = old_cancel_tx.send(());
                println!("🛑 Sent cancellation signal to previous HTTP request");
            }
        }
        // Store the new cancellation sender
        if let Ok(mut cancel_guard) = state.cancel_tx.lock() {
            *cancel_guard = Some(cancel_tx);
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

        // Get authentication token from state
        let auth_token = if let Some(state) = app_handle_for_task.try_state::<AuthTokenState>() {
            get_auth_token(&state)
        } else {
            None
        };

        if auth_token.is_none() {
            eprintln!(
                "⚠️  Warning: No authentication token available. Transcription will fail with 401."
            );
            eprintln!("💡 Tip: Make sure you're logged in and the frontend has synced the token using set_auth_token");
        } else {
            println!(
                "✅ Auth token available (length: {})",
                auth_token.as_ref().unwrap().len()
            );
        }

        // Get language from state, default to "auto" if not set
        let language = if let Some(state) = app_handle_for_task.try_state::<LanguageState>() {
            get_language(&state).unwrap_or_else(|| "auto".to_string())
        } else {
            "auto".to_string()
        };
        println!("🌐 Using language: {}", language);

        // TODO: Get enhance_transcription, transcribe_with_cursor_context, offline_transcription from app config state
        let enhance_transcription = false;
        let transcribe_with_cursor_context = false;
        let offline_transcription = true;

        // Hardcoded vocabulary array for offline transcription
        // TODO: Get vocabulary from app config state
        // RESEARCH: Passing certain examples to vocabulary can trick the model into generating the style of transcript.
        // Do more experiment on how we can use this trick to manipulate the model behavior.
        let vocabulary = vec![
            "Lexi".to_string(),
            "anadi".to_string(),
            "Ranjeet Baraik".to_string(),
        ];

        // Get cursor context to extract focused app name
        let cursor_context = crate::cursor_context::get_cursor_context();
        let focused_app = cursor_context
            .and_then(|ctx| ctx.app_name)
            .unwrap_or_else(|| "Unknown".to_string());
        println!("📱 Focused app: {}", focused_app);

        // Capture screen and encode as base64 only if transcribe_with_cursor_context is true
        let base64_image = if transcribe_with_cursor_context {
            let captured_image = crate::cursor_context::capture_current_screen();
            if let Some(ref image) = captured_image {
                println!(
                    "📸 Screen captured for transcription (length: {})",
                    image.len()
                );
            } else {
                println!("⚠️  Failed to capture screen for transcription");
            }
            captured_image
        } else {
            None
        };

        // Initialize the STT service client and transcribe the audio
        // The cancellation receiver is passed to the service to allow cancelling the HTTP request
        let stt_service = SttService::new();

        let transcription_start = Instant::now();
        let transcription_result = stt_service
            .transcribe_audio(
                audio_data,
                auth_token,
                language,
                enhance_transcription,
                transcribe_with_cursor_context,
                focused_app,
                base64_image,
                Some(cancel_rx),
                Some(app_handle_for_task.clone()),
                offline_transcription,
                vocabulary,
            )
            .await;
        let transcription_duration = transcription_start.elapsed();

        // Check if the task was aborted (the JoinHandle will be cancelled)
        // If aborted, the result will be an error, but we should check for cancellation
        match transcription_result {
            Ok(transcription) => {
                println!(
                    "✅ Transcription completed in {:.2}s: {}",
                    transcription_duration.as_secs_f64(),
                    transcription
                );

                // Notify frontend of successful transcription
                app_handle_for_task
                    .emit("transcription_success", &transcription)
                    .unwrap_or_default();

                // Only inject text if transcription is not empty
                if !transcription.trim().is_empty() {
                    let injector = TextInjector::new();
                    match injector.inject_text(&transcription) {
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
