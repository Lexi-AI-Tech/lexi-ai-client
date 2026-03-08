//! Action Audio Processor
//!
//! Processes recorded action audio: sends to server for transcription and action execution.
//! Handles response by type: inject text only (text), or inject and play TTS (voice).

use crate::actions::service::ActionService;
use crate::cursor_context::get_cursor_context;
use crate::text_injector::TextInjector;
use crate::tts_service::TtsService;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Process recorded action audio: send to server, then handle response by action type.
pub async fn process_action_audio(audio_data: Vec<u8>, app_handle: AppHandle) {
    let action_start = Instant::now();
    println!(
        "🎯 Processing action audio, size: {} bytes",
        audio_data.len()
    );

    let app_handle_clone = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        app_handle_clone
            .emit("processing_start", ())
            .unwrap_or_default();
    });

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
                    println!("🔊 Voice action - playing audio from server");
                    let app_handle_clone = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        app_handle_clone
                            .emit("tts_speaking", ())
                            .unwrap_or_default();
                    });

                    let tts_service = TtsService::new(app_handle.clone());
                    match action_response.audio_base64.as_deref() {
                        Some(audio_b64) if !audio_b64.is_empty() => {
                            match tts_service.play_audio_base64(audio_b64) {
                                Ok(_) => {
                                    let total_ms = action_start.elapsed().as_millis();
                                    println!(
                                        "[Voice action] total_time_ms={} (from start to playback finished)",
                                        total_ms
                                    );
                                    let app_handle_clone = app_handle.clone();
                                    tauri::async_runtime::spawn(async move {
                                        app_handle_clone
                                            .emit("tts_success", ())
                                            .unwrap_or_default();
                                    });
                                }
                                Err(e) => {
                                    eprintln!("❌ TTS playback failed: {}", e);
                                    let app_handle_clone = app_handle.clone();
                                    let error_msg = e.to_string();
                                    tauri::async_runtime::spawn(async move {
                                        app_handle_clone
                                            .emit("tts_error", error_msg)
                                            .unwrap_or_default();
                                    });
                                }
                            }
                        }
                        _ => {
                            eprintln!("❌ No audio in voice action response");
                            let app_handle_clone = app_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                app_handle_clone
                                    .emit("tts_error", "No audio in response")
                                    .unwrap_or_default();
                            });
                        }
                    }
                }
                "text" => {
                    println!("📝 Text action - injecting text");
                    let injector = TextInjector::new();
                    match injector.inject_text(&action_response.value) {
                        Ok(_) => {
                            let app_handle_clone = app_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                app_handle_clone
                                    .emit("injection_success", ())
                                    .unwrap_or_default();
                            });
                        }
                        Err(e) => {
                            eprintln!("❌ Text injection failed: {}", e);
                            let app_handle_clone = app_handle.clone();
                            let error_msg = e.to_string();
                            tauri::async_runtime::spawn(async move {
                                app_handle_clone
                                    .emit("injection_error", error_msg)
                                    .unwrap_or_default();
                            });
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
