//! Lexi AI Client - Main Application Entry Point
//!
//! This is the main entry point for the Lexi AI Tauri application, a voice-to-text desktop app
//! that enables users to record audio and have it automatically transcribed and inserted into
//! any active text field using a global hotkey.
//!
//! ## Core Functionality
//!
//! The application provides the following features:
//!
//! 1. **Global Hotkey Monitoring**: Listens for configurable hotkey press/release events
//!    (default: Function key) via `rdev` to start/stop audio recording system-wide
//! 2. **Audio Recording**: Captures audio from the default microphone using `cpal`
//!    (Cross-Platform Audio Library) and converts it to WAV format
//! 3. **Speech-to-Text Transcription**: Sends audio to Lexi AI Server API endpoint
//!    (server handles Groq's Whisper API integration internally)
//! 4. **Text Injection**: Injects transcribed text into the currently active application
//!    using clipboard + paste keystroke (Cmd+V on macOS, Ctrl+V elsewhere)
//! 5. **Pill Overlay Window**: Manages a small transparent overlay window that displays
//!    recording status and floats above all windows
//! 6. **Google OAuth Authentication**: Handles user authentication via Google OAuth 2.0
//!    with PKCE (Proof Key for Code Exchange) for secure token exchange
//! 7. **Cursor Context Retrieval**: Retrieves text context at cursor position using
//!    macOS Accessibility API (for future context-aware features)
//!
//! ## Architecture
//!
//! - **Frontend**: React + TypeScript UI for settings and status display
//! - **Backend**: Rust + Tauri for system-level operations (audio, hotkeys, text injection)
//! - **Server**: Lexi AI Server (separate service) handles transcription via Groq API
//!
//! ## Permissions Required (macOS)
//!
//! - **Microphone**: For audio recording
//! - **Input Monitoring**: For global keyboard event listening (rdev)
//! - **Accessibility**: For text injection and cursor context retrieval

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{mpsc, Arc, Mutex};
use std::thread;

use tauri::{AppHandle, Manager, Emitter};
use tokio::sync::watch;
use serde_json;

// Module declarations for core functionality
mod audio_recorder;      // Audio capture from default microphone using cpal, converts to WAV format
mod stt_service;         // HTTP client for Lexi AI Server API (speech-to-text transcription)
mod text_injector;       // Text injection into active application via clipboard + paste keystroke
mod global_key_listener; // Global keyboard event monitoring via rdev with configurable hotkey support
mod permissions;         // macOS permission requests and checks (microphone, input monitoring, accessibility)
mod pill;                // Pill overlay window creation, positioning, and visibility management
mod cursor_context;      // Cursor context retrieval using macOS Accessibility API (AXUIElement)
mod google_oauth;        // Google OAuth 2.0 authentication flow with PKCE (Proof Key for Code Exchange)
mod config;              // Application configuration (API base URL, OAuth redirect URI)

use audio_recorder::AudioRecorder;
use stt_service::SttService;
use text_injector::TextInjector;
use global_key_listener::HotkeyConfig;

use permissions::{
    request_accessibility_permission,
    request_input_monitoring_permission,
    request_microphone_permission,
    check_accessibility_permission,
    check_input_monitoring_permission,
    check_microphone_permission,
};

use google_oauth::{OAuthState, start_google_login, get_pkce_verifier};

/// Command to control recording state
#[derive(Debug, Clone, Copy)]
pub enum RecordingCommand {
    Start,
    Stop,
}

/// Auth token state for storing the current access token
#[derive(Default)]
struct AuthTokenState {
    token: Mutex<Option<String>>,
}

/// Transcription task state for managing abort handles
/// This allows canceling ongoing transcriptions when a new one starts
struct TranscriptionTaskState {
    task_handle: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    cancel_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

/// State for watch sender (to broadcast config changes)
struct HotkeyWatchState(watch::Sender<HotkeyConfig>);

/// Hotkey recording state - tracks if we're in recording mode for hotkey selection
struct HotkeyRecordingState {
    is_recording: Arc<Mutex<bool>>,
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

/// Update the hotkey configuration dynamically
/// 
/// This command allows the frontend to change the hotkey that triggers recording.
/// The listener will automatically restart with the new configuration.
/// 
/// # Arguments
/// * `config_json` - JSON string representation of HotkeyConfig
/// 
/// # Returns
/// * `Ok(())` - Successfully updated the hotkey
/// * `Err(String)` - An error message if parsing failed or update failed
#[tauri::command]
fn update_hotkey(config_json: String, app: AppHandle, state: tauri::State<HotkeyWatchState>) -> Result<(), String> {
    // Parse JSON to HotkeyConfig
    let new_config: HotkeyConfig = serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse hotkey config: {}", e))?;

    if state.0.send(new_config.clone()).is_err() {
        return Err("Failed to update hotkey config".to_string());
    }
    
    // Emit the config back as JSON for UI display
    app.emit("hotkey-updated", &config_json).unwrap_or_default();
    println!("🔑 Hotkey updated to: {:?}", new_config);
    Ok(())
}

/// Get the current hotkey configuration
/// 
/// # Returns
/// * `String` - JSON string representation of the current HotkeyConfig
#[tauri::command]
fn get_current_hotkey(state: tauri::State<HotkeyWatchState>) -> String {
    let config = state.0.borrow().clone();
    serde_json::to_string(&config).unwrap_or_else(|_| "{}".to_string())
}

/// Start hotkey recording mode - enables key event emission for hotkey selection
#[tauri::command]
fn start_hotkey_recording(state: tauri::State<HotkeyRecordingState>) {
    if let Ok(mut recording) = state.is_recording.lock() {
        *recording = true;
        println!("🎹 Started hotkey recording mode");
    }
}

/// Stop hotkey recording mode
#[tauri::command]
fn stop_hotkey_recording(state: tauri::State<HotkeyRecordingState>) {
    if let Ok(mut recording) = state.is_recording.lock() {
        *recording = false;
        println!("🎹 Stopped hotkey recording mode");
    }
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
/// 1. Aborting any ongoing transcription task
/// 2. Getting the authentication token from AuthTokenState
/// 3. Sending the WAV audio data to Lexi AI Server API for transcription
/// 4. Injecting the transcribed text into the active application using TextInjector
/// 5. Emitting events to the frontend to update UI state (processing_start, transcription_success, etc.)
/// 
/// This function uses tokio to spawn async tasks with abort handles for cancellation support.
fn process_audio(audio_data: Vec<u8>, app_handle: AppHandle) {
    // Clone app_handle for use in the task and for storing abort handle
    let app_handle_for_task = app_handle.clone();
    
    // Create cancellation channel for this request
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
    
    // Abort any ongoing transcription task and send cancellation signal
    if let Some(state) = app_handle.try_state::<TranscriptionTaskState>() {
        if let Ok(mut handle_guard) = state.task_handle.lock() {
            if let Some(handle) = handle_guard.take() {
                println!("🛑 Aborting previous transcription task");
                handle.abort();
            }
        }
        // Send cancellation signal to cancel the HTTP request
        if let Ok(mut cancel_guard) = state.cancel_tx.lock() {
            if let Some(old_cancel_tx) = cancel_guard.take() {
                let _ = old_cancel_tx.send(());
                println!("🛑 Sent cancellation signal to previous HTTP request");
            }
        }
        // Store the new cancellation sender
        if let Ok(mut cancel_guard) = state.cancel_tx.lock() {
            *cancel_guard = Some(cancel_tx);
        }
    }
    
    // Spawn a new transcription task using Tauri's async runtime
    // This returns a JoinHandle that we can use to abort the task
    let task = tauri::async_runtime::spawn(async move {
        println!("Processing audio, size: {} bytes", audio_data.len());
        
        // Notify frontend that transcription has started
        app_handle_for_task.emit("processing_start", ()).unwrap_or_default();
        
        // Get authentication token from state
        let auth_token = if let Some(state) = app_handle_for_task.try_state::<AuthTokenState>() {
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
        // The cancellation receiver is passed to the service to allow cancelling the HTTP request
        let stt_service = SttService::new();
        let transcription_result = stt_service.transcribe_audio(audio_data, auth_token, Some(cancel_rx)).await;
        
        // Check if the task was aborted (the JoinHandle will be cancelled)
        // If aborted, the result will be an error, but we should check for cancellation
        match transcription_result {
            Ok(transcription) => {
                println!("Transcription: {}", transcription);
                
                // Notify frontend of successful transcription
                app_handle_for_task.emit("transcription_success", &transcription).unwrap_or_default();
                
                // Only inject text if transcription is not empty
                if !transcription.trim().is_empty() {
                    let injector = TextInjector::new();
                    match injector.inject_text(&transcription) {
                        Ok(_) => {
                            // Successfully injected text into active application
                            app_handle_for_task.emit("injection_success", ()).unwrap_or_default();
                        }
                        Err(e) => {
                            eprintln!("Failed to inject text: {}", e);
                            // Notify frontend of injection failure
                            app_handle_for_task.emit("injection_error", e.to_string()).unwrap_or_default();
                        }
                    }
                }
            }
            Err(e) => {
                // Check if this is a cancellation error
                let error_msg = e.to_string();
                if error_msg.contains("cancelled") || error_msg.contains("aborted") {
                    println!("🛑 Transcription was cancelled");
                    // Don't emit error event for cancellation - it's expected
                    return;
                }
                
                eprintln!("Transcription failed: {}", e);
                // Notify frontend of transcription failure
                app_handle_for_task.emit("transcription_error", error_msg).unwrap_or_default();
            }
        }
    });
    
    // Store the task handle in state for future cancellation
    if let Some(state) = app_handle.try_state::<TranscriptionTaskState>() {
        if let Ok(mut handle_guard) = state.task_handle.lock() {
            *handle_guard = Some(task);
        }
    }
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
        .manage(TranscriptionTaskState {
            task_handle: Mutex::new(None),
            cancel_tx: Mutex::new(None),
        })
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
            set_auth_token,
            update_hotkey,
            get_current_hotkey,
            start_hotkey_recording,
            stop_hotkey_recording
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
            let (recording_tx, recording_rx) = mpsc::channel::<RecordingCommand>();
            
            // Create watch channel with initial config (Function key default)
            let initial_config = HotkeyConfig {
                hotkey: "Fn".to_string(),
            };
            let (config_tx, config_rx) = watch::channel(initial_config);
            
            // Create recording state and manage it
            let recording_state_arc = Arc::new(Mutex::new(false));
            app.manage(HotkeyWatchState(config_tx));
            app.manage(HotkeyRecordingState {
                is_recording: recording_state_arc.clone(),
            });
            
            // Start the global input listener (rdev) in a background thread
            // Pass the channel sender and config receiver so it can trigger recording on hotkey press/release
            global_key_listener::start_listener(app_handle.clone(), recording_tx, config_rx, recording_state_arc);

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
                            Ok(RecordingCommand::Start) => {
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
                            Ok(RecordingCommand::Stop) => {
                                // Stop recording (Function key released)
                                if let Some(mut rec) = recorder.take() {
                                    println!("Function key (fn) released - Stopping recording in dedicated thread...");
                                    
                                    match rec.stop_recording() {
                                        Ok(audio_data) => {
                                            app_handle_for_recording.emit("recording_stopped", ()).unwrap_or_default();
                                            // Process the audio using Tauri's async runtime
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