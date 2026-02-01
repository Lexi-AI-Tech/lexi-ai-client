//! Action Recording Thread Module
//!
//! This module handles recording and processing for action commands triggered by the action hotkey.
//! Similar to the main recording thread, but specifically processes actions instead of regular transcriptions.

use crate::actions::perform_action;
use crate::audio_recorder::AudioRecorder;
use crate::RecordingCommand;
use std::sync::mpsc;
use tauri::{AppHandle, Emitter};

/// Phase of the action recording lifecycle
#[derive(Debug, Clone, PartialEq)]
enum ActionRecordingPhase {
    Idle,
    Recording,
    Error(String),
}

/// Spawns a dedicated thread to handle action recording triggered by the action hotkey.
///
/// This thread:
/// 1. Listens for ActionStart/ActionStop commands via the action_rx channel
/// 2. Records audio while the action hotkey is held
/// 3. Transcribes the audio when the hotkey is released
/// 4. Calls perform_action with the transcribed command
/// 5. Handles the action response (inject text or speak via TTS)
///
/// # Arguments
/// * `app_handle` - The Tauri AppHandle for emitting events and accessing state
/// * `action_rx` - Channel receiver for ActionStart/ActionStop commands
pub fn spawn_action_recording_thread(
    app_handle: AppHandle,
    action_rx: mpsc::Receiver<RecordingCommand>,
) {
    std::thread::spawn(move || {
        println!("🎯 Action recording thread started");

        let mut phase = ActionRecordingPhase::Idle;
        let mut recorder: Option<AudioRecorder> = None;

        loop {
            // Wait for commands with a timeout to allow periodic cleanup
            let command = match action_rx.recv() {
                Ok(cmd) => cmd,
                Err(_) => {
                    println!("🛑 Action recording channel closed, exiting action recording thread");
                    break;
                }
            };

            // Process command based on current phase
            match (command, &phase) {
                // ActionStart in Idle or Error state - start new action recording
                (RecordingCommand::ActionStart, ActionRecordingPhase::Idle | ActionRecordingPhase::Error(_)) => {
                    println!("🎯 Action hotkey pressed - starting action recording");
                    // phase = ActionRecordingPhase::Starting;

                    // Emit event to frontend
                    app_handle
                        .emit("action_recording_started", ())
                        .unwrap_or_default();

                    // Initialize audio recorder
                    let new_recorder = AudioRecorder::new();
                    recorder = Some(new_recorder);
                    phase = ActionRecordingPhase::Recording;
                    println!("✅ Action recording started successfully");

                    // Start recording (ignore errors for now as new() shouldn't fail)
                    if let Some(rec) = recorder.as_mut() {
                       if let Err(e) = rec.start_recording(None) {
                            let error_msg = format!("Failed to start action recording: {}", e);
                            eprintln!("❌ {}", error_msg);
                            phase = ActionRecordingPhase::Error(error_msg.clone());
                            app_handle
                                .emit("action_recording_error", error_msg)
                                .unwrap_or_default();
                            recorder = None;
                       }
                    }
                }

                // ActionStop in Recording state - stop and process
                (RecordingCommand::ActionStop, ActionRecordingPhase::Recording) => {
                    println!("🎯 Action hotkey released - stopping action recording");
                    // phase = ActionRecordingPhase::Stopping;

                    if let Some(mut rec) = recorder.take() {
                        // Stop recording and get audio data
                        match rec.stop_recording() {
                            Ok(audio_data) => {
                                println!("✅ Action audio captured: {} bytes", audio_data.len());
                                
                                // Emit event to frontend
                                app_handle
                                    .emit("action_recording_stopped", ())
                                    .unwrap_or_default();

                                // Process the action in a separate async task
                                let app_handle_for_action = app_handle.clone();
                                tauri::async_runtime::spawn(async move {
                                    process_action_audio(audio_data, app_handle_for_action).await;
                                });

                                phase = ActionRecordingPhase::Idle;
                            }
                            Err(e) => {
                                let error_msg = format!("Failed to capture action audio: {}", e);
                                eprintln!("❌ {}", error_msg);
                                phase = ActionRecordingPhase::Error(error_msg.clone());
                                app_handle
                                    .emit("action_recording_error", error_msg)
                                    .unwrap_or_default();
                            }
                        }
                    } else {
                        println!("⚠️  No active action recorder to stop");
                        phase = ActionRecordingPhase::Idle;
                    }
                }

                // Ignore duplicate or out-of-order commands
                (RecordingCommand::ActionStart, ActionRecordingPhase::Recording) => {
                    println!("⚠️  Ignoring duplicate ActionStart (already recording)");
                }
                (RecordingCommand::ActionStop, ActionRecordingPhase::Idle) => {
                    println!("⚠️  Ignoring ActionStop (not recording)");
                }
                (RecordingCommand::ActionStop, ActionRecordingPhase::Error(_)) => {
                    println!("⚠️  Ignoring ActionStop (in error state)");
                    phase = ActionRecordingPhase::Idle;
                }


                // Ignore regular Start/Stop commands (they go to the main recording thread)
                (RecordingCommand::Start, _) | (RecordingCommand::Stop, _) => {
                    // These should not be sent to this channel, but ignore if they are
                }
            }
        }

        println!("🛑 Action recording thread stopped");
    });
}

/// Process action audio by transcribing it and executing the action
async fn process_action_audio(audio_data: Vec<u8>, app_handle: AppHandle) {
    use crate::commands::app_config::get_app_config;
    use crate::commands::auth::get_auth_token_async;
    use crate::cursor_context::get_cursor_context;
    use crate::stt_service::SttService;
    use crate::text_injector::TextInjector;
    use crate::tts_service::TtsService;

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
    let stt_service = SttService::new();
    match stt_service
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
