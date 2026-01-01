//! Configuration Commands
//!
//! This module provides Tauri commands for managing configuration state.

use crate::commands::app_config;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// Set the transcription language from frontend
///
/// This command persists the language preference to Tauri Store.
/// The frontend should call this whenever the language preference changes.
///
/// # Arguments
/// * `language` - Optional language code from frontend (e.g., "en", "es", "auto")
#[tauri::command]
pub fn set_language(
    app: AppHandle,
    language: Option<String>,
) -> Result<(), String> {
    // Persist to Tauri Store
    app_config::set_config_value(app, "language".to_string(), serde_json::json!(language))?;
    println!("💾 Language saved to Tauri Store: {:?}", language);

    Ok(())
}

/// Get the current transcription language (internal function)
///
/// Reads directly from Tauri Store.
///
/// # Returns
/// * `Option<String>` - The current language code if available, None otherwise
pub fn get_language_internal(app: &AppHandle) -> Result<Option<String>, String> {
    // Read directly from Tauri Store
    if let Ok(Some(language_value)) = app_config::get_config_value(app.clone(), "language".to_string()) {
        if let Some(lang) = language_value.as_str() {
            return Ok(Some(lang.to_string()));
        }
    }

    // Return None if not found (defaults will be handled by callers)
    Ok(None)
}

/// Get the current transcription language (Tauri command)
///
/// Reads directly from Tauri Store.
///
/// # Returns
/// * `Option<String>` - The current language code if available, None otherwise
#[tauri::command]
pub fn get_language(app: AppHandle) -> Result<Option<String>, String> {
    get_language_internal(&app)
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
