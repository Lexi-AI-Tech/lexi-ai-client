// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// This is the main entry point for the Lexi AI Tauri application.
// The application provides a voice-to-text overlay that:
// 1. Listens for Function key (fn) press/release to start/stop audio recording
// 2. Captures audio from the default microphone
// 3. Transcribes the audio using Lexi AI Server (which uses Groq's Whisper API)
// 4. Injects the transcribed text into the currently active application

use std::sync::mpsc;
use std::thread;

use tauri::{AppHandle, Manager, Emitter};

// Module declarations for core functionality
mod audio_recorder;  // Handles audio capture from microphone
mod stt_service;     // Communicates with Groq API for speech-to-text transcription
mod text_injector;   // Injects transcribed text into active application
mod global_key_listener;  // Handles global keyboard event listening via rdev
mod permissions;     // Handles permission requests for microphone, input monitoring, and accessibility
mod pill;           // Handles pill overlay window management

use audio_recorder::AudioRecorder;
use stt_service::SttService;
use text_injector::TextInjector;

use permissions::{
    request_accessibility_permission,
    request_input_monitoring_permission,
    request_microphone_permission,
};

/// Inject text into the currently active application
/// 
/// This command allows the frontend to directly inject text into any active application.
/// It uses the cross-platform TextInjector implementation which:
/// 1. Copies text to the clipboard
/// 2. Simulates a paste keystroke (Cmd+V on macOS, Ctrl+V elsewhere)
/// 
/// # Arguments
/// * `text` - The text to inject
/// 
/// # Returns
/// * `Ok(())` - Successfully injected the text
/// * `Err(String)` - An error message if injection failed
#[tauri::command]
fn inject_text(text: String) -> Result<(), String> {
    let injector = TextInjector::new();
    injector
        .inject_text(&text)
        .map_err(|e| format!("Injection failed: {}", e))
}

// Re-export pill function as a Tauri command
#[tauri::command]
fn show_pill_window(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    pill::show_pill_window(app, x, y)
}

/// Processes recorded audio data by:
/// 1. Sending it to the speech-to-text API for transcription
/// 2. Injecting the transcribed text into the active application
/// 3. Emitting events to the frontend to update UI state
/// 
/// This function runs in a separate thread to avoid blocking the main thread.
/// It creates a new Tokio runtime since it's called from a non-async context.
fn process_audio(audio_data: Vec<u8>, app_handle: AppHandle) {
    thread::spawn(move || {
        // Create a new Tokio runtime for async operations
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            println!("Processing audio, size: {} bytes", audio_data.len());
            
            // Notify frontend that transcription has started
            app_handle.emit("processing_start", ()).unwrap_or_default();
            
            // Initialize the STT service client and transcribe the audio
            let stt_service = SttService::new();
            match stt_service.transcribe_audio(audio_data).await {
                Ok(transcription) => {
                    println!("Transcription: {}", transcription);
                    
                    // Notify frontend of successful transcription
                    app_handle.emit("transcription_success", &transcription).unwrap_or_default();
                    
                    // Only inject text if transcription is not empty
                    if !transcription.trim().is_empty() {
                        let injector = TextInjector::new();
                        match injector.inject_text(&transcription) {
                            Ok(_) => {
                                // Successfully injected text into active application
                                app_handle.emit("injection_success", ()).unwrap_or_default();
                            }
                            Err(e) => {
                                eprintln!("Failed to inject text: {}", e);
                                // Notify frontend of injection failure
                                app_handle.emit("injection_error", e.to_string()).unwrap_or_default();
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Transcription failed: {}", e);
                    // Notify frontend of transcription failure
                    app_handle.emit("transcription_error", e.to_string()).unwrap_or_default();
                }
            }
        });
    });
}

/// Main entry point for the Tauri application
/// 
/// Sets up the application window, configures macOS-specific window behavior,
/// and registers global shortcuts for Function key (fn) presses/releases
/// to control audio recording.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            request_microphone_permission,
            request_input_monitoring_permission,
            request_accessibility_permission,
            inject_text,
            show_pill_window
        ])
        .setup(move |app| {
            let app_handle = app.handle();
            
            // Initialize and position the pill window at the center of the screen
            // This is done in setup so the window is positioned before it becomes visible
            if let Err(e) = pill::init_pill_window(app_handle.clone()) {
                eprintln!("Failed to initialize pill window: {}", e);
            }
            
            // Channel to communicate with the recording thread
            // Sender is used by key listener to signal start/stop, receiver is used in the recording thread
            let (recording_tx, recording_rx) = mpsc::channel::<bool>(); // true = start, false = stop
            
            // Start the global input listener (rdev) in a background thread
            // Pass the channel sender so it can trigger recording on Function key press/release
            global_key_listener::start_listener(app_handle.clone(), recording_tx);

            let window = app.get_webview_window("main").unwrap();
            
            // Prevent the app from closing when window is closed
            // This keeps the global shortcut monitoring active
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Hide the window instead of closing it
                    // This keeps the app running in the background so hotkeys continue to work
                    api.prevent_close();
                    if let Err(e) = window_clone.hide() {
                        eprintln!("Failed to hide window: {}", e);
                    } else {
                        println!("Window hidden - app continues running in background. Hotkeys will still work.");
                    }
                }
            });
            
            #[cfg(desktop)]
            {
                // Spawn a dedicated thread to manage the audio recorder
                // This thread will handle creating, starting, and stopping the recorder
                // It receives signals from the global key listener via the channel
                let app_handle_for_recording = app_handle.clone();
                thread::spawn(move || {
                    let mut recorder: Option<AudioRecorder> = None;
                    
                    loop {
                        match recording_rx.recv() {
                            Ok(true) => {
                                // Start recording (Function key pressed)
                                if recorder.is_none() {
                                    println!("Function key (fn) pressed - Starting recording in dedicated thread...");
                                    
                                    let mut new_recorder = AudioRecorder::new();
                                    match new_recorder.start_recording() {
                                        Ok(_) => {
                                            recorder = Some(new_recorder);
                                            app_handle_for_recording.emit("recording_started", ()).unwrap_or_default();
                                        }
                                        Err(e) => {
                                            eprintln!("Failed to start recording: {}", e);
                                            app_handle_for_recording.emit("recording_error", e.to_string()).unwrap_or_default();
                                        }
                                    }
                                }
                            }
                            Ok(false) => {
                                // Stop recording (Function key released)
                                if let Some(mut rec) = recorder.take() {
                                    println!("Function key (fn) released - Stopping recording in dedicated thread...");
                                    
                                    match rec.stop_recording() {
                                        Ok(audio_data) => {
                                            app_handle_for_recording.emit("recording_stopped", ()).unwrap_or_default();
                                            // Process the audio in a separate thread
                                            process_audio(audio_data, app_handle_for_recording.clone());
                                        }
                                        Err(e) => {
                                            eprintln!("Failed to stop recording: {}", e);
                                            app_handle_for_recording.emit("recording_error", e.to_string()).unwrap_or_default();
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
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}