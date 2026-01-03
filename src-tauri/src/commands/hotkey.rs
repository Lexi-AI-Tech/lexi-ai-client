//! Hotkey Commands
//!
//! This module provides Tauri commands for managing hotkey configuration.
//! All hotkeys are stored in Tauri Store as `transcription_hotkeys`.

use crate::commands::app_config::{get_app_config, update_app_config, AppConfig};
use crate::global_key_listener::{HotkeyConfig, register_hotkeys, unregister_all_hotkeys, validate_hotkey};
use crate::state::{HotkeyRecordingState, HotkeyWatchState};
use serde_json;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_store::StoreExt;

/// Update the hotkey configuration dynamically
///
/// This command saves hotkeys to Tauri Store and updates the runtime listener.
/// Supports up to 3 hotkeys. Fn key is handled via rdev, others via Tauri global shortcuts.
///
/// # Arguments
/// * `config_json` - JSON string representation of HotkeyConfig with hotkeys array
///
/// # Returns
/// * `Ok(())` - Successfully updated the hotkeys
/// * `Err(String)` - An error message if parsing failed or update failed
#[tauri::command]
pub async fn update_hotkey(
    config_json: String,
    app: AppHandle,
    state: State<'_, HotkeyWatchState>,
) -> Result<(), String> {
    // Parse JSON to HotkeyConfig
    let new_config: HotkeyConfig = serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse hotkey config: {}", e))?;

    // Validate: maximum 3 hotkeys
    if new_config.hotkeys.len() > 3 {
        return Err("Maximum of 3 hotkeys allowed".to_string());
    }
    
    // Validate each hotkey (check for system-reserved shortcuts, modifier-only, etc.)
    for hotkey in &new_config.hotkeys {
        if let Err(e) = validate_hotkey(hotkey) {
            return Err(e);
        }
    }

    // Get old config from watch state to unregister old shortcuts
    let old_config = state.0.borrow().clone();
    let old_tauri = old_config.tauri_hotkeys();

    // Unregister old Tauri hotkeys (rdev hotkeys are managed by listener restart)
    unregister_all_hotkeys(&app, &old_tauri);

    // Save to Tauri Store
    // First get current config, then update only transcription_hotkeys
    let current_config = get_app_config(app.clone()).await
        .unwrap_or_else(|_| AppConfig::default());
    
    let app_config_update = AppConfig {
        transcription_hotkeys: Some(new_config.hotkeys.clone()),
        languages: current_config.languages,
        enhance_transcription: current_config.enhance_transcription,
        transcribe_with_cursor_context: current_config.transcribe_with_cursor_context,
        launch_on_system_startup: current_config.launch_on_system_startup,
        vocabulary: current_config.vocabulary,
    };
    
    update_app_config(app.clone(), app_config_update).await
        .map_err(|e| format!("Failed to save hotkeys to store: {}", e))?;

    // Update watch state to notify listener thread
    if state.0.send(new_config.clone()).is_err() {
        return Err("Failed to update hotkey watch state".to_string());
    }

    // Register new hotkeys (Tauri will try first, fall back to rdev if needed)
    let tauri_hotkeys = new_config.tauri_hotkeys();
    if !tauri_hotkeys.is_empty() {
        match register_hotkeys(&app, &tauri_hotkeys) {
            Ok(rdev_fallback) => {
                if !rdev_fallback.is_empty() {
                    println!("ℹ️  {} hotkey(s) will be handled by rdev: {:?}", rdev_fallback.len(), rdev_fallback);
                }
            }
            Err(e) => {
                return Err(format!("Failed to register global shortcuts: {}", e));
            }
        }
    }
    
    // Note: rdev hotkeys are automatically handled by the rdev listener when config changes

    // Emit the config back as JSON for UI display
    app.emit("hotkey-updated", &config_json).unwrap_or_default();
    println!("🔑 Hotkeys updated to: {:?}", new_config);
    Ok(())
}

/// Get the current hotkey configuration from Tauri Store
///
/// Returns hotkeys from store. If no config exists, fetches from server (which provides defaults).
///
/// # Returns
/// * `String` - JSON string representation of the current HotkeyConfig
#[tauri::command]
pub async fn get_current_hotkey(app: AppHandle) -> Result<String, String> {
    let config = get_app_config(app).await?;
    let hotkeys = config.transcription_hotkeys
        .ok_or_else(|| "Server did not provide transcription_hotkeys".to_string())?;
    
    let hotkey_config = HotkeyConfig { hotkeys };
    serde_json::to_string(&hotkey_config)
        .map_err(|e| format!("Failed to serialize hotkey config: {}", e))
}

/// Start hotkey recording mode - enables key event emission for hotkey selection
#[tauri::command]
pub fn start_hotkey_recording(state: State<HotkeyRecordingState>) {
    if let Ok(mut recording) = state.is_recording.lock() {
        *recording = true;
        println!("🎹 Started hotkey recording mode");
    }
}

/// Stop hotkey recording mode
#[tauri::command]
pub fn stop_hotkey_recording(state: State<HotkeyRecordingState>) {
    if let Ok(mut recording) = state.is_recording.lock() {
        *recording = false;
        println!("🎹 Stopped hotkey recording mode");
    }
}
