//! Hotkey Commands
//!
//! This module provides Tauri commands for managing hotkey configuration.
//! Hotkeys are managed via app config (server-synced) and runtime listeners.
//! - **Hotkeys**: trigger recording for transcription.
//! - **Action hotkeys**: trigger recording for voice actions.

use crate::commands::app_config::{fetch_config_from_server, update_app_config, AppConfig};
use crate::global_key_listener::{
    hotkey_to_canonical,
    validate_hotkey,
};
use crate::state::{ActionHotkeyWatchState, HotkeyRecordingState, HotkeyWatchState};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

const MAX_HOTKEYS: usize = 3;

/// JSON payload from frontend: `{ "hotkeys": ["Fn", "Cmd+Shift+R"] }`
#[derive(Deserialize)]
struct HotkeyConfigJson {
    hotkeys: Vec<String>,
}

/// Parse JSON and validate/normalize hotkey list. Returns canonical hotkeys or error.
fn parse_and_validate_hotkeys(
    config_json: &str,
    max_allowed: usize,
    kind: &str,
) -> Result<Vec<String>, String> {
    let config: HotkeyConfigJson = serde_json::from_str(config_json)
        .map_err(|e| format!("Failed to parse {} config: {}", kind, e))?;

    let raw = config.hotkeys;
    if raw.len() > max_allowed {
        return Err(format!("Maximum of {} {} allowed", max_allowed, kind));
    }

    raw.iter()
        .map(|h| validate_hotkey(h).map(|()| hotkey_to_canonical(h)))
        .collect::<Result<Vec<_>, _>>()
}

/// Update the hotkey configuration dynamically
///
/// Supports up to 3 hotkeys. Fn key is handled via rdev, others via Tauri global shortcuts.
#[tauri::command]
pub async fn update_hotkey(
    config_json: String,
    app: AppHandle,
    state: State<'_, HotkeyWatchState>,
) -> Result<(), String> {
    let new_hotkeys = parse_and_validate_hotkeys(&config_json, MAX_HOTKEYS, "hotkey")?;

    let app_config_update = AppConfig {
        hotkeys: Some(new_hotkeys.clone()),
        ..Default::default()
    };

    update_app_config(app.clone(), app_config_update)
        .await
        .map_err(|e| e.to_string())?;

    if state.0.send(new_hotkeys.clone()).is_err() {
        return Err("Failed to update hotkey watch state".to_string());
    }

    let response_json = serde_json::json!({ "hotkeys": new_hotkeys });
    app.emit("hotkey-updated", response_json.to_string())
        .unwrap_or_default();
    println!("🔑 Hotkeys updated to: {:?}", new_hotkeys);
    Ok(())
}

/// Get the current hotkey configuration
#[tauri::command]
pub async fn get_current_hotkey(app: AppHandle) -> Result<String, String> {
    let config = fetch_config_from_server(&app).await?;
    let hotkeys = config
        .hotkeys
        .ok_or_else(|| "Server did not provide hotkeys".to_string())?;

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
/// Returns the canonical form on success.
#[tauri::command]
pub fn validate_hotkey_for_ui(hotkey: String) -> Result<String, String> {
    validate_hotkey(&hotkey).map(|()| hotkey_to_canonical(&hotkey))
}

/// Update the action hotkey configuration dynamically
///
/// Supports up to 3 action hotkeys.
#[tauri::command]
pub async fn update_action_hotkey(
    config_json: String,
    app: AppHandle,
    state: State<'_, ActionHotkeyWatchState>,
) -> Result<(), String> {
    let new_hotkeys =
        parse_and_validate_hotkeys(&config_json, MAX_HOTKEYS, "action hotkey")?;

    let app_config_update = AppConfig {
        action_hotkeys: Some(new_hotkeys.clone()),
        ..Default::default()
    };

    update_app_config(app.clone(), app_config_update)
        .await
        .map_err(|e| e.to_string())?;

    if state.0.send(new_hotkeys.clone()).is_err() {
        return Err("Failed to update action hotkey watch state".to_string());
    }

    let response_json = serde_json::json!({ "hotkeys": new_hotkeys });
    app.emit("action-hotkey-updated", response_json.to_string())
        .unwrap_or_default();
    println!("🎯 Action hotkeys updated to: {:?}", new_hotkeys);
    Ok(())
}
