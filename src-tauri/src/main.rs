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
//! - **Accessibility**: For text injection and cursor context retrieval

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::AtomicBool;
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
#[cfg(target_os = "macos")]
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "macos")]
static KEY_LISTENER_DISABLED_LOG_MS: AtomicU64 = AtomicU64::new(0);
#[cfg(target_os = "macos")]
static KEY_LISTENER_HARD_RESET_MS: AtomicU64 = AtomicU64::new(0);
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tokio::sync::watch;

// Module declarations for core functionality
mod actions; // Voice actions (triggered by hotkeys)
mod api_endpoints; // Centralized API endpoint definitions
mod app_icon; // `app_icon/` — platform app icons (macOS, Windows)
mod assistant; // Recording thread management
mod audio;
mod commands;
mod config; // Application configuration (API base URL, OAuth redirect URI)
mod cursor_context; // Cursor context retrieval using macOS Accessibility API (AXUIElement)
mod global_key_listener; // Unified hotkey management
mod google_oauth; // Google OAuth 2.0 authentication flow with PKCE (Proof Key for Code Exchange)
mod keyboard_simulator; // Cross-platform keyboard simulation (copy/paste shortcuts)

mod meetings;
mod os_permissions; // macOS permission requests and checks (microphone, accessibility, system audio)
mod pill; // Pill overlay window creation, positioning, and visibility management
mod room_websocket; // WebSocket connections for room streaming
mod secure_storage; // Secure storage using OS keychain for JWT tokens
#[cfg(target_os = "macos")]
mod sleep_watcher; // macOS sleep/wake detection to restart rdev listener
mod state; // Application state management (auth tokens, transcription tasks, hotkey config) // Meetings module

mod text_injector; // Text injection into active application via clipboard + paste keystroke
mod titlebar; // Title bar: macOS tint, Windows frameless + shadow
mod tray; // System tray icon creation and event handling
mod tts_service; // Text-to-speech service using ElevenLabs API
mod utils; // Utility functions for common operations
mod websocket; // WebSocket connections for OAuth flow
mod window; // Window management utilities (show, focus, activate) // Tauri commands organized by functionality

use audio::thread::spawn_recording_thread;
use global_key_listener::start_listener;
use google_oauth::OAuthState;

use state::{
    ActionHotkeyWatchState, HotkeyRecordingState, HotkeyWatchState, MeetingState,
    OnboardingRecordingDryRun, RoomState,
};
use window::show_and_focus_main_window;

use os_permissions::{
    check_accessibility_permission, check_microphone_permission, check_system_audio_permission,
    open_permission_pane, request_accessibility_permission, request_microphone_permission,
    request_system_audio_permission,
};

use actions::commands::{delete_action_history, get_action_history};
use app_icon::get_app_icon;
use assistant::commands::{delete_transcript, get_transcript, get_transcripts};
use commands::analytics::{get_analytics_chart, get_analytics_stats};
use commands::app_config::{
    begin_onboarding_hotkey_dry_run, end_onboarding_hotkey_dry_run, get_app_config,
    get_default_hotkeys, update_app_config,
};
use commands::auth::{
    auth_get_state, clear_auth_data, get_api_base_url, get_auth_data, get_auth_token,
    get_current_user, get_pkce_verifier, has_auth_data, logout, refresh_auth_token,
    start_google_login, store_auth_data,
};
use commands::billing::{
    cancel_billing_subscription, create_billing_checkout, get_billing_usage,
    get_current_subscription,
};
use commands::cache::user_cache_warmup;
use commands::docs::{
    create_doc, create_doc_from_audio, delete_doc, get_doc, get_docs, start_doc_recording,
    stop_doc_recording, update_doc,
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
use commands::rooms::{
    create_room, get_room_details, list_rooms, start_room_recording,
    stop_room_recording_and_process, update_room, update_speaker,
};
use commands::shortcuts::{create_shortcut, delete_shortcut, get_shortcuts, update_shortcut};
use commands::text::inject_text;
use commands::utils::{copy_to_clipboard, get_system_type, open_external_url};
use commands::window::{open_devtools, show_main_window};
use meetings::commands::{
    add_meeting_note, create_doc_from_meeting, create_meeting, delete_meeting,
    dismiss_meeting_end_check_prompt, end_meeting_session, get_meeting_details,
    get_meeting_suggested_questions, list_meetings, send_meeting_chat, start_meeting_recording,
    stop_meeting_recording, stream_meeting_summary, update_meeting,
};
use websocket::{start_oauth_websocket, stop_oauth_websocket};

/// Command to control recording state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordingCommand {
    Start,             // Regular recording hotkey pressed
    Stop,              // Regular recording hotkey released
    ActionStart,       // Action hotkey pressed
    ActionStop,        // Action hotkey released
    DocStart,          // Start recording for doc (from Docs UI mic button)
    DocStop,           // Stop recording for doc and emit transcript
    SwitchToAction,    // Mode dynamically switched to Action
    SwitchToAssistant, // Mode dynamically switched to Assistant
}

/// Shared sender for recording commands (used by key listener and by doc recording commands).
pub struct RecordingCommandTx(pub mpsc::Sender<RecordingCommand>);

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

/// Start the global key listener if not already started. Called by the frontend when onboarding
/// is complete so hotkeys work without requiring an app restart after deferred startup.
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
        println!("✅ Global key listener started");

        // Set up macOS sleep/wake watcher to restart the app after wake.
        // macOS destroys CGEventTap, stales HTTP sockets, and invalidates audio handles
        // during sleep — a full restart is the cleanest way to recover.
        #[cfg(target_os = "macos")]
        sleep_watcher::start_watcher(app.clone());

        // Watchdog: recover when macOS disables the CGEventTap (`CGEventTapIsEnabled == false`).
        // We intentionally do *not* use "time since last keyboard event" — that false-alarms when
        // the user is mouse-only or simply not typing.
        #[cfg(target_os = "macos")]
        {
            tauri::async_runtime::spawn(async move {
                use tokio::time::{interval, Duration};

                fn epoch_ms() -> u64 {
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0)
                }

                const TICK_SECS: u64 = 30;
                const DISABLED_LOG_COOLDOWN_MS: u64 = 120_000;
                const HARD_RESET_COOLDOWN_MS: u64 = 60_000;
                // If the tap is "enabled" but the callback hasn't fired for a long time,
                // it may be in the zombie state described in `global_key_listener::hard_reset_tap()`.
                //
                // Keep this threshold high to avoid false positives when the user is simply idle.
                const ZOMBIE_CALLBACK_AGE_MS: u64 = 5 * 60 * 1000; // 5 minutes
                const ZOMBIE_CONFIRM_TICKS: u8 = 2; // require consecutive confirmations

                let mut tick = interval(Duration::from_secs(TICK_SECS));
                let mut zombie_suspect_ticks: u8 = 0;
                loop {
                    tick.tick().await;

                    let Some(enabled) = crate::global_key_listener::event_tap_is_enabled() else {
                        continue;
                    };
                    let callback_age_ms = crate::global_key_listener::last_tap_callback_age_ms();

                    let now = epoch_ms();
                    if enabled {
                        // Enabled can still be "broken": detect zombie state using callback liveness.
                        if let Some(age) = callback_age_ms {
                            if age >= ZOMBIE_CALLBACK_AGE_MS {
                                zombie_suspect_ticks = zombie_suspect_ticks.saturating_add(1);
                            } else {
                                zombie_suspect_ticks = 0;
                            }
                        } else {
                            zombie_suspect_ticks = 0;
                        }

                        if zombie_suspect_ticks < ZOMBIE_CONFIRM_TICKS {
                            continue;
                        }

                        // Confirmed zombie state: attempt a hard reset of the tap thread.
                        let last_reset = KEY_LISTENER_HARD_RESET_MS.load(Ordering::Relaxed);
                        if last_reset != 0
                            && now.saturating_sub(last_reset) < HARD_RESET_COOLDOWN_MS
                        {
                            continue;
                        }
                        KEY_LISTENER_HARD_RESET_MS.store(now, Ordering::Relaxed);

                        eprintln!(
                            "❌ [key_listener watchdog] CGEventTap looks zombie (enabled=true, last callback age: {:?}ms); hard resetting tap thread",
                            callback_age_ms
                        );
                        crate::global_key_listener::hard_reset_tap();
                        zombie_suspect_ticks = 0;
                        continue;
                    }

                    // Tap is disabled (explicitly). Try re-enable first, then hard reset if needed.
                    zombie_suspect_ticks = 0;

                    let last_log = KEY_LISTENER_DISABLED_LOG_MS.load(Ordering::Relaxed);
                    if last_log == 0 || now.saturating_sub(last_log) >= DISABLED_LOG_COOLDOWN_MS {
                        eprintln!(
                            "⚠️  [key_listener watchdog] CGEventTap is disabled; re-enabling"
                        );
                        KEY_LISTENER_DISABLED_LOG_MS.store(now, Ordering::Relaxed);
                    }

                    crate::global_key_listener::re_enable_tap();
                    tokio::time::sleep(Duration::from_millis(800)).await;

                    if crate::global_key_listener::event_tap_is_enabled() != Some(false) {
                        continue;
                    }

                    let last_reset = KEY_LISTENER_HARD_RESET_MS.load(Ordering::Relaxed);
                    if last_reset != 0 && now.saturating_sub(last_reset) < HARD_RESET_COOLDOWN_MS {
                        continue;
                    }
                    KEY_LISTENER_HARD_RESET_MS.store(now, Ordering::Relaxed);

                    eprintln!(
                        "❌ [key_listener watchdog] tap still disabled after re-enable; hard resetting tap thread"
                    );
                    crate::global_key_listener::hard_reset_tap();
                }
            });
        }
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

    // Must register before `tauri-plugin-deep-link` so Windows/Linux can forward protocol
    // URLs from a second process to the running instance (see Tauri deep-linking docs).
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        println!(
            "🔄 Second instance launch detected (argv={argv:?}) — focusing main window"
        );
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

    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ));

    builder
        .manage(OAuthState::default())
        .invoke_handler(tauri::generate_handler![
            request_microphone_permission,
            request_accessibility_permission,
            open_permission_pane,
            check_microphone_permission,
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
            auth_get_state,
            get_auth_data,
            clear_auth_data,
            has_auth_data,
            get_auth_token,
            get_api_base_url,
            get_current_user,
            logout,
            refresh_auth_token,
            get_app_config,
            get_default_hotkeys,
            begin_onboarding_hotkey_dry_run,
            end_onboarding_hotkey_dry_run,
            update_app_config,
            get_system_type,
            copy_to_clipboard,
            open_external_url,
            get_transcripts,
            get_transcript,
            delete_transcript,
            get_analytics_stats,
            get_analytics_chart,
            get_billing_usage,
            create_billing_checkout,
            cancel_billing_subscription,
            get_current_subscription,
            user_cache_warmup,
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
            get_docs,
            get_doc,
            create_doc,
            update_doc,
            delete_doc,
            start_doc_recording,
            stop_doc_recording,
            create_doc_from_audio,
            create_room,
            list_rooms,
            get_room_details,
            start_room_recording,
            stop_room_recording_and_process,
            update_room,
            update_speaker,
            add_meeting_note,
            create_meeting,
            list_meetings,
            get_meeting_details,
            get_meeting_suggested_questions,
            start_meeting_recording,
            stop_meeting_recording,
            end_meeting_session,
            dismiss_meeting_end_check_prompt,
            update_meeting,
            delete_meeting,
            stream_meeting_summary,
            send_meeting_chat,
            create_doc_from_meeting,
            get_app_icon,
            start_global_key_listener,
        ])
        .setup(move |app| {
            // Create system tray first to avoid borrow checker issues
            let start_meeting_menu_item = tray::init_system_tray(app)?;

            if let Some(window) = app.get_webview_window("main") {
                titlebar::apply_to_window(&window);
            }

            let app_handle = app.handle();

            // Associate configured schemes with this executable (Windows/Linux). Helps dev
            // builds and edge cases where the installer did not register the handler.
            #[cfg(any(windows, target_os = "linux"))]
            {
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("⚠️  deep-link register_all failed: {}", e);
                }
            }

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

            // Periodic user cache warmup (server-side caches) — runs in Rust so it keeps
            // working even if the WebView throttles timers while app is backgrounded.
            let app_handle_for_cache_warmup = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                commands::cache::start_user_cache_warmup_scheduler(app_handle_for_cache_warmup)
                    .await;
            });

            // Initialize and position the pill window at the center of the screen
            // The window is created dynamically in Rust but shown at app startup
            if let Err(e) = pill::init_pill_window(app_handle.clone()) {
                eprintln!("Failed to initialize pill window: {}", e);
            }

            // Channel to communicate with the recording thread
            // Sender is used by key listener to signal start/stop, receiver is used in the recording thread
            let (recording_tx, recording_rx) = mpsc::channel::<RecordingCommand>();

            // Expose a clone so doc recording (mic in Docs UI) can send DocStart/DocStop
            app.manage(RecordingCommandTx(recording_tx.clone()));

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

            let onboarding_recording_dry_run = Arc::new(AtomicBool::new(false));
            app.manage(OnboardingRecordingDryRun(
                onboarding_recording_dry_run.clone(),
            ));

            app.manage(RoomState {
                is_recording: Mutex::new(false),
                command_tx: Mutex::new(None),
            });

            app.manage(MeetingState {
                is_recording: Mutex::new(false),
                command_tx: Mutex::new(None),
                system_stop_tx: Mutex::new(None),
                meeting_ws_text_tx: Mutex::new(None),
                meeting_ws_close_tx: Mutex::new(None),
                tray_start_meeting: Mutex::new(Some(start_meeting_menu_item)),
                meeting_recording_tx: Mutex::new(meeting_recording_tx),
                current_meeting_id: Mutex::new(None),
                reminder_task: Mutex::new(None),
                pending_mic_ended_meeting_id: Mutex::new(None),
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
            // after onboarding is complete so the listener is not started during first-run setup.
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
                spawn_recording_thread(
                    app_handle.clone(),
                    recording_rx,
                    onboarding_recording_dry_run,
                );
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
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { has_visible_windows, .. } = event {
                println!(
                    "🍎 RunEvent::Reopen triggered (has_visible_windows: {})",
                    has_visible_windows
                );
                show_and_focus_main_window(app_handle);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = app_handle;
                let _ = event;
            }
        });
}
