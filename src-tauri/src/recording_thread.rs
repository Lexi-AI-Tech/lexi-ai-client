//! Recording Thread Module
//!
//! This module manages the dedicated thread that handles audio recording.
//! It receives start/stop commands from the global key listener and manages
//! the AudioRecorder lifecycle.

use crate::audio_processor::process_audio;
use crate::audio_recorder::AudioRecorder;
use crate::RecordingCommand;
use std::sync::mpsc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

/// Spawns a dedicated thread to manage the audio recorder.
///
/// This thread handles creating, starting, and stopping the recorder.
/// It receives signals from the global key listener via the channel.
///
/// # Arguments
/// * `app_handle` - The Tauri AppHandle for emitting events
/// * `recording_rx` - Receiver for recording commands (Start/Stop)
pub fn spawn_recording_thread(
    app_handle: AppHandle,
    recording_rx: mpsc::Receiver<RecordingCommand>,
) {
    thread::spawn(move || {
        let mut recorder: Option<AudioRecorder> = None;

        loop {
            match recording_rx.recv() {
                Ok(RecordingCommand::Start) => {
                    // Start recording (Function key pressed)
                    if recorder.is_none() {
                        println!(
                            "Function key (fn) pressed - Starting recording in dedicated thread..."
                        );

                        // Show the pill window when recording starts (it's already created at startup)
                        if let Some(pill_window) = app_handle.get_webview_window("pill") {
                            if let Err(e) = pill_window.show() {
                                eprintln!("Failed to show pill window: {}", e);
                            }
                        }

                        let mut new_recorder = AudioRecorder::new();
                        match new_recorder.start_recording() {
                            Ok(_) => {
                                recorder = Some(new_recorder);
                                app_handle.emit("recording_started", ()).unwrap_or_default();
                            }
                            Err(e) => {
                                eprintln!("Failed to start recording: {}", e);
                                app_handle
                                    .emit("recording_error", e.to_string())
                                    .unwrap_or_default();
                            }
                        }
                    }
                }
                Ok(RecordingCommand::Stop) => {
                    // Stop recording (Function key released)
                    if let Some(mut rec) = recorder.take() {
                        println!("Function key (fn) released - Stopping recording in dedicated thread...");

                        match rec.stop_recording() {
                            Ok(audio_data) => {
                                app_handle.emit("recording_stopped", ()).unwrap_or_default();
                                // Process the audio using Tauri's async runtime
                                process_audio(audio_data, app_handle.clone());
                            }
                            Err(e) => {
                                eprintln!("Failed to stop recording: {}", e);
                                app_handle
                                    .emit("recording_error", e.to_string())
                                    .unwrap_or_default();
                            }
                        }
                    }
                }
                Err(_) => {
                    // Channel closed, exit thread
                    break;
                }
            }
        }
    });
}
