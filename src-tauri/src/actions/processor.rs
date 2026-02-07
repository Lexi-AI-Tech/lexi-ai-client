//! Action Audio Processor
//!
//! Processes recorded action audio: sends to server for transcription and action execution.
//! Handles response by type: play audio (voice), inject text (text), or both (text_and_voice).

use crate::actions::service::ActionService;
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
                    println!("🔊 Voice action - playing audio from response");
                    app_handle.emit("tts_speaking", ()).unwrap_or_default();
                    let tts_service = TtsService::new(app_handle.clone());
                    match action_response.audio_base64.as_deref() {
                        Some(b64) => match tts_service.play_audio_base64(b64) {
                            Ok(_) => app_handle.emit("tts_success", ()).unwrap_or_default(),
                            Err(e) => {
                                eprintln!("❌ Playback failed: {}", e);
                                app_handle.emit("tts_error", e.to_string()).unwrap_or_default();
                            }
                        },
                        None => {
                            eprintln!("❌ No audio in response");
                            app_handle
                                .emit("tts_error", "No audio in response")
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
                    println!("🗣️📝 Hybrid action - injecting text and playing audio");
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
                    match action_response.audio_base64.as_deref() {
                        Some(b64) => match tts_service.play_audio_base64(b64) {
                            Ok(_) => app_handle.emit("tts_success", ()).unwrap_or_default(),
                            Err(e) => {
                                eprintln!("❌ Playback failed: {}", e);
                                app_handle.emit("tts_error", e.to_string()).unwrap_or_default();
                            }
                        },
                        None => {
                            eprintln!("❌ No audio in response");
                            app_handle
                                .emit("tts_error", "No audio in response")
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
