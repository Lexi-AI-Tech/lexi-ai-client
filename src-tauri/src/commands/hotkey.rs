//! Hotkey Commands
//!
//! This module provides Tauri commands for managing hotkey configuration.

use crate::global_key_listener::{HotkeyConfig, register_hotkeys, unregister_all_hotkeys, validate_hotkey};
use crate::state::{HotkeyRecordingState, HotkeyWatchState};
use serde_json;
use tauri::{AppHandle, Emitter, State};

/// Update the hotkey configuration dynamically
///
/// This command allows the frontend to change the hotkeys that trigger recording.
/// Supports up to 3 hotkeys. Fn key is handled via rdev, others via Tauri global shortcuts.
///
/// # Arguments
/// * `config_json` - JSON string representation of HotkeyConfig with hotkeys array
///
/// # Returns
/// * `Ok(())` - Successfully updated the hotkeys
/// * `Err(String)` - An error message if parsing failed or update failed
#[tauri::command]
pub fn update_hotkey(
    config_json: String,
    app: AppHandle,
    state: State<HotkeyWatchState>,
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

    // Get old config to unregister old shortcuts
    let old_config = state.0.borrow().clone();
    let old_tauri = old_config.tauri_hotkeys();

    // Unregister old Tauri hotkeys (rdev hotkeys are managed by listener restart)
    unregister_all_hotkeys(&app, &old_tauri);

    // Update the config
    if state.0.send(new_config.clone()).is_err() {
        return Err("Failed to update hotkey config".to_string());
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

/// Get the current hotkey configuration
///
/// # Returns
/// * `String` - JSON string representation of the current HotkeyConfig
#[tauri::command]
pub fn get_current_hotkey(state: State<HotkeyWatchState>) -> String {
    let config = state.0.borrow().clone();
    serde_json::to_string(&config).unwrap_or_else(|_| r#"{"hotkeys":["Fn"]}"#.to_string())
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
