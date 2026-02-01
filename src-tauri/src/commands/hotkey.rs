//! Hotkey Commands
//!
//! This module provides Tauri commands for managing hotkey configuration.
//! All hotkeys are stored in Tauri Store as `hotkeys`.

use crate::commands::app_config::{get_app_config, update_app_config, AppConfig};
use crate::global_key_listener::{
    register_hotkeys, tauri_hotkeys, unregister_all_hotkeys, validate_hotkey,
};
use crate::state::{HotkeyRecordingState, HotkeyWatchState};
use serde::Deserialize;
use serde_json;
use tauri::{AppHandle, Emitter, State};

/// Update the hotkey configuration dynamically
///
/// This command saves hotkeys to Tauri Store and updates the runtime listener.
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

    // Validate each hotkey (check for system-reserved shortcuts, modifier-only, etc.)
    for hotkey in &new_hotkeys {
        if let Err(e) = validate_hotkey(hotkey) {
            return Err(e);
        }
    }

    // Get old hotkeys from watch state to unregister old shortcuts
    let old_hotkeys = state.0.borrow().clone();
    let old_tauri = tauri_hotkeys(&old_hotkeys);

    // Unregister old Tauri hotkeys (rdev hotkeys are managed by listener restart)
    unregister_all_hotkeys(&app, &old_tauri);

    // Save to Tauri Store (single source of truth)
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
        .map_err(|e| format!("Failed to save hotkeys to store: {}", e))?;

    // Update watch state to notify listener thread (single source of truth)
    if state.0.send(new_hotkeys.clone()).is_err() {
        return Err("Failed to update hotkey watch state".to_string());
    }

    // Register new hotkeys (Tauri will try first, fall back to rdev if needed)
    let tauri_hotkeys_list = tauri_hotkeys(&new_hotkeys);
    if !tauri_hotkeys_list.is_empty() {
        match register_hotkeys(&app, &tauri_hotkeys_list) {
            Ok(rdev_fallback) => {
                if !rdev_fallback.is_empty() {
                    println!(
                        "ℹ️  {} hotkey(s) will be handled by rdev: {:?}",
                        rdev_fallback.len(),
                        rdev_fallback
                    );
                }
            }
            Err(e) => {
                return Err(format!("Failed to register global shortcuts: {}", e));
            }
        }
    }

    // Note: rdev hotkeys are automatically handled by the rdev listener when config changes

    // Emit the config back as JSON for UI display (frontend expects {hotkeys: [...]})
    let response_json = serde_json::json!({ "hotkeys": new_hotkeys });
    app.emit("hotkey-updated", response_json.to_string())
        .unwrap_or_default();
    println!("🔑 Hotkeys updated to: {:?}", new_hotkeys);
    Ok(())
}

/// Get the current hotkey configuration from Tauri Store
///
/// Returns hotkeys from store. If no config exists, fetches from server (which provides defaults).
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
