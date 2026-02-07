//! Action Audio Processor Logic
//!
//! This module contains the logic to process recorded audio for actions.
//! It handles transcription, action execution, and response handling (TTS/Injection).

use crate::actions::service::ActionService;

use crate::commands::auth::get_auth_token_async;
use crate::cursor_context::get_cursor_context;
use tauri::{AppHandle, Emitter};

use crate::text_injector::TextInjector;
use crate::tts_service::TtsService;

/// Process action audio by transcribing it and executing the action
pub async fn process_action_audio(audio_data: Vec<u8>, app_handle: AppHandle) {
    println!(
        "🎯 Processing action audio, size: {} bytes",
        audio_data.len()
    );

    // Notify frontend that action processing has started
    app_handle.emit("processing_start", ()).unwrap_or_default();

    // Get authentication token
    let auth_token = get_auth_token_async(&app_handle).await;
    if auth_token.is_none() {
        let error_msg = "Authentication required for actions. Please log in.";
        app_handle.emit("error", error_msg).unwrap_or_default();
        return;
    }

    // Get cursor context
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
                    // Play audio from single-trip response if present, else fall back to TTS API
                    println!("🔊 Voice action - reading text");
                    app_handle.emit("tts_speaking", ()).unwrap_or_default();
                    let tts_service = TtsService::new(app_handle.clone());
                    let played = if let Some(ref b64) = action_response.audio_base64 {
                        tts_service.play_audio_base64(b64)
                    } else {
                        tts_service.speak(&action_response.value, None).await
                    };
                    match played {
                        Ok(_) => {
                            app_handle.emit("tts_success", ()).unwrap_or_default();
                        }
                        Err(e) => {
                            eprintln!("❌ TTS/playback failed: {}", e);
                            app_handle
                                .emit("tts_error", e.to_string())
                                .unwrap_or_default();
                        }
                    }
                }
                "text" => {
                    // Inject text
                    println!("📝 Text action - injecting text");
                    let injector = TextInjector::new();
                    match injector.inject_text(&action_response.value) {
                        Ok(_) => {
                            app_handle.emit("injection_success", ()).unwrap_or_default();
                        }
                        Err(e) => {
                            eprintln!("❌ Text injection failed: {}", e);
                            app_handle
                                .emit("injection_error", e.to_string())
                                .unwrap_or_default();
                        }
                    }
                }
                "text_and_voice" => {
                    // Hybrid action: Inject text AND read it (single-trip audio when present)
                    println!("🗣️📝 Hybrid action - injecting and reading text");
                    app_handle.emit("tts_speaking", ()).unwrap_or_default();

                    // Inject text first
                    let injector = TextInjector::new();
                    match injector.inject_text(&action_response.value) {
                        Ok(_) => {
                            app_handle.emit("injection_success", ()).unwrap_or_default();
                        }
                        Err(e) => {
                            eprintln!("❌ Text injection failed: {}", e);
                            app_handle
                                .emit("injection_error", e.to_string())
                                .unwrap_or_default();
                        }
                    }

                    // Play audio from single-trip response if present, else TTS API
                    let tts_service = TtsService::new(app_handle.clone());
                    let played = if let Some(ref b64) = action_response.audio_base64 {
                        tts_service.play_audio_base64(b64)
                    } else {
                        tts_service.speak(&action_response.value, None).await
                    };
                    match played {
                        Ok(_) => {
                            app_handle.emit("tts_success", ()).unwrap_or_default();
                        }
                        Err(e) => {
                            eprintln!("❌ TTS/playback failed: {}", e);
                            app_handle
                                .emit("tts_error", e.to_string())
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
