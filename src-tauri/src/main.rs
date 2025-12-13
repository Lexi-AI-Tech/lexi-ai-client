// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// This is the main entry point for the Lexi AI Client Tauri application.
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
mod speech_api;      // Communicates with Groq API for speech-to-text transcription
mod text_injector;   // Injects transcribed text into active application
mod global_key_listener;  // Handles global keyboard event listening via rdev

use audio_recorder::AudioRecorder;
use speech_api::SpeechAPI;
use text_injector::TextInjector;

/// Request microphone permission on macOS
/// This will trigger the system permission dialog by attempting to access the microphone
#[tauri::command]
#[cfg(target_os = "macos")]
fn request_microphone_permission() -> Result<bool, String> {
    use std::thread;
    use std::time::Duration;
    
    // Spawn a thread to attempt microphone access, which triggers the permission dialog
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(100));
        
        // Try to create an audio recorder, which will trigger the permission dialog
        // We do this in a separate thread to avoid blocking
        // If permission is denied, this will fail, but that's okay - we just want to trigger the dialog
        let _ = std::panic::catch_unwind(|| {
            let _recorder = AudioRecorder::new();
            println!("Microphone permission dialog should have appeared");
        });
    });
    
    // Return immediately - the permission dialog will appear asynchronously
    Ok(true)
}

/// Request microphone permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
fn request_microphone_permission() -> Result<bool, String> {
    Ok(true)
}

/// Request Input Monitoring permission on macOS
/// This will trigger the system permission dialog by attempting to use rdev::listen
#[tauri::command]
#[cfg(target_os = "macos")]
fn request_input_monitoring_permission(_app: AppHandle) -> Result<bool, String> {
    use std::thread;
    use std::time::Duration;
    use rdev::{listen, Event};
    
    // Spawn a thread to attempt starting a test listener, which triggers the permission dialog
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(100));
        
        // Try to start a test listener, which will trigger Input Monitoring permission dialog
        // We do this in a separate thread to avoid blocking
        let _ = std::panic::catch_unwind(|| {
            let _ = listen(move |_event: Event| {
                // Empty callback - we just want to trigger the permission dialog
            });
            println!("Input Monitoring permission dialog should have appeared");
        });
    });
    
    // Return immediately - the permission dialog will appear asynchronously
    Ok(true)
}

/// Request Input Monitoring permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
fn request_input_monitoring_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}

/// Request Accessibility permission on macOS
/// This is required for pasting text via AppleScript/System Events
#[tauri::command]
#[cfg(target_os = "macos")]
fn request_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    use std::process::Command;
    use std::thread;
    use std::time::Duration;
    
    // Spawn a thread to attempt using System Events, which triggers the permission dialog
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(100));
        
        // Try to run a simple AppleScript that uses System Events
        // This will trigger the Accessibility permission dialog
        // We use a harmless command that just checks if we can access System Events
        let script = r#"
            tell application "System Events"
                -- Just check if we can access System Events (triggers permission dialog)
                get name of every process
            end tell
        "#;
        
        let _ = std::panic::catch_unwind(|| {
            let _ = Command::new("osascript")
                .arg("-e")
                .arg(script)
                .output();
            println!("Accessibility permission dialog should have appeared");
        });
    });
    
    // Return immediately - the permission dialog will appear asynchronously
    Ok(true)
}

/// Request Accessibility permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
fn request_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
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
            
            // Initialize the speech API client and transcribe the audio
            let api = SpeechAPI::new();
            match api.transcribe_audio(audio_data).await {
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
        .invoke_handler(tauri::generate_handler![request_microphone_permission, request_input_monitoring_permission, request_accessibility_permission])
        .setup(move |app| {
            let app_handle = app.handle();
            
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