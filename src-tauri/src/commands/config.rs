//! Configuration Commands
//!
//! This module provides Tauri commands for managing configuration state.

use crate::commands::app_config;
use crate::state::LanguageState;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;

/// Set the transcription language from frontend
///
/// This command allows the frontend to update the language preference stored in Rust state
/// and persists it to Tauri Store. The frontend should call this whenever the language preference changes.
///
/// # Arguments
/// * `language` - Optional language code from frontend (e.g., "en", "es", "auto")
#[tauri::command]
pub fn set_language(
    app: AppHandle,
    state: State<LanguageState>,
    language: Option<String>,
) -> Result<(), String> {
    // Update in-memory state
    if let Ok(mut language_guard) = state.language.lock() {
        *language_guard = language.clone();
        println!("🌐 Language updated in memory to: {:?}", language);
    }

    // Persist to Tauri Store
    app_config::set_config_value(app, "language".to_string(), serde_json::json!(language))?;
    println!("💾 Language saved to Tauri Store");

    Ok(())
}

/// Get the current transcription language
///
/// First tries to load from Tauri Store, then falls back to in-memory state.
///
/// # Returns
/// * `Option<String>` - The current language code if available, None otherwise
#[tauri::command]
pub fn get_language(app: AppHandle, state: State<LanguageState>) -> Result<Option<String>, String> {
    // Try to load from Tauri Store first
    if let Ok(Some(language_value)) = app_config::get_config_value(app, "language".to_string()) {
        if let Some(lang) = language_value.as_str() {
            // Update in-memory state to match
            if let Ok(mut language_guard) = state.language.lock() {
                *language_guard = Some(lang.to_string());
            }
            return Ok(Some(lang.to_string()));
        }
    }

    // Fall back to in-memory state
    if let Ok(language_guard) = state.language.lock() {
        Ok(language_guard.clone())
    } else {
        Ok(None)
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
