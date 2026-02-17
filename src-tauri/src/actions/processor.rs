//! Action Audio Processor
//!
//! Processes recorded action audio: sends to server for transcription and action execution.
//! Handles response by type: inject text only (text), or inject and play TTS (voice).
//! Blocking work (inject_text, TTS playback) runs in spawn_blocking to avoid stalling the async runtime.

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

            // Handle the response based on action type. Run blocking work in spawn_blocking
            // so we don't stall the async runtime (clipboard, AppleScript, audio I/O).
            match action_response.action_type.as_str() {
                "voice" => {
                    println!("🔊 Voice action - playing audio from server");
                    app_handle.emit("tts_speaking", ()).unwrap_or_default();

                    let audio_b64 = action_response.audio_base64.clone();
                    let app = app_handle.clone();
                    if let Some(audio_b64) = audio_b64.filter(|s| !s.is_empty()) {
                        let start = action_start;
                        tokio::task::spawn_blocking(move || {
                            let tts_service = TtsService::new(app.clone());
                            match tts_service.play_audio_base64(&audio_b64) {
                                Ok(_) => {
                                    let total_ms = start.elapsed().as_millis();
                                    println!(
                                        "[Voice action] total_time_ms={} (from start to playback finished)",
                                        total_ms
                                    );
                                    let _ = app.emit("tts_success", ());
                                }
                                Err(e) => {
                                    eprintln!("❌ TTS playback failed: {}", e);
                                    let _ = app.emit("tts_error", e.to_string());
                                }
                            }
                        })
                        .await
                        .ok();
                    } else {
                        eprintln!("❌ No audio in voice action response");
                        app_handle
                            .emit("tts_error", "No audio in response")
                            .unwrap_or_default();
                    }
                }
                "text" => {
                    println!("📝 Text action - injecting text");
                    let value = action_response.value.clone();
                    let app = app_handle.clone();
                    tokio::task::spawn_blocking(move || {
                        let injector = TextInjector::new();
                        match injector.inject_text(&value) {
                            Ok(_) => {
                                let _ = app.emit("injection_success", ());
                            }
                            Err(e) => {
                                eprintln!("❌ Text injection failed: {}", e);
                                let _ = app.emit("injection_error", e.to_string());
                            }
                        }
                    })
                    .await
                    .ok();
                }
                _ => {
                    eprintln!("⚠️  Unknown action type: {}", action_response.action_type);
                    let value = action_response.value.clone();
                    let app = app_handle.clone();
                    tokio::task::spawn_blocking(move || {
                        let injector = TextInjector::new();
                        if let Err(e) = injector.inject_text(&value) {
                            eprintln!("❌ Text injection failed: {}", e);
                        }
                    })
                    .await
                    .ok();
                }
            }
        }
        None => {
            println!("❌ Action failed to execute");
            // Errors are already emitted by ActionService
        }
    }
}
