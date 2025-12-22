//! Hotkey Commands
//!
//! This module provides Tauri commands for managing hotkey configuration.

use tauri::{AppHandle, State, Emitter};
use serde_json;
use crate::state::{HotkeyWatchState, HotkeyRecordingState};
use crate::global_key_listener::HotkeyConfig;

/// Update the hotkey configuration dynamically
/// 
/// This command allows the frontend to change the hotkey that triggers recording.
/// The listener will automatically restart with the new configuration.
/// 
/// # Arguments
/// * `config_json` - JSON string representation of HotkeyConfig
/// 
/// # Returns
/// * `Ok(())` - Successfully updated the hotkey
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

    if state.0.send(new_config.clone()).is_err() {
        return Err("Failed to update hotkey config".to_string());
    }

    // Emit the config back as JSON for UI display
    app.emit("hotkey-updated", &config_json).unwrap_or_default();
    println!("🔑 Hotkey updated to: {:?}", new_config);
    Ok(())
}

/// Get the current hotkey configuration
/// 
/// # Returns
/// * `String` - JSON string representation of the current HotkeyConfig
#[tauri::command]
pub fn get_current_hotkey(state: State<HotkeyWatchState>) -> String {
    let config = state.0.borrow().clone();
    serde_json::to_string(&config).unwrap_or_else(|_| "{}".to_string())
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

