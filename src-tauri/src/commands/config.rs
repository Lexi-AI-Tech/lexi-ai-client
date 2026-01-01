//! Configuration Commands
//!
//! This module provides Tauri commands for managing configuration state.

use crate::state::LanguageState;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

/// Set the transcription language from frontend
///
/// This command allows the frontend to update the language preference stored in Rust state.
/// The frontend should call this whenever the language preference changes.
///
/// # Arguments
/// * `language` - Optional language code from frontend (e.g., "en", "es", "auto")
#[tauri::command]
pub fn set_language(state: State<LanguageState>, language: Option<String>) {
    if let Ok(mut language_guard) = state.language.lock() {
        *language_guard = language.clone();
        println!("🌐 Language updated to: {:?}", language);
    }
}

/// Get the current transcription language
///
/// # Returns
/// * `Option<String>` - The current language code if available, None otherwise
pub fn get_language(state: &State<LanguageState>) -> Option<String> {
    if let Ok(language_guard) = state.language.lock() {
        language_guard.clone()
    } else {
        None
    }
}

/// Enable auto-startup on system startup
///
/// This command enables the application to automatically start when the system boots.
#[tauri::command]
pub async fn enable_autostart(app: AppHandle) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    autolaunch
        .enable()
        .map_err(|e| format!("Failed to enable autostart: {}", e))?;
    println!("✅ Auto-startup enabled");
    Ok(())
}

/// Disable auto-startup on system startup
///
/// This command disables the automatic startup of the application.
#[tauri::command]
pub async fn disable_autostart(app: AppHandle) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    autolaunch
        .disable()
        .map_err(|e| format!("Failed to disable autostart: {}", e))?;
    println!("❌ Auto-startup disabled");
    Ok(())
}

/// Check if auto-startup is enabled
///
/// # Returns
/// * `bool` - true if auto-startup is enabled, false otherwise
#[tauri::command]
pub async fn is_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    let autolaunch = app.autolaunch();
    autolaunch
        .is_enabled()
        .map_err(|e| format!("Failed to check autostart status: {}", e))
}
