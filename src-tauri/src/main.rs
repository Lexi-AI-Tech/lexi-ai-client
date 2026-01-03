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
//! - **Input Monitoring**: For global keyboard event listening (rdev)
//! - **Accessibility**: For text injection and cursor context retrieval

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{mpsc, Arc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tokio::sync::watch;

// Module declarations for core functionality
mod actions; // Voice actions triggered by action trigger phrase (e.g., "Hey Lexi")
mod audio_processor; // Audio processing and transcription orchestration
mod audio_recorder; // Audio capture from default microphone using cpal, converts to WAV format
mod commands;
mod config; // Application configuration (API base URL, OAuth redirect URI)
mod cursor_context; // Cursor context retrieval using macOS Accessibility API (AXUIElement)
mod global_key_listener; // Unified hotkey management (rdev for Fn key, Tauri shortcuts for others)
mod google_oauth; // Google OAuth 2.0 authentication flow with PKCE (Proof Key for Code Exchange)
mod keyboard_simulator; // Cross-platform keyboard simulation (copy/paste shortcuts)
mod permissions; // macOS permission requests and checks (microphone, input monitoring, accessibility)
mod pill; // Pill overlay window creation, positioning, and visibility management
mod recording_thread; // Recording thread management
mod secure_storage; // Secure storage using OS keychain for JWT tokens
mod shortcuts; // Voice command shortcuts that replace transcriptions with predefined values
mod state; // Application state management (auth tokens, transcription tasks, hotkey config)
mod stt_service; // HTTP client for Lexi AI Server API (speech-to-text transcription)
mod text_injector; // Text injection into active application via clipboard + paste keystroke
mod utils; // Utility functions for common operations
mod whisper; // Local Whisper model integration for offline transcription

use whisper::preload_model;
mod window; // Window management utilities (show, focus, activate) // Tauri commands organized by functionality

use global_key_listener::{HotkeyConfig, register_hotkeys, unregister_all_hotkeys};
use google_oauth::OAuthState;
use recording_thread::spawn_recording_thread;
use state::{HotkeyRecordingState, HotkeyWatchState, RecordingChannelState, TranscriptionTaskState};
use window::show_and_focus_main_window;

use permissions::{
    check_accessibility_permission, check_input_monitoring_permission, check_microphone_permission,
    check_screen_recording_permission, request_accessibility_permission,
    request_input_monitoring_permission, request_microphone_permission,
    request_screen_recording_permission,
};

use commands::app_config::{get_app_config, update_app_config, AppConfig};
use commands::auth::{
    clear_auth_data, get_auth_data, get_pkce_verifier, has_auth_data, start_google_login,
    store_auth_data,
};
use commands::hotkey::{
    get_current_hotkey, start_hotkey_recording, stop_hotkey_recording, update_hotkey,
};
use commands::pill::{show_pill_window, toggle_pill_window};
use commands::text::inject_text;
use commands::utils::get_system_type;
use commands::window::open_devtools;

/// Command to control recording state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordingCommand {
    Start,
    Stop,
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
    println!(
        "🔧 Configuration loaded - API Base URL: {}",
        config::api_base_url()
    );

    // Initialize CrabNebula DevTools (only in debug builds)
    // This should be called as early in the execution of the app as possible
    #[cfg(debug_assertions)]
    let devtools = tauri_plugin_devtools::init();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // Only handle press events for toggle behavior
                    if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        return;
                    }

                    println!("🔑 Global shortcut triggered: {:?}", shortcut);

                    // Get the recording channel from app state
                    let app_handle = app.app_handle();
                    let recording_state = app_handle.state::<RecordingChannelState>();
                    
                    // Check current recording state and toggle
                    let is_currently_recording = recording_state
                        .is_recording
                        .lock()
                        .ok()
                        .map(|guard| *guard)
                        .unwrap_or(false);

                    let command = if is_currently_recording {
                        RecordingCommand::Stop
                    } else {
                        RecordingCommand::Start
                    };

                    if let Ok(tx_guard) = recording_state.tx.lock() {
                        if let Some(ref tx) = *tx_guard {
                            if let Err(e) = tx.send(command) {
                                eprintln!("Failed to send recording command: {:?}", e);
                            } else {
                                println!("✅ Sent {:?} command via global shortcut", command);
                            }
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            #[cfg(target_os = "macos")]
            {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            println!("🔄 Second instance launch detected (e.g., from Spotlight or app icon)");
            show_and_focus_main_window(&app.app_handle());

            // Minimal backup retry
            let app_handle = app.app_handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(200));
                if !show_and_focus_main_window(&app_handle) {
                    eprintln!("❌ Backup show failed!");
                }
            });
        }));

    // Add CrabNebula DevTools plugin (only in debug builds)
    #[cfg(debug_assertions)]
    let builder = builder.plugin(devtools);

    builder
        .manage(OAuthState::default())
        .manage(TranscriptionTaskState {
            task_handle: Mutex::new(None),
            cancel_tx: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            request_microphone_permission,
            request_input_monitoring_permission,
            request_accessibility_permission,
            request_screen_recording_permission,
            check_microphone_permission,
            check_input_monitoring_permission,
            check_accessibility_permission,
            check_screen_recording_permission,
            inject_text,
            show_pill_window,
            toggle_pill_window,
            open_devtools,
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
            get_app_config,
            update_app_config,
            get_system_type
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

            // Handle deep links
            // Check if app was started via deep link
            if let Ok(Some(start_urls)) = app.deep_link().get_current() {
                println!("🔗 App started via deep link: {:?}", start_urls);
                // Show and focus the main window when opened via deep link
                show_and_focus_main_window(&app_handle);
            }

            // Listen for deep links when app is already running
            let app_handle_clone = app_handle.clone();
            app.deep_link().on_open_url(move |event| {
                println!("🔗 Deep link received: {:?}", event.urls());
                // Show and focus the main window when deep link is received
                show_and_focus_main_window(&app_handle_clone);
            });

            // Preload Whisper model in background to reduce first transcription latency
            std::thread::spawn(move || {
                if let Err(e) = preload_model() {
                    eprintln!("⚠️  Warning: Failed to preload Whisper model: {}", e);
                    eprintln!("💡 First transcription may be slower");
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

            // Load hotkeys from Tauri Store
            // Use default if store is not available or doesn't have hotkeys
            let initial_config = {
                let app_handle_for_store = app_handle.clone();
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async {
                    match get_app_config(app_handle_for_store).await {
                        Ok(config) => {
                            let hotkeys = config.transcription_hotkeys
                                .unwrap_or_else(|| vec!["Fn".to_string()]);
                            HotkeyConfig { hotkeys }
                        }
                        Err(_) => {
                            println!("⚠️  Failed to load hotkeys from store, using default");
                            HotkeyConfig {
                                hotkeys: vec!["Fn".to_string()],
                            }
                        }
                    }
                })
            };
            
            println!("🔑 Loaded hotkeys from store: {:?}", initial_config.hotkeys);
            let (config_tx, config_rx) = watch::channel(initial_config.clone());

            // Create recording state and manage it
            let recording_state_arc = Arc::new(Mutex::new(false));
            app.manage(HotkeyWatchState(config_tx));
            app.manage(HotkeyRecordingState {
                is_recording: recording_state_arc.clone(),
            });
            let recording_state_tracker = Arc::new(Mutex::new(false));
            app.manage(RecordingChannelState {
                tx: Arc::new(Mutex::new(Some(recording_tx.clone()))),
                is_recording: recording_state_tracker.clone(),
            });
            
            // Listen to recording events to update state tracker
            let app_handle_for_events = app_handle.clone();
            let recording_state_tracker_clone = recording_state_tracker.clone();
            app_handle.listen("recording_started", move |_| {
                if let Ok(mut state) = recording_state_tracker_clone.lock() {
                    *state = true;
                }
            });
            let recording_state_tracker_clone2 = recording_state_tracker.clone();
            app_handle_for_events.listen("recording_stopped", move |_| {
                if let Ok(mut state) = recording_state_tracker_clone2.lock() {
                    *state = false;
                }
            });

            // Start the global input listener (rdev) in a background thread for Fn key only
            // Pass the channel sender and config receiver so it can trigger recording on hotkey press/release
            global_key_listener::start_listener(
                app_handle.clone(),
                recording_tx.clone(),
                config_rx,
                recording_state_arc,
            );

            // Register Tauri global shortcuts (will fall back to rdev if needed)
            let tauri_hotkeys = initial_config.tauri_hotkeys();
            if !tauri_hotkeys.is_empty() {
                match register_hotkeys(&app_handle, &tauri_hotkeys) {
                    Ok(rdev_fallback) => {
                        if !rdev_fallback.is_empty() {
                            println!("ℹ️  {} hotkey(s) will be handled by rdev: {:?}", rdev_fallback.len(), rdev_fallback);
                        }
                    }
                    Err(e) => {
                        eprintln!("⚠️  Failed to register initial global shortcuts: {}", e);
                    }
                }
            }

            // Create system tray with menu
            let show_item = MenuItem::with_id(app, "show", "Show App", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            // Get the default window icon for the tray
            let tray_icon = app.default_window_icon().ok_or_else(|| {
                eprintln!("⚠️  Warning: Default window icon not found, tray icon may not display correctly");
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Default window icon not available",
                )
            })?;

            // Create the tray icon
            let _tray = TrayIconBuilder::with_id("main")
                .icon(tray_icon.clone())
                .tooltip("Lexi AI")
                .menu(&tray_menu)
                .on_menu_event(move |app, event| {
                    let event_id = event.id.as_ref().to_string();
                    println!("📋 Tray menu event: {}", event_id);

                    if event_id == "show" {
                        show_and_focus_main_window(&app);
                    } else if event_id == "quit" {
                        println!("👋 Quitting application");
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // Handle left-click on tray icon to show/hide window
                    if let TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                println!("🔄 Hiding window via tray click");
                                if let Err(e) = window.hide() {
                                    eprintln!("❌ Failed to hide window: {}", e);
                                } else {
                                    println!("✅ Window hidden via tray click");
                                }
                            } else {
                                show_and_focus_main_window(&app);
                            }
                        }
                    }
                })
                .build(app)?;

            println!("🎯 System tray created successfully");

            #[cfg(desktop)]
            {
                // Spawn the dedicated recording thread
                spawn_recording_thread(app_handle.clone(), recording_rx);
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
                        #[cfg(target_os = "macos")]
                        {
                            let _ = window
                                .app_handle()
                                .set_activation_policy(tauri::ActivationPolicy::Accessory);
                        }
                        let is_visible = window.is_visible().unwrap_or(false);
                        if !is_visible {
                            show_and_focus_main_window(&window.app_handle());
                        } else {
                            // Already visible, just refocus
                            let _ = window.set_focus();
                        }
                    }
                }
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    // Re-apply activation policy on window interactions to ensure Dock stays hidden
                    #[cfg(target_os = "macos")]
                    if window.label() == "main" {
                        let _ = window
                            .app_handle()
                            .set_activation_policy(tauri::ActivationPolicy::Accessory);
                    }
                }
                _ => {}
            }
        })
        .on_page_load(|webview, _| {
            let window = webview.window();
            if window.label() == "main" {
                println!("📄 Page loaded for main window, ensuring visibility...");
                let app_handle = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    show_and_focus_main_window(&app_handle);
                });
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                RunEvent::Reopen { has_visible_windows, .. } => {
                    println!(
                        "🍎 RunEvent::Reopen triggered (has_visible_windows: {})",
                        has_visible_windows
                    );
                    show_and_focus_main_window(app_handle);
                }
                _ => {}
            }
        });
}
