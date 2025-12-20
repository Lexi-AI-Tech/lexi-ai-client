// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// This is the main entry point for the Lexi AI Tauri application.
// The application provides a voice-to-text overlay that:
// 1. Listens for Function key (fn) press/release via global keyboard listener to start/stop audio recording
// 2. Captures audio from the default microphone using cpal (Cross-Platform Audio Library)
// 3. Transcribes the audio using Lexi AI Server API endpoint (server handles Groq's Whisper API integration)
// 4. Injects the transcribed text into the currently active application using clipboard + paste keystroke
// 5. Manages a pill overlay window that displays recording status
// 6. Handles Google OAuth authentication with PKCE for user authentication

use std::sync::mpsc;
use std::thread;

use tauri::{AppHandle, Manager, Emitter};

// Module declarations for core functionality
mod audio_recorder;  // Handles audio capture from default microphone using cpal, converts to WAV format
mod stt_service;     // Communicates with Lexi AI Server API for speech-to-text transcription (server uses Groq)
mod text_injector;   // Injects transcribed text into active application via clipboard + paste keystroke (rdev/enigo)
mod global_key_listener;  // Handles global keyboard event listening via rdev, triggers recording on Function key
mod permissions;     // Handles permission requests and checks for microphone, input monitoring, and accessibility (macOS)
mod pill;           // Handles pill overlay window creation, positioning, and visibility management
mod cursor_context;  // Handles cursor context retrieval using macOS Accessibility API (AXUIElement)
mod google_oauth;   // Handles Google OAuth 2.0 authentication flow with PKCE (Proof Key for Code Exchange)
mod config;         // Handles application configuration (API base URL, OAuth redirect URI)

use audio_recorder::AudioRecorder;
use stt_service::SttService;
use text_injector::TextInjector;

use permissions::{
    request_accessibility_permission,
    request_input_monitoring_permission,
    request_microphone_permission,
    check_accessibility_permission,
    check_input_monitoring_permission,
    check_microphone_permission,
};

use google_oauth::{OAuthState, start_google_login, get_pkce_verifier};
use std::sync::Mutex;

/// Auth token state for storing the current access token
#[derive(Default)]
struct AuthTokenState {
    token: Mutex<Option<String>>,
}

/// Set the authentication token from frontend
/// 
/// This command allows the frontend to update the access token stored in Rust state.
/// The frontend should call this whenever the auth token changes.
/// 
/// # Arguments
/// * `token` - Optional access token from frontend
#[tauri::command]
fn set_auth_token(state: tauri::State<AuthTokenState>, token: Option<String>) {
    if let Ok(mut token_guard) = state.token.lock() {
        *token_guard = token;
        println!("🔐 Auth token updated");
    }
}

/// Get the current authentication token
/// 
/// # Returns
/// * `Option<String>` - The current access token if available, None otherwise
fn get_auth_token(state: &tauri::State<AuthTokenState>) -> Option<String> {
    if let Ok(token_guard) = state.token.lock() {
        token_guard.clone()
    } else {
        None
    }
}

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

// Re-export pill functions as Tauri commands
#[tauri::command]
fn show_pill_window(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    pill::show_pill_window(app, x, y)
}

#[tauri::command]
fn toggle_pill_window(app: AppHandle) -> Result<(), String> {
    pill::toggle_pill_window(app)
}

/// Processes recorded audio data by:
/// 1. Getting the authentication token from AuthTokenState
/// 2. Sending the WAV audio data to Lexi AI Server API for transcription
/// 3. Injecting the transcribed text into the active application using TextInjector
/// 4. Emitting events to the frontend to update UI state (processing_start, transcription_success, etc.)
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
            
            // Get authentication token from state
            let auth_token = if let Some(state) = app_handle.try_state::<AuthTokenState>() {
                get_auth_token(&state)
            } else {
                None
            };
            
            if auth_token.is_none() {
                eprintln!("⚠️  Warning: No authentication token available. Transcription will fail with 401.");
                eprintln!("💡 Tip: Make sure you're logged in and the frontend has synced the token using set_auth_token");
            } else {
                println!("✅ Auth token available (length: {})", auth_token.as_ref().unwrap().len());
            }
            
            // Initialize the STT service client and transcribe the audio
            let stt_service = SttService::new();
            match stt_service.transcribe_audio(audio_data, auth_token).await {
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
/// Sets up the application with the following:
/// 1. Configures macOS activation policy to Accessory (app doesn't appear in Dock)
/// 2. Initializes and positions the pill overlay window at startup
/// 3. Starts global keyboard listener in background thread (rdev) to monitor Function key
/// 4. Spawns dedicated recording thread that responds to Function key press/release signals
/// 5. Configures window close behavior to hide instead of close (keeps app running for hotkeys)
/// 6. Registers Tauri commands for permissions, OAuth, text injection, and pill window control
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn main() {
    println!("🔧 Configuration loaded - API Base URL: {}", config::api_base_url());
    
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(OAuthState::default())
        .manage(AuthTokenState::default())
        .invoke_handler(tauri::generate_handler![
            request_microphone_permission,
            request_input_monitoring_permission,
            request_accessibility_permission,
            check_microphone_permission,
            check_input_monitoring_permission,
            check_accessibility_permission,
            inject_text,
            show_pill_window,
            toggle_pill_window,
            start_google_login,
            get_pkce_verifier,
            set_auth_token
        ])
        .setup(move |app| {
            // CRITICAL FIX FOR MACOS FLOATING WINDOWS
            // This policy allows the app to have accessory windows (like the pill)
            // that float above all spaces and do not clutter the Dock/App Switcher.
            // Must be set before getting the app handle to avoid borrow checker issues.
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                println!("🍎 Set macOS activation policy to Accessory (app will not appear in Dock)");
            }
            
            let app_handle = app.handle();
            
            // Initialize and position the pill window at the center of the screen
            // The window is created dynamically in Rust but shown at app startup
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
                                    
                                    // Show the pill window when recording starts (it's already created at startup)
                                    if let Some(pill_window) = app_handle_for_recording.get_webview_window("pill") {
                                        if let Err(e) = pill_window.show() {
                                            eprintln!("Failed to show pill window: {}", e);
                                        }
                                    }
                                    
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