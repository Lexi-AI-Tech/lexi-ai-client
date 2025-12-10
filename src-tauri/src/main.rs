// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// This is the main entry point for the Lexi AI Client Tauri application.
// The application provides a voice-to-text overlay that:
// 1. Listens for Option key press/release to start/stop audio recording
// 2. Captures audio from the default microphone
// 3. Transcribes the audio using Lexi AI Server (which uses Groq's Whisper API)
// 4. Injects the transcribed text into the currently active application

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use device_query::{DeviceQuery, DeviceState, Keycode};

// Module declarations for core functionality
mod audio_recorder;  // Handles audio capture from microphone
mod speech_api;      // Communicates with Groq API for speech-to-text transcription
mod text_injector;   // Injects transcribed text into active application

use audio_recorder::AudioRecorder;
use speech_api::SpeechAPI;
use text_injector::TextInjector;



/// Tauri command to start recording (currently unused as we use hotkey detection)
/// This is kept for potential future UI-triggered recording functionality
#[tauri::command]
async fn start_recording(_app_handle: AppHandle) -> Result<(), String> {
    // This command might be unused now that we use device_query, but keeping it for UI triggers if needed
    Ok(())
}

/// Tauri command to stop recording (currently unused as we use hotkey detection)
/// This is kept for potential future UI-triggered recording functionality
#[tauri::command]
async fn stop_recording() -> Result<(), String> {
    Ok(())
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
            app_handle.emit_all("processing_start", ()).unwrap_or_default();
            
            // Initialize the speech API client and transcribe the audio
            let api = SpeechAPI::new();
            match api.transcribe_audio(audio_data).await {
                Ok(transcription) => {
                    println!("Transcription: {}", transcription);
                    
                    // Notify frontend of successful transcription
                    app_handle.emit_all("transcription_success", &transcription).unwrap_or_default();
                    
                    // Only inject text if transcription is not empty
                    if !transcription.trim().is_empty() {
                        let injector = TextInjector::new();
                        match injector.inject_text(&transcription) {
                            Ok(_) => {
                                // Successfully injected text into active application
                                app_handle.emit_all("injection_success", ()).unwrap_or_default();
                            }
                            Err(e) => {
                                eprintln!("Failed to inject text: {}", e);
                                // Notify frontend of injection failure
                                app_handle.emit_all("injection_error", e.to_string()).unwrap_or_default();
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Transcription failed: {}", e);
                    // Notify frontend of transcription failure
                    app_handle.emit_all("transcription_error", e.to_string()).unwrap_or_default();
                }
            }
        });
    });
}

/// Main entry point for the Tauri application
/// 
/// Sets up the application window, configures macOS-specific window behavior,
/// and spawns a background thread to monitor for Option key presses/releases
/// to control audio recording.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn main() {
    // Shared state to track whether we're currently recording
    // Arc<Mutex<>> allows safe sharing between threads
    let recording = Arc::new(Mutex::new(false));
    
    tauri::Builder::default()
        .setup(move |app| {
            let app_handle = app.handle();
            let recording_state = recording.clone();

            let window = app.get_window("main").unwrap();
            
            // Prevent the app from closing when window is closed
            // This keeps the background hotkey monitoring thread running
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
            
            // Window positioning code (currently commented out)
            // This would position the window at the bottom center of the screen,
            // just above the taskbar/dock. Uncomment if you want this behavior.
            // if let Ok(monitor) = window.primary_monitor() {
            //     if let Some(monitor) = monitor {
            //         let screen_size = monitor.size();
            //         let window_size = window.inner_size().unwrap();
            //         let taskbar_height = 60.0; // Approximate taskbar/dock height
            //         let x = (screen_size.width as f64 / 2.0) - (window_size.width as f64 / 2.0);
            //         let y = screen_size.height as f64 - window_size.height as f64 - taskbar_height;
            //         window.set_position(tauri::LogicalPosition::new(x, y)).unwrap_or_default();
            //     }
            // }
            
            // macOS-specific window configuration
            // Makes the window appear on all Spaces (virtual desktops)
            // This ensures the overlay is always accessible regardless of which Space the user is on
            #[cfg(target_os = "macos")]
            {
                use cocoa::appkit::{NSWindow, NSWindowCollectionBehavior};
                use cocoa::base::id;
                use raw_window_handle::{HasRawWindowHandle, RawWindowHandle};

                if let RawWindowHandle::AppKit(handle) = window.raw_window_handle() {
                    let ns_window = handle.ns_window as id;
                    unsafe {
                        // Set window behavior to allow it to join all Spaces
                        let mut behavior = ns_window.collectionBehavior();
                        behavior |= NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces;
                        ns_window.setCollectionBehavior_(behavior);
                    }
                }
            }
            
            // Spawn a background thread to continuously monitor for Option key presses
            // This thread runs independently of the main UI thread
            thread::spawn(move || {
                // AudioRecorder instance - created when recording starts, consumed when stopped
                let mut recorder: Option<AudioRecorder> = None;
                
                // DeviceState allows us to query the current state of keyboard keys
                let device_state = DeviceState::new();
                // Track previous key state to detect press/release events
                let mut was_pressed = false;

                // Main hotkey detection loop
                // Runs continuously, checking key state every 50ms
                loop {
                    // Get all currently pressed keys
                    let keys: Vec<Keycode> = device_state.get_keys();
                    
                    // Check if either Left Option or Right Option key is currently pressed
                    // macOS uses "Option" key (not "Alt"), which maps to LOption/ROption
                    let is_pressed = keys.contains(&Keycode::LOption) || keys.contains(&Keycode::ROption);

                    // Detect key press event (transition from not pressed to pressed)
                    if is_pressed && !was_pressed {
                        let mut is_recording = recording_state.lock().unwrap();
                        // Only start recording if we're not already recording
                        if !*is_recording {
                            println!("Starting recording...");
                            *is_recording = true;
                            
                            // Notify frontend that recording has started
                            app_handle.emit_all("recording_started", ()).unwrap_or_default();
                            
                            // Initialize and start the audio recorder
                            let mut new_recorder = AudioRecorder::new();
                            match new_recorder.start_recording() {
                                Ok(_) => {
                                    // Successfully started recording - store the recorder
                                    recorder = Some(new_recorder);
                                }
                                Err(e) => {
                                    eprintln!("Failed to start recording: {}", e);
                                    // Reset state and notify frontend of error
                                    *is_recording = false;
                                    app_handle.emit_all("recording_error", e.to_string()).unwrap_or_default();
                                }
                            }
                        }
                    } 
                    // Detect key release event (transition from pressed to not pressed)
                    else if !is_pressed && was_pressed {
                        let mut is_recording = recording_state.lock().unwrap();
                        // Only stop recording if we were actually recording
                        if *is_recording {
                            println!("Stopping recording...");
                            *is_recording = false;
                            
                            // Notify frontend that recording has stopped
                            app_handle.emit_all("recording_stopped", ()).unwrap_or_default();

                            // Stop the recorder and get the audio data
                            if let Some(mut rec) = recorder.take() {
                                match rec.stop_recording() {
                                    Ok(audio_data) => {
                                        // Process the audio in a separate thread
                                        // This will transcribe and inject the text
                                        process_audio(audio_data, app_handle.clone());
                                    }
                                    Err(e) => {
                                        eprintln!("Failed to stop recording: {}", e);
                                        app_handle.emit_all("recording_error", e.to_string()).unwrap_or_default();
                                    }
                                }
                            }
                        }
                    }

                    // Update previous state for next iteration
                    was_pressed = is_pressed;
                    // Sleep for 50ms before checking again
                    // This balances responsiveness with CPU usage
                    thread::sleep(Duration::from_millis(50));
                }
            });
            
            Ok(())
        })
        // Register Tauri commands that can be called from the frontend
        .invoke_handler(tauri::generate_handler![start_recording, stop_recording])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}