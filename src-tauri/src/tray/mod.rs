//! System Tray Module
//!
//! This module handles the creation and management of the system tray icon
//! for the Lexi AI application.
//!
//! ## Tray Features
//!
//! - **Show App**: Click to show/hide the main window
//! - **Quit**: Exit the application
//! - **Left-click**: Toggle main window visibility
//!
//! ## Usage
//!
//! ```rust
//! use crate::tray::init_system_tray;
//!
//! // In your setup function:
//! init_system_tray(app)?;
//! ```

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager};

use crate::window::show_and_focus_main_window;

/// Initialize the system tray icon with menu items and event handlers
///
/// Creates a system tray icon with the following features:
/// - Menu items: "Show App" and "Quit"
/// - Left-click to toggle main window visibility
/// - Menu event handlers for show and quit actions
///
/// # Arguments
/// * `app` - The Tauri app instance
///
/// # Returns
/// * `Ok(())` - Successfully created the tray icon
/// * `Err(tauri::Error)` - Failed to create the tray icon
///
/// # Example
/// ```rust
/// init_system_tray(app)?;
/// ```
pub fn init_system_tray(app: &mut App) -> Result<MenuItem<tauri::Wry>, tauri::Error> {
    // Create system tray menu items
    let show_item = MenuItem::with_id(app, "show", "Show App", true, None::<&str>)?;
    let start_meeting_item =
        MenuItem::with_id(app, "start_meeting", "Start Meeting", true, None::<&str>)?;
    let paste_transcript_item = MenuItem::with_id(
        app,
        "paste_last_transcript",
        "Paste Last Transcript",
        true,
        None::<&str>,
    )?;
    let check_updates_item =
        MenuItem::with_id(app, "check_updates", "Check for Updates", true, None::<&str>)?;
    let version_label = format!("Version {}", app.package_info().version);
    let version_item = MenuItem::with_id(app, "version", version_label, false, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let tray_menu = Menu::with_items(
        app,
        &[
            &show_item,
            &start_meeting_item,
            &paste_transcript_item,
            &check_updates_item,
            &version_item,
            &quit_item,
        ],
    )?;

    // Get the default window icon for the tray
    let tray_icon = app.default_window_icon().ok_or_else(|| {
        eprintln!(
            "⚠️  Warning: Default window icon not found, tray icon may not display correctly"
        );
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Default window icon not available",
        )
    })?;

    // Create the tray icon with event handlers
    let _tray = TrayIconBuilder::with_id("main")
        .icon(tray_icon.clone())
        .tooltip("Lexi AI")
        .menu(&tray_menu)
        .on_menu_event(handle_tray_menu_event)
        .on_tray_icon_event(handle_tray_icon_event)
        .build(app)?;

    #[cfg(target_os = "macos")]
    macos::on_tray_created(&*app);

    #[cfg(target_os = "windows")]
    windows::on_tray_created(&*app);

    println!("🎯 System tray created successfully");

    Ok(start_meeting_item)
}

/// Handle tray menu events (Show App, Quit)
///
/// # Arguments
/// * `app` - The app handle
/// * `event` - The menu event
fn handle_tray_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let event_id = event.id.as_ref().to_string();
    println!("📋 Tray menu event: {}", event_id);

    match event_id.as_str() {
        "show" => {
            show_and_focus_main_window(app);
        }
        "start_meeting" => {
            let is_recording = app
                .try_state::<crate::state::MeetingState>()
                .map(|state| *state.is_recording.lock().unwrap())
                .unwrap_or(false);

            show_and_focus_main_window(app);
            let app_clone = app.clone();
            if is_recording {
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = app_clone.emit("end-meeting-from-tray", ()) {
                        eprintln!("Failed to emit end-meeting-from-tray event: {}", e);
                    }
                });
            } else {
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = app_clone.emit("start-meeting-from-tray", ()) {
                        eprintln!("Failed to emit start-meeting-from-tray event: {}", e);
                    }
                });
            }
        }
        "paste_last_transcript" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                match crate::assistant::commands::get_transcripts(
                    app.clone(),
                    Some(1),
                    Some(1),
                    None,
                    Some("created_at".to_string()),
                    Some("desc".to_string()),
                )
                .await
                {
                    Ok(resp) => {
                        if let Some(t) = resp.transcripts.first() {
                            let text = t
                                .enhanced_text
                                .as_deref()
                                .unwrap_or(t.original_text.as_str());
                            let injector = crate::text_injector::TextInjector::new();
                            match injector.inject_text(text) {
                                Ok(_) => {}
                                Err(e) => eprintln!("Failed to paste last transcript: {}", e),
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to fetch last transcript: {}", e);
                    }
                }
            });
        }
        "check_updates" => {
            show_and_focus_main_window(app);
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = app_clone.emit("check-updates-from-tray", ()) {
                    eprintln!("Failed to emit check-updates-from-tray event: {}", e);
                }
            });
        }
        "quit" => {
            println!("👋 Quitting application");
            app.exit(0);
        }
        _ => {
            println!("❓ Unknown tray menu event: {}", event_id);
        }
    }
}

/// Handle tray icon click events
///
/// Left-click on the tray icon toggles the main window visibility
///
/// # Arguments
/// * `tray` - The tray icon handle
/// * `event` - The tray icon event
fn handle_tray_icon_event(tray: &tauri::tray::TrayIcon, event: TrayIconEvent) {
    // Handle left-click on tray icon to show/hide window
    if let TrayIconEvent::Click {
        button: tauri::tray::MouseButton::Left,
        button_state: tauri::tray::MouseButtonState::Up,
        ..
    } = event
    {
        let app_clone = tray.app_handle().clone();
        tauri::async_runtime::spawn(async move {
            if let Some(window) = app_clone.get_webview_window("main") {
                let is_visible = window.is_visible().unwrap_or(false);
                if is_visible {
                    println!("🔄 Hiding window via tray click");
                    if let Err(e) = window.hide() {
                        eprintln!("❌ Failed to hide window: {}", e);
                    } else {
                        println!("✅ Window hidden via tray click");
                    }
                } else {
                    show_and_focus_main_window(&app_clone);
                }
            }
        });
    }
}
