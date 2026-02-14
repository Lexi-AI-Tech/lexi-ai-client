//! Hotkey Commands
//!
//! This module provides Tauri commands for managing hotkey configuration.
//! Hotkeys are managed via app config (server-synced) and runtime listeners.

use crate::commands::app_config::{get_app_config, update_app_config, AppConfig};
use crate::global_key_listener::{hotkey_to_canonical, validate_hotkey};
use crate::state::{ActionHotkeyWatchState, HotkeyRecordingState, HotkeyWatchState};
use serde::Deserialize;
use serde_json;
use tauri::{AppHandle, Emitter, State};

/// Update the hotkey configuration dynamically
///
/// This command updates hotkeys in app config and updates the runtime listener.
/// Supports up to 3 hotkeys. Fn key is handled via rdev, others via Tauri global shortcuts.
///
/// # Arguments
/// * `config_json` - JSON string with `hotkeys` array (e.g., `{"hotkeys": ["Fn", "Cmd+Shift+R"]}`)
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
    // Parse JSON - frontend sends {hotkeys: [...]}
    #[derive(Deserialize)]
    struct HotkeyConfigJson {
        hotkeys: Vec<String>,
    }
    let config: HotkeyConfigJson = serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse hotkey config: {}", e))?;

    let new_hotkeys = config.hotkeys;

    // Validate: maximum 3 hotkeys
    if new_hotkeys.len() > 3 {
        return Err("Maximum of 3 hotkeys allowed".to_string());
    }

    // Validate and normalize each hotkey to canonical form (Control+Option+Command+Shift+Key)
    let new_hotkeys: Vec<String> = new_hotkeys
        .iter()
        .map(|h| validate_hotkey(h).map(|()| hotkey_to_canonical(h)))
        .collect::<Result<Vec<_>, String>>()?;

    // Get current config to preserve other fields
    let current_config = get_app_config(app.clone())
        .await
        .unwrap_or_else(|_| AppConfig::default());

    let app_config_update = AppConfig {
        hotkeys: Some(new_hotkeys.clone()),
        languages: current_config.languages,
        enhance_transcription: current_config.enhance_transcription,
        launch_on_system_startup: current_config.launch_on_system_startup,
        vocabulary: current_config.vocabulary,
        action_hotkeys: current_config.action_hotkeys,
        shortcuts: current_config.shortcuts,
    };

    update_app_config(app.clone(), app_config_update)
        .await
        .map_err(|e| format!("Failed to update hotkeys: {}", e))?;

    // Update watch state to notify listener thread (single source of truth)
    if state.0.send(new_hotkeys.clone()).is_err() {
        return Err("Failed to update hotkey watch state".to_string());
    }

    // Note: rdev hotkeys are automatically handled by the rdev listener when config changes

    // Emit the config back as JSON for UI display (frontend expects {hotkeys: [...]})
    let response_json = serde_json::json!({ "hotkeys": new_hotkeys });
    app.emit("hotkey-updated", response_json.to_string())
        .unwrap_or_default();
    println!("🔑 Hotkeys updated to: {:?}", new_hotkeys);
    Ok(())
}

/// Get the current hotkey configuration
///
/// Returns hotkeys from app config.
///
/// # Returns
/// * `String` - JSON string with `hotkeys` array (e.g., `{"hotkeys": ["Fn", "Cmd+Shift+R"]}`)

#[tauri::command]
pub async fn get_current_hotkey(app: AppHandle) -> Result<String, String> {
    let config = get_app_config(app).await?;
    let hotkeys = config
        .hotkeys
        .ok_or_else(|| "Server did not provide hotkeys".to_string())?;

    // Frontend expects {hotkeys: [...]} format
    let response = serde_json::json!({ "hotkeys": hotkeys });
    serde_json::to_string(&response)
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

/// Validate a hotkey string (non-empty, not reserved by macOS).
/// Returns the canonical form on success (Control+Option+Command+Shift+Key format for storage).
#[tauri::command]
pub fn validate_hotkey_for_ui(hotkey: String) -> Result<String, String> {
    validate_hotkey(&hotkey).map(|()| hotkey_to_canonical(&hotkey))
}

/// Update the action hotkey configuration dynamically
///
/// This command updates action hotkeys in app config and updates the runtime listener.
/// Supports up to 3 action hotkeys.
///
/// # Arguments
/// * `config_json` - JSON string with `hotkeys` array (e.g., `{"hotkeys": ["Fn+Control"]}`)
///
/// # Returns
/// * `Ok(())` - Successfully updated the action hotkeys
/// * `Err(String)` - An error message if parsing failed or update failed
#[tauri::command]
pub async fn update_action_hotkey(
    config_json: String,
    app: AppHandle,
    state: State<'_, ActionHotkeyWatchState>,
) -> Result<(), String> {
    // Parse JSON - frontend sends {hotkeys: [...]}
    #[derive(Deserialize)]
    struct HotkeyConfigJson {
        hotkeys: Vec<String>,
    }
    let config: HotkeyConfigJson = serde_json::from_str(&config_json)
        .map_err(|e| format!("Failed to parse action hotkey config: {}", e))?;

    let new_hotkeys = config.hotkeys;

    // Validate: maximum 3 hotkeys
    if new_hotkeys.len() > 3 {
        return Err("Maximum of 3 action hotkeys allowed".to_string());
    }

    // Validate and normalize each hotkey to canonical form (Control+Option+Command+Shift+Key)
    let new_hotkeys: Vec<String> = new_hotkeys
        .iter()
        .map(|h| validate_hotkey(h).map(|()| hotkey_to_canonical(h)))
        .collect::<Result<Vec<_>, String>>()?;

    // Get current config to preserve other fields
    let current_config = get_app_config(app.clone())
        .await
        .unwrap_or_else(|_| AppConfig::default());

    let app_config_update = AppConfig {
        hotkeys: current_config.hotkeys,
        languages: current_config.languages,
        enhance_transcription: current_config.enhance_transcription,
        launch_on_system_startup: current_config.launch_on_system_startup,
        vocabulary: current_config.vocabulary,
        action_hotkeys: Some(new_hotkeys.clone()),
        shortcuts: current_config.shortcuts,
    };

    update_app_config(app.clone(), app_config_update)
        .await
        .map_err(|e| format!("Failed to update action hotkeys: {}", e))?;

    // Update watch state to notify listener thread
    if state.0.send(new_hotkeys.clone()).is_err() {
        return Err("Failed to update action hotkey watch state".to_string());
    }

    // Emit the config back as JSON for UI display
    let response_json = serde_json::json!({ "hotkeys": new_hotkeys });
    app.emit("action-hotkey-updated", response_json.to_string())
        .unwrap_or_default();
    println!("🎯 Action hotkeys updated to: {:?}", new_hotkeys);
    Ok(())
}

