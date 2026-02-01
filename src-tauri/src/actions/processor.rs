//! Action Audio Processor Logic
//! 
//! This module contains the logic to process recorded audio for actions.
//! It handles transcription, action execution, and response handling (TTS/Injection).

use tauri::{AppHandle, Emitter};
use crate::actions::perform_action;
use crate::commands::app_config::get_app_config;
use crate::commands::auth::get_auth_token_async;
use crate::cursor_context::get_cursor_context;
use crate::assistant::AssistantService;
use crate::text_injector::TextInjector;
use crate::tts_service::TtsService;

/// Process action audio by transcribing it and executing the action
pub async fn process_action_audio(audio_data: Vec<u8>, app_handle: AppHandle) {
    println!("🎯 Processing action audio, size: {} bytes", audio_data.len());

    // Notify frontend that action processing has started
    app_handle
        .emit("processing_start", ())
        .unwrap_or_default();

    // Get authentication token
    let auth_token = get_auth_token_async(&app_handle).await;
    if auth_token.is_none() {
        let error_msg = "Authentication required for actions. Please log in.";
        app_handle.emit("error", error_msg).unwrap_or_default();
        return;
    }

    // Get app config
    let app_config = match get_app_config(app_handle.clone()).await {
        Ok(config) => config,
        Err(e) => {
            let error_msg = format!("Failed to load app config: {}", e);
            app_handle.emit("error", error_msg.as_str()).unwrap_or_default();
            return;
        }
    };

    // Get transcription settings
    let language = app_config
        .languages
        .and_then(|langs| langs.first().cloned())
        .unwrap_or_else(|| "auto".to_string());
    let enhance_transcription = app_config.enhance_transcription.unwrap_or(false);
    let vocabulary: Vec<String> = app_config.vocabulary.clone().unwrap_or_default();

    // Get cursor context
    let cursor_context = get_cursor_context();

    // Transcribe the audio
    let assistant_service = AssistantService::new();
    match assistant_service
        .transcribe_audio(
            audio_data,
            auth_token,
            language,
            enhance_transcription,
            Some(app_handle.clone()),
            false, // offline_transcription
            vocabulary,
        )
        .await
    {
        Ok((transcription, _)) => {
            println!("✅ Action command transcribed: {}", transcription);

            if transcription.trim().is_empty() {
                println!("⚠️  Empty action command, ignoring");
                return;
            }

            // Notify frontend of successful transcription
            app_handle
                .emit("transcription_success", &transcription)
                .unwrap_or_default();

            // Perform the action
            match perform_action(&transcription, &app_handle, cursor_context.as_ref()).await {
                Some(action_response) => {
                    println!("✅ Action completed: {:?}", action_response.action_type);

                    // Handle the response based on action type
                    match action_response.action_type.as_str() {
                        "voice" => {
                            // Use TTS to read the text
                            println!("🔊 Voice action - reading text using TTS");
                            let tts_service = TtsService::new(app_handle.clone());
                            match tts_service.speak(&action_response.value, None).await {
                                Ok(_) => {
                                    app_handle.emit("tts_success", ()).unwrap_or_default();
                                }
                                Err(e) => {
                                    eprintln!("❌ TTS failed: {}", e);
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
                            // Hybrid action: Inject text AND Read it
                            println!("🗣️📝 Hybrid action - injecting and reading text");

                            // Start TTS
                            let tts_service = TtsService::new(app_handle.clone());
                            let tts_handle = tts_service.speak(&action_response.value, None);

                            // Inject text
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

                            // Wait for TTS
                            match tts_handle.await {
                                Ok(_) => {
                                    app_handle.emit("tts_success", ()).unwrap_or_default();
                                }
                                Err(e) => {
                                    eprintln!("❌ TTS failed: {}", e);
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
                }
            }
        }
        Err(e) => {
            let error_msg = format!("Action transcription failed: {}", e);
            eprintln!("❌ {}", error_msg);
            app_handle
                .emit("transcription_error", error_msg)
                .unwrap_or_default();
        }
    }
}
