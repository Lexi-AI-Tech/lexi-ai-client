// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// This is the main entry point for the Lexi AI Client Tauri application.
// The application provides a voice-to-text overlay that:
// 1. Listens for Function key (fn) press/release to start/stop audio recording
// 2. Captures audio from the default microphone
// 3. Transcribes the audio using Lexi AI Server (which uses Groq's Whisper API)
// 4. Injects the transcribed text into the currently active application

use std::sync::{Arc, Mutex, mpsc};
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
    // Shared state to track whether we're currently recording
    // Arc<Mutex<>> allows safe sharing between threads
    let recording = Arc::new(Mutex::new(false));
    
    tauri::Builder::default()
        .setup(move |app| {
            let app_handle = app.handle();
            let recording_state = recording.clone();
            
            // Channel to communicate with the recording thread
            // Sender is used by key listener to signal start/stop, receiver is used in the recording thread
            let (recording_tx, recording_rx) = mpsc::channel::<bool>(); // true = start, false = stop
            
            // Start the global input listener (rdev) in a background thread
            // Pass the channel sender so it can trigger recording on F1 key press/release
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
            
            
            // macOS-specific window configuration
            // Makes the window appear on all Spaces (virtual desktops)
            // This ensures the overlay is always accessible regardless of which Space the user is on
            // #[cfg(target_os = "macos")]
            // {
            //     use cocoa::appkit::{NSWindow, NSWindowCollectionBehavior};
            //     use cocoa::base::id;

            //     if let Ok(ns_window_ptr) = window.ns_window() {
            //         let ns_window = ns_window_ptr as id;
            //         unsafe {
            //             // Set window behavior to allow it to join all Spaces
            //             let mut behavior = ns_window.collectionBehavior();
            //             behavior |= NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces;
            //             ns_window.setCollectionBehavior_(behavior);
            //         }
            //     }
            // }
            
            #[cfg(desktop)]
            {
                let recording_state_clone = recording_state.clone();
                let app_handle_clone = app_handle.clone();
                
                // Spawn a dedicated thread to manage the audio recorder
                // This thread will handle creating, starting, and stopping the recorder
                // It receives signals from the global key listener via the channel
                let app_handle_for_recording = app_handle_clone.clone();
                let recording_state_for_recording = recording_state_clone.clone();
                thread::spawn(move || {
                    let mut recorder: Option<AudioRecorder> = None;
                    
                    loop {
                        match recording_rx.recv() {
                            Ok(true) => {
                                // Start recording (Function key pressed)
                                if recorder.is_none() {
                                    println!("Function key (fn) pressed - Starting recording in dedicated thread...");
                                    let mut is_rec = recording_state_for_recording.lock().unwrap();
                                    *is_rec = true;
                                    drop(is_rec);
                                    
                                    let mut new_recorder = AudioRecorder::new();
                                    match new_recorder.start_recording() {
                                        Ok(_) => {
                                            recorder = Some(new_recorder);
                                            app_handle_for_recording.emit("recording_started", ()).unwrap_or_default();
                                        }
                                        Err(e) => {
                                            eprintln!("Failed to start recording: {}", e);
                                            let mut is_rec = recording_state_for_recording.lock().unwrap();
                                            *is_rec = false;
                                            drop(is_rec);
                                            app_handle_for_recording.emit("recording_error", e.to_string()).unwrap_or_default();
                                        }
                                    }
                                }
                            }
                            Ok(false) => {
                                // Stop recording (Function key released)
                                if let Some(mut rec) = recorder.take() {
                                    println!("Function key (fn) released - Stopping recording in dedicated thread...");
                                    let mut is_rec = recording_state_for_recording.lock().unwrap();
                                    *is_rec = false;
                                    drop(is_rec);
                                    
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
        // Register Tauri commands that can be called from the frontend
        // .invoke_handler(tauri::generate_handler![start_recording, stop_recording])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}