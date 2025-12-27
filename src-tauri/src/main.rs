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
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, RunEvent};
use tokio::sync::watch;

// Module declarations for core functionality
mod audio_processor; // Audio processing and transcription orchestration
mod audio_recorder; // Audio capture from default microphone using cpal, converts to WAV format
mod commands;
mod config; // Application configuration (API base URL, OAuth redirect URI)
mod cursor_context; // Cursor context retrieval using macOS Accessibility API (AXUIElement)
mod global_key_listener; // Global keyboard event monitoring via rdev with configurable hotkey support
mod google_oauth; // Google OAuth 2.0 authentication flow with PKCE (Proof Key for Code Exchange)
mod permissions; // macOS permission requests and checks (microphone, input monitoring, accessibility)
mod pill; // Pill overlay window creation, positioning, and visibility management
mod recording_thread; // Recording thread management
mod state; // Application state management (auth tokens, transcription tasks, hotkey config)
mod stt_service; // HTTP client for Lexi AI Server API (speech-to-text transcription)
mod text_injector; // Text injection into active application via clipboard + paste keystroke
mod window; // Window management utilities (show, focus, activate) // Tauri commands organized by functionality

use global_key_listener::HotkeyConfig;
use google_oauth::OAuthState;
use recording_thread::spawn_recording_thread;
use state::{
    AuthTokenState, HotkeyRecordingState, HotkeyWatchState, LanguageState, TranscriptionTaskState,
};
use window::show_and_focus_main_window;

use permissions::{
    check_accessibility_permission, check_input_monitoring_permission, check_microphone_permission,
    request_accessibility_permission, request_input_monitoring_permission,
    request_microphone_permission,
};

use commands::auth::{get_pkce_verifier, set_auth_token, start_google_login};
use commands::config::set_language;
use commands::hotkey::{
    get_current_hotkey, start_hotkey_recording, stop_hotkey_recording, update_hotkey,
};
use commands::pill::{show_pill_window, toggle_pill_window};
use commands::text::inject_text;
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

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
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
    {
        builder = builder.plugin(devtools);
    }

    builder
        .manage(OAuthState::default())
        .manage(AuthTokenState::default())
        .manage(LanguageState::default())
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
            open_devtools,
            start_google_login,
            get_pkce_verifier,
            set_auth_token,
            set_language,
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
            global_key_listener::start_listener(
                app_handle.clone(),
                recording_tx,
                config_rx,
                recording_state_arc,
            );

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
