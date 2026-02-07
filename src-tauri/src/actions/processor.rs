//! Action Audio Processor
//!
//! Processes recorded action audio: sends to server for transcription and action execution.
//! Handles response by type: inject text only (text), or inject and play streamed TTS (voice).

use crate::actions::service::ActionService;
use crate::commands::auth::get_auth_token_async;
use crate::cursor_context::get_cursor_context;
use crate::text_injector::TextInjector;
use crate::tts_service::TtsService;
use tauri::{AppHandle, Emitter};

/// Process recorded action audio: send to server, then handle response by action type.
pub async fn process_action_audio(audio_data: Vec<u8>, app_handle: AppHandle) {
    println!(
        "🎯 Processing action audio, size: {} bytes",
        audio_data.len()
    );

    app_handle.emit("processing_start", ()).unwrap_or_default();

    let cursor_context = get_cursor_context();

    // Perform the action directly with audio data
    let action_service = ActionService::new();
    match action_service
        .perform_action(Some(audio_data), &app_handle, cursor_context.as_ref())
        .await
    {
        Some(action_response) => {
            println!("✅ Action completed: {:?}", action_response.action_type);

            // Handle the response based on action type
            match action_response.action_type.as_str() {
                "voice" => {
                    println!("🔊 Voice action - injecting text and playing streamed TTS");
                    app_handle.emit("tts_speaking", ()).unwrap_or_default();

                    let injector = TextInjector::new();
                    match injector.inject_text(&action_response.value) {
                        Ok(_) => app_handle.emit("injection_success", ()).unwrap_or_default(),
                        Err(e) => {
                            eprintln!("❌ Text injection failed: {}", e);
                            app_handle
                                .emit("injection_error", e.to_string())
                                .unwrap_or_default();
                        }
                    }

                    let tts_service = TtsService::new(app_handle.clone());
                    let auth_token = get_auth_token_async(&app_handle).await;
                    match auth_token {
                        Some(token) => {
                            match tts_service
                                .play_tts_stream(&action_response.value, &token)
                                .await
                            {
                                Ok(_) => app_handle.emit("tts_success", ()).unwrap_or_default(),
                                Err(e) => {
                                    eprintln!("❌ TTS stream playback failed: {}", e);
                                    app_handle
                                        .emit("tts_error", e.to_string())
                                        .unwrap_or_default();
                                }
                            }
                        }
                        None => {
                            eprintln!("❌ No auth token for TTS stream");
                            app_handle
                                .emit("tts_error", "Authentication required for TTS")
                                .unwrap_or_default();
                        }
                    }
                }
                "text" => {
                    println!("📝 Text action - injecting text");
                    let injector = TextInjector::new();
                    match injector.inject_text(&action_response.value) {
                        Ok(_) => app_handle.emit("injection_success", ()).unwrap_or_default(),
                        Err(e) => {
                            eprintln!("❌ Text injection failed: {}", e);
                            app_handle
                                .emit("injection_error", e.to_string())
                                .unwrap_or_default();
                        }
                    }
                }
                _ => {
                    eprintln!("⚠️  Unknown action type: {}", action_response.action_type);
                    // Fallback to text injection
                    let injector = TextInjector::new();
                    if let Err(e) = injector.inject_text(&action_response.value) {
                        eprintln!("❌ Text injection failed: {}", e);
                    }
                }
            }
        }
        None => {
            println!("❌ Action failed to execute");
            // Errors are already emitted by ActionService
        }
    }
}
