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
//!    (default: Function key) to start/stop audio recording system-wide
//! 2. **Audio Recording**: Captures audio from the default microphone using `cpal`
//!    (Cross-Platform Audio Library) and converts it to WAV format
//! 3. **Speech-to-Text Transcription**: Sends audio to Lexi AI Server API endpoint
//!    (server handles Groq's Whisper API integration internally)
//! 4. **Text Injection**: Injects transcribed text into the currently active application
//!    using clipboard + paste keystroke via keyboard_simulator module (Cmd+V on macOS, Ctrl+V elsewhere)
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
//! - **Input Monitoring**: For global keyboard event listening
//! - **Accessibility**: For text injection and cursor context retrieval

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{mpsc, Arc, Mutex};
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tokio::sync::watch;

// Module declarations for core functionality
mod actions; // Voice actions (triggered by hotkeys)
mod api_endpoints; // Centralized API endpoint definitions
mod assistant; // Recording thread management
mod audio;
mod commands;
mod config; // Application configuration (API base URL, OAuth redirect URI)
mod cursor_context; // Cursor context retrieval using macOS Accessibility API (AXUIElement)
mod global_key_listener; // Unified hotkey management
mod google_oauth; // Google OAuth 2.0 authentication flow with PKCE (Proof Key for Code Exchange)
mod keyboard_simulator; // Cross-platform keyboard simulation (copy/paste shortcuts)

mod permissions; // macOS permission requests and checks (microphone, input monitoring, accessibility)
mod pill; // Pill overlay window creation, positioning, and visibility management
mod room_websocket; // WebSocket connections for room streaming
mod secure_storage; // Secure storage using OS keychain for JWT tokens
mod shortcuts; // Voice command shortcuts that replace transcriptions with predefined values
#[cfg(target_os = "macos")]
mod sleep_watcher; // macOS sleep/wake detection to restart rdev listener
mod state; // Application state management (auth tokens, transcription tasks, hotkey config)
mod meetings; // Meetings module

mod text_injector; // Text injection into active application via clipboard + paste keystroke
mod titlebar; // Title bar customization (hide title, match background on macOS)
mod tray; // System tray icon creation and event handling
mod tts_service; // Text-to-speech service using ElevenLabs API
mod utils; // Utility functions for common operations
mod websocket; // WebSocket connections for OAuth flow
mod window; // Window management utilities (show, focus, activate) // Tauri commands organized by functionality


use audio::thread::spawn_recording_thread;
use global_key_listener::start_listener;
use google_oauth::OAuthState;

use state::{ActionHotkeyWatchState, HotkeyRecordingState, HotkeyWatchState, RoomState};
use window::show_and_focus_main_window;

use permissions::{
    check_accessibility_permission, check_input_monitoring_permission, check_microphone_permission,
    check_system_audio_permission, open_permission_pane, request_accessibility_permission,
    request_input_monitoring_permission, request_microphone_permission,
    request_system_audio_permission,
};

use actions::commands::{delete_action_history, get_action_history};
use assistant::commands::{delete_transcript, get_transcript, get_transcripts};
use commands::analytics::{get_analytics_chart, get_analytics_stats};
use commands::app_config::{get_app_config, update_app_config};
use commands::auth::{
    clear_auth_data, get_api_base_url, get_auth_data, get_auth_token, get_current_user,
    get_pkce_verifier, has_auth_data, logout, refresh_auth_token, start_google_login,
    store_auth_data,
};
use commands::hotkey::{
    get_current_hotkey, start_hotkey_recording, stop_hotkey_recording, update_hotkey,
};
use commands::notes::{create_note, delete_note, get_note, get_notes, update_note};
use commands::onboarding::{
    complete_onboarding, complete_server_onboarding, get_onboarding_state,
    get_server_onboarding_status, next_onboarding_step, previous_onboarding_step, reset_onboarding,
    set_onboarding_step,
};
use meetings::commands::{
    create_meeting, get_meeting_details, list_meetings, start_meeting_recording, 
    stop_meeting_recording, update_meeting, delete_meeting,
    summarize_meeting, send_meeting_chat
};
use commands::rooms::{
    create_room, get_room_details, list_rooms, start_room_recording,
    stop_room_recording_and_process, update_room, update_speaker,
};
use commands::shortcuts::{create_shortcut, delete_shortcut, get_shortcuts, update_shortcut};
use commands::text::inject_text;
use commands::utils::{copy_to_clipboard, get_system_type};
use commands::window::{open_devtools, show_main_window};
use websocket::{start_oauth_websocket, stop_oauth_websocket};

/// Command to control recording state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordingCommand {
    Start,             // Regular recording hotkey pressed
    Stop,              // Regular recording hotkey released
    ActionStart,       // Action hotkey pressed
    ActionStop,        // Action hotkey released
    SwitchToAction,    // Mode dynamically switched to Action
    SwitchToAssistant, // Mode dynamically switched to Assistant
}

/// State held so the global key listener can be started later (after permissions are granted).
/// This fixes Fn key not working on first install until app restart.
struct KeyListenerStartupState {
    inner: std::sync::Mutex<Option<KeyListenerParams>>,
}

struct KeyListenerParams {
    recording_tx: mpsc::Sender<RecordingCommand>,
    config_rx: watch::Receiver<Vec<String>>,
    action_hotkey_rx: watch::Receiver<Vec<String>>,
    recording_state: Arc<Mutex<bool>>,
    meeting_recording_rx: watch::Receiver<bool>,
}

/// Start the global key listener if not already started. Called by the frontend when the user
/// has completed the permissions step (or when app loads with onboarding already complete)
/// so that the Fn key works without requiring an app restart after granting Input Monitoring.
#[tauri::command]
fn start_global_key_listener(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<KeyListenerStartupState>();
    let mut guard = state
        .inner
        .lock()
        .map_err(|e| format!("lock error: {}", e))?;
    if let Some(params) = guard.take() {
        start_listener(
            app.clone(),
            params.recording_tx,
            params.config_rx,
            params.action_hotkey_rx,
            params.recording_state,
            params.meeting_recording_rx,
        );
        println!("✅ Global key listener started (Input Monitoring will now be used)");

        // Set up macOS sleep/wake watcher to restart the app after wake.
        // macOS destroys CGEventTap, stales HTTP sockets, and invalidates audio handles
        // during sleep — a full restart is the cleanest way to recover.
        #[cfg(target_os = "macos")]
        sleep_watcher::start_watcher(app.clone());
    }
    Ok(())
}

/// Main entry point for the Tauri application
///
/// Sets up the application with the following:
/// 1. Uses default Regular activation policy (app appears in Dock like normal macOS app)
/// 2. Initializes pill overlay window with NSPanel for floating above fullscreen apps
/// 3. Starts global keyboard listener in background thread to monitor Function key
/// 4. Spawns dedicated recording thread that responds to Function key press/release signals
/// 5. Configures window close behavior to hide instead of close (keeps app running for hotkeys)
/// 6. Registers Tauri commands for permissions, OAuth, text injection, and pill window control
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn main() {
    println!(
        "🔧 Configuration loaded - API Base URL: {}",
        config::api_base_url()
    );

    let mut builder = tauri::Builder::default();

    // Add tauri-nspanel plugin on macOS for advanced NSPanel features
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            println!("🔄 Second instance launch detected (e.g., from Spotlight or app icon)");
            show_and_focus_main_window(app.app_handle());

            // Minimal backup retry
            let app_handle = app.app_handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(200));
                if !show_and_focus_main_window(&app_handle) {
                    eprintln!("❌ Backup show failed!");
                }
            });
        }));

    builder
        .manage(OAuthState::default())
        .invoke_handler(tauri::generate_handler![
            request_microphone_permission,
            request_input_monitoring_permission,
            request_accessibility_permission,
            open_permission_pane,
            check_microphone_permission,
            check_input_monitoring_permission,
            check_accessibility_permission,
            check_system_audio_permission,
            request_system_audio_permission,
            inject_text,
            open_devtools,
            show_main_window,
            start_google_login,
            get_pkce_verifier,
            update_hotkey,
            get_current_hotkey,
            start_hotkey_recording,
            stop_hotkey_recording,
            store_auth_data,
            get_auth_data,
            clear_auth_data,
            has_auth_data,
            get_auth_token,
            get_api_base_url,
            get_current_user,
            logout,
            refresh_auth_token,
            get_app_config,
            update_app_config,
            get_system_type,
            copy_to_clipboard,
            get_transcripts,
            get_transcript,
            delete_transcript,
            get_analytics_stats,
            get_analytics_chart,
            get_action_history,
            delete_action_history,
            get_shortcuts,
            create_shortcut,
            update_shortcut,
            delete_shortcut,
            start_oauth_websocket,
            stop_oauth_websocket,
            get_onboarding_state,
            get_server_onboarding_status,
            complete_server_onboarding,
            set_onboarding_step,
            next_onboarding_step,
            previous_onboarding_step,
            complete_onboarding,
            reset_onboarding,
            get_notes,
            get_note,
            create_note,
            update_note,
            delete_note,
            create_room,
            list_rooms,
            get_room_details,
            start_room_recording,
            stop_room_recording_and_process,
            update_room,
            update_speaker,
            create_meeting,
            list_meetings,
            get_meeting_details,
            start_meeting_recording,
            stop_meeting_recording,
            update_meeting,
            delete_meeting,
            summarize_meeting,
            send_meeting_chat,
            start_global_key_listener,
        ])
        .setup(move |app| {
            // Create system tray first to avoid borrow checker issues
            let start_meeting_menu_item = tray::init_system_tray(app)?;

            if let Some(window) = app.get_webview_window("main") {
                titlebar::apply_to_window(&window);
            }

            let app_handle = app.handle();

            // Handle deep links
            // Check if app was started via deep link
            if let Ok(Some(start_urls)) = app.deep_link().get_current() {
                println!("🔗 App started via deep link: {:?}", start_urls);
                // Show and focus the main window when opened via deep link
                show_and_focus_main_window(app_handle);
            }

            // Listen for deep links when app is already running
            let app_handle_clone = app_handle.clone();
            app.deep_link().on_open_url(move |event| {
                println!("🔗 Deep link received: {:?}", event.urls());
                // Show and focus the main window when deep link is received
                show_and_focus_main_window(&app_handle_clone);
            });

            // Refresh auth token on app startup (background task)
            // This ensures tokens are fresh before the user interacts with the app
            let app_handle_for_auth = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                use commands::auth::get_auth_token_async;
                println!("🔑 Checking auth token on startup...");
                match get_auth_token_async(&app_handle_for_auth).await {
                    Ok(_) => println!("✅ Auth token valid on startup"),
                    Err(_) => println!("ℹ️  No valid auth token - user needs to login"),
                }
            });

            // Initialize and position the pill window at the center of the screen
            // The window is created dynamically in Rust but shown at app startup
            if let Err(e) = pill::init_pill_window(app_handle.clone()) {
                eprintln!("Failed to initialize pill window: {}", e);
            }

            // Channel to communicate with the recording thread
            // Sender is used by key listener to signal start/stop, receiver is used in the recording thread
            let (recording_tx, recording_rx) = mpsc::channel::<RecordingCommand>();



            // Initialize hotkey channels with empty default states to avoid blocking startup.
            let (config_tx, config_rx) = watch::channel(Vec::new());
            let (action_hotkey_tx, action_hotkey_rx) = watch::channel(Vec::new());
            let (meeting_recording_tx, meeting_recording_rx) = watch::channel(false);

            // Create recording state and manage it
            let recording_state_arc = Arc::new(Mutex::new(false));
            app.manage(HotkeyWatchState(config_tx));
            app.manage(ActionHotkeyWatchState(action_hotkey_tx));
            app.manage(HotkeyRecordingState {
                is_recording: recording_state_arc.clone(),
            });

            app.manage(RoomState {
                is_recording: Mutex::new(false),
                command_tx: Mutex::new(None),
            });

            app.manage(crate::state::MeetingState {
                is_recording: Mutex::new(false),
                command_tx: Mutex::new(None),
                system_stop_tx: Mutex::new(None),
                meeting_ws_text_tx: Mutex::new(None),
                tray_start_meeting: Mutex::new(Some(start_meeting_menu_item)),
                meeting_recording_tx: Mutex::new(meeting_recording_tx),
            });

            // Fetch config in background after state is managed to ensure channels get updated
            let app_handle_for_config = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                println!("🔄 Background task: Fetching config from server...");
                if let Err(e) = get_app_config(app_handle_for_config).await {
                    println!("⚠️  Server config unavailable on startup: {}", e);
                }
            });

            // Defer starting the key listener until the frontend calls start_global_key_listener
            // (after permissions step or when onboarding already complete). This ensures the
            // Fn key works on first install without requiring an app restart after granting
            // Input Monitoring.
            app.manage(KeyListenerStartupState {
                inner: std::sync::Mutex::new(Some(KeyListenerParams {
                    recording_tx: recording_tx.clone(),
                    config_rx,
                    action_hotkey_rx,
                    recording_state: recording_state_arc,
                    meeting_recording_rx,
                })),
            });

            #[cfg(desktop)]
            {
                // Spawn the unified recording thread
                spawn_recording_thread(app_handle.clone(), recording_rx);
                
                // Start background meeting detector
                meetings::detector::start_meeting_detector(app_handle.clone());
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Handle window events for all windows
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Only hide the main window instead of closing it
                    // This keeps the app running in the background so hotkeys continue to work
                    if window.label() == "main" {
                        api.prevent_close();
                        if let Err(e) = window.hide() {
                            eprintln!("Failed to hide window: {}", e);
                        } else {
                            println!(
                                "Window hidden - app continues running in background. Hotkeys will still work."
                            );
                            // Emit event to frontend for cleanup
                            let _ = window.emit("window-hide", ());
                        }
                    }
                }
                tauri::WindowEvent::Focused(focused) => {
                    if window.label() == "main" && *focused {
                        println!("🔍 Main window received focus event");
                        let is_visible = window.is_visible().unwrap_or(false);
                        if !is_visible {
                            show_and_focus_main_window(window.app_handle());
                        } else {
                            // Already visible, just refocus
                            let _ = window.set_focus();
                        }
                    }
                }

                _ => {}
            }
        })
        .on_page_load(|webview, _| {
            let window = webview.window();
            if window.label() == "main" {
                // Only show/focus if window is not already visible to prevent reload loops
                let is_visible = window.is_visible().unwrap_or(false);
                if !is_visible {
                    println!("📄 Page loaded for main window, ensuring visibility...");
                    let app_handle = window.app_handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        show_and_focus_main_window(&app_handle);
                    });
                } else {
                    println!("📄 Page loaded for main window (already visible, skipping show/focus)");
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Reopen { has_visible_windows, .. } = event {
                println!(
                    "🍎 RunEvent::Reopen triggered (has_visible_windows: {})",
                    has_visible_windows
                );
                show_and_focus_main_window(app_handle);
            }
        });
}
