//! Application Configuration Module
//!
//! This module provides unified commands for managing application configuration.
//! Configuration is fetched from the server and synced with OS-level settings (autostart).
//!
//! ## Unified Commands
//! - `get_app_config` - Get complete app configuration
//! - `update_app_config` - Update app configuration (automatically syncs autostart and cloud)

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::api_endpoints::app_config;
use crate::commands::auth::get_auth_token_async;
use crate::commands::shortcuts::Shortcut;
use crate::state::{ActionHotkeyWatchState, HotkeyWatchState};
use crate::utils;

/// Application configuration structure
///
/// Represents all application settings.
/// All fields are optional to allow for partial updates and backward compatibility.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    /// Transcription language preferences (e.g., ["en"], ["es"], ["auto"])
    pub languages: Option<Vec<String>>,
    /// Global hotkeys for triggering recording (e.g., ["Fn"], ["Cmd+Shift+R"])
    pub hotkeys: Option<Vec<String>>,
    /// Whether to enhance transcriptions with LLM processing
    pub enhance_transcription: Option<bool>,
    /// Whether to launch application on system startup
    pub launch_on_system_startup: Option<bool>,
    /// Vocabulary for transcription (array of strings)
    pub vocabulary: Option<Vec<String>>,
    /// Hotkey combinations for triggering actions (e.g., ["Fn+Control"])
    pub action_hotkeys: Option<Vec<String>>,
    /// Shortcuts for text expansion (array of shortcut items)
    pub shortcuts: Option<Vec<Shortcut>>,
}

// ============================================================================
// App Configuration Storage Commands
//
// These commands provide access to the configuration.
// They handle fetching from server and syncing.
// ============================================================================

/// Server response structure for app config
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ServerAppConfigResponse {
    pub system_type: String,
    pub device_type: String,
    pub hotkeys: Vec<String>,
    pub languages: Vec<String>,
    pub enhance_transcription: bool,
    pub launch_on_system_startup: bool,
    pub vocabulary: Vec<String>,
    pub action_hotkeys: Option<Vec<String>>,
    pub shortcuts: Vec<Shortcut>,
}

/// Get the complete app configuration from server
///
/// Always attempts to fetch fresh config from server.
/// Syncs autostart status from OS-level settings.
#[tauri::command]
pub async fn get_app_config(app: AppHandle) -> Result<AppConfig, String> {
    println!("🔄 Fetching app config from server...");

    let mut config = fetch_config_from_server(&app).await.map_err(|e| {
        println!("⚠️  Failed to fetch from server: {}", e);
        e
    })?;

    println!(
        "✅ Fetched config from server with hotkeys: {:?}",
        config.hotkeys
    );

    // Sync launch_on_system_startup with actual OS autostart status
    // This will enable autostart if config has launch_on_system_startup: Some(true) or None (defaults to true)
    sync_autostart_status(&app, &mut config);

    // Update in-memory state for hotkeys
    update_hotkey_state(&app, &config);

    Ok(config)
}

/// Fetch app configuration from server
/// This always fetches fresh config from server
pub(crate) async fn fetch_config_from_server(app: &AppHandle) -> Result<AppConfig, String> {
    let auth_token = match get_auth_token_async(app).await {
        Some(token) => token,
        None => {
            crate::commands::auth::handle_auth_expired(&app);
            return Err("Please sign in to sync your settings".to_string());
        }
    };

    let client = reqwest::Client::new();
    let url = app_config::get_url(Some(&format!("system_type={}", utils::get_system_type())));

    utils::log_api_request("Fetch app configuration from server", "GET", &url);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|_| {
            "Unable to connect to server. Please check your internet connection.".to_string()
        })?;

    let status = response.status();

    if !status.is_success() {
        let json_value: serde_json::Value = response
            .json()
            .await
            .unwrap_or_else(|_| serde_json::json!({}));
        let error_msg = extract_error_message(&json_value, status);
        return Err(format!("Unable to load settings: {}", error_msg));
    }

    let server_response: ServerAppConfigResponse = response.json().await.map_err(|_| {
        "Received invalid settings format from server. Please try again.".to_string()
    })?;

    let config = server_response_to_app_config(server_response);

    Ok(config)
}

/// Update the app configuration and sync with cloud API
///
/// Merges the provided config with existing config (partial updates supported).
/// Pushes to cloud, then re-fetches the updated config and syncs OS/hotkey state from it.
#[tauri::command]
pub async fn update_app_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    // Fetch current to merge properly
    let mut current_config = fetch_config_from_server(&app).await?;

    // Merge provided config with current config
    merge_config(&mut current_config, config);

    println!("✅ App config updated in memory");

    // Sync to cloud first
    sync_config_to_cloud(&app, &current_config).await;

    // Re-fetch from server to get the updated config (source of truth), then sync status from it
    let mut updated_config = fetch_config_from_server(&app).await?;
    sync_autostart_status(&app, &mut updated_config);
    update_hotkey_state(&app, &updated_config);

    Ok(updated_config)
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Sync autostart status from OS to config
/// Sync launch_on_system_startup with actual OS autostart status
/// If config says it should be enabled but OS has it disabled, enable it on OS
/// If config says it should be disabled but OS has it enabled, disable it on OS
pub(crate) fn sync_autostart_status(app: &AppHandle, config: &mut AppConfig) {
    let autolaunch = app.autolaunch();

    // Get current OS autostart status
    let os_enabled = autolaunch.is_enabled().unwrap_or(false);
    println!("OS autostart status: {}", os_enabled);

    // Get desired status from config (default to true if not set, matching database default)
    let config_enabled = config.launch_on_system_startup.unwrap_or(true);

    // If they don't match, sync OS to match config
    if config_enabled != os_enabled {
        if config_enabled {
            let _ = autolaunch.enable();
            println!("✅ Synced: Enabled autostart on OS (config was true)");
        } else {
            let _ = autolaunch.disable();
            println!("❌ Synced: Disabled autostart on OS (config was false)");
        }
    }

    // Update config with actual OS status (in case enable/disable failed)
    if let Ok(enabled) = autolaunch.is_enabled() {
        config.launch_on_system_startup = Some(enabled);
    }
}

/// Merge provided config into current config (only updates provided fields)
fn merge_config(current: &mut AppConfig, provided: AppConfig) {
    if provided.languages.is_some() {
        current.languages = provided.languages;
    }
    if provided.hotkeys.is_some() {
        current.hotkeys = provided.hotkeys;
    }
    if provided.enhance_transcription.is_some() {
        current.enhance_transcription = provided.enhance_transcription;
    }
    if provided.launch_on_system_startup.is_some() {
        current.launch_on_system_startup = provided.launch_on_system_startup;
    }
    if provided.vocabulary.is_some() {
        current.vocabulary = provided.vocabulary;
    }
    if provided.action_hotkeys.is_some() {
        current.action_hotkeys = provided.action_hotkeys;
    }
    if provided.shortcuts.is_some() {
        current.shortcuts = provided.shortcuts;
    }
}

/// Update in-memory state for hotkey watchers
fn update_hotkey_state(app: &AppHandle, config: &AppConfig) {
    // Update hotkey watcher state if hotkeys present
    if let Some(hotkeys) = &config.hotkeys {
        if let Some(hotkey_state) = app.try_state::<HotkeyWatchState>() {
            let _ = hotkey_state.0.send(hotkeys.clone());
        }
    }

    // Update action hotkeys watcher state if present
    if let Some(action_hotkeys) = &config.action_hotkeys {
        if let Some(action_hotkey_state) = app.try_state::<ActionHotkeyWatchState>() {
            let _ = action_hotkey_state.0.send(action_hotkeys.clone());
        }
    }
}

/// Convert server response to local AppConfig format
fn server_response_to_app_config(response: ServerAppConfigResponse) -> AppConfig {
    AppConfig {
        languages: Some(response.languages),
        hotkeys: Some(response.hotkeys),
        enhance_transcription: Some(response.enhance_transcription),
        launch_on_system_startup: Some(response.launch_on_system_startup),
        vocabulary: Some(response.vocabulary),
        action_hotkeys: response.action_hotkeys,
        shortcuts: Some(response.shortcuts),
    }
}

/// Extract user-friendly error message from server response
fn extract_error_message(json_value: &serde_json::Value, status: reqwest::StatusCode) -> String {
    json_value
        .get("error")
        .or_else(|| json_value.get("detail"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            if status == reqwest::StatusCode::UNAUTHORIZED {
                "Please sign in to continue".to_string()
            } else if status == reqwest::StatusCode::NOT_FOUND {
                "Settings not found".to_string()
            } else {
                format!("Server error ({}). Please try again", status)
            }
        })
}

/// Build request body from config (only includes fields that are Some)
fn build_request_body(config: &AppConfig) -> serde_json::Map<String, serde_json::Value> {
    let mut body = serde_json::Map::new();

    if let Some(ref languages) = config.languages {
        body.insert(
            "languages".to_string(),
            serde_json::to_value(languages).unwrap(),
        );
    }
    if let Some(ref hotkeys) = config.hotkeys {
        body.insert(
            "hotkeys".to_string(),
            serde_json::to_value(hotkeys).unwrap(),
        );
    }
    if let Some(enhance_transcription) = config.enhance_transcription {
        body.insert(
            "enhance_transcription".to_string(),
            serde_json::to_value(enhance_transcription).unwrap(),
        );
    }
    if let Some(launch_on_system_startup) = config.launch_on_system_startup {
        body.insert(
            "launch_on_system_startup".to_string(),
            serde_json::to_value(launch_on_system_startup).unwrap(),
        );
    }
    if let Some(ref vocabulary) = config.vocabulary {
        body.insert(
            "vocabulary".to_string(),
            serde_json::to_value(vocabulary).unwrap(),
        );
    }
    if let Some(ref action_hotkeys) = config.action_hotkeys {
        body.insert(
            "action_hotkeys".to_string(),
            serde_json::to_value(action_hotkeys).unwrap(),
        );
    }
    if let Some(ref shortcuts) = config.shortcuts {
        body.insert(
            "shortcuts".to_string(),
            serde_json::to_value(shortcuts).unwrap(),
        );
    }

    body.insert(
        "system_type".to_string(),
        serde_json::Value::String(utils::get_system_type().to_string()),
    );

    body
}

/// Sync app configuration to cloud API (best-effort, failures are logged)
async fn sync_config_to_cloud(app: &AppHandle, config: &AppConfig) {
    let auth_token = match get_auth_token_async(app).await {
        Some(token) => token,
        None => {
            println!("⚠️  No auth token available, skipping cloud sync");
            return;
        }
    };

    let client = reqwest::Client::new();
    let url = app_config::update_url();
    let request_body = build_request_body(config);

    utils::log_api_request("Sync app configuration to cloud", "PUT", &url);

    match client
        .put(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status();
            if status.is_success() {
                println!("✅ App config synced to cloud successfully");
            } else {
                let error_text = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unknown error".to_string());
                eprintln!(
                    "⚠️  Failed to sync app config to cloud ({}): {}",
                    status, error_text
                );
            }
        }
        Err(e) => {
            eprintln!("⚠️  Failed to sync app config to cloud: {}", e);
        }
    }
}
