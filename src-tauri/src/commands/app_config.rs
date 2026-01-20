//! Application Configuration Module
//!
//! This module provides unified commands for managing application configuration.
//! All configuration is stored in Tauri Store and synced with OS-level settings (autostart).
//! Configuration changes are also synced with the cloud API.
//!
//! ## Unified Commands
//! - `get_app_config` - Get complete app configuration
//! - `update_app_config` - Update app configuration (automatically syncs autostart and cloud)

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_store::StoreExt;

use crate::api_endpoints::app_config;
use crate::commands::auth::get_auth_token_async;
use crate::commands::shortcuts::Shortcut;
use crate::utils;

const STORE_FILE: &str = ".app-config.dat";

/// Vocabulary item structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VocabularyItem {
    pub id: Option<String>,
    pub value: String,
    pub is_system_generated: bool,
    pub hidden: bool,
}

/// Action trigger structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionTrigger {
    pub id: String,
    pub trigger_phrase: String,
    pub is_active: bool,
}

/// Application configuration structure
///
/// Represents all application settings that are persisted in Tauri Store.
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
    /// Vocabulary dictionary for transcription (array of vocabulary items)
    pub vocabulary: Option<Vec<VocabularyItem>>,
    /// Action triggers for voice commands (array of action trigger items)
    pub action_triggers: Option<Vec<ActionTrigger>>,
    /// Shortcuts for text expansion (array of shortcut items)
    pub shortcuts: Option<Vec<Shortcut>>,
}

// ============================================================================
// App Configuration Storage Commands
//
// These commands provide low-level access to the Tauri Store for reading and
// writing application configuration. They handle serialization, deserialization,
// and error handling for the persistent storage layer.
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
    pub vocabulary: Vec<VocabularyItem>,
    pub action_triggers: Vec<ActionTrigger>,
    pub shortcuts: Vec<Shortcut>,
}

/// Get the complete app configuration from Tauri Store or server
///
/// First tries to load from Tauri Store. If not found:
/// - If user is authenticated: fetches from server
/// - If user is not authenticated (first launch): creates minimal config with autostart enabled
/// Config will be synced from server when user logs in (handled in store_auth_data).
/// Syncs autostart status from OS-level settings.
#[tauri::command]
pub async fn get_app_config(app: AppHandle) -> Result<AppConfig, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|_| "Unable to access local storage. Please try again.".to_string())?;

    let mut config = match store.get("config") {
        Some(config_value) => match serde_json::from_value::<AppConfig>(config_value.clone()) {
            Ok(config) => {
                println!("✅ Loaded app config from Tauri Store");
                config
            }
            Err(_) => {
                println!("⚠️  Failed to deserialize config from store, fetching from server");
                match fetch_config_from_server(&app).await {
                    Ok(config) => config,
                    Err(_) => {
                        // No auth - first launch, create minimal config with autostart enabled
                        println!("🔧 First launch detected (no auth), creating minimal config with autostart enabled");
                        create_first_launch_config(&app)?
                    }
                }
            }
        },
        None => {
            println!("📝 No config found in Tauri Store");
            match fetch_config_from_server(&app).await {
                Ok(config) => config,
                Err(_) => {
                    // No auth - first launch, create minimal config with autostart enabled
                    println!("🔧 First launch detected (no auth), creating minimal config with autostart enabled");
                    create_first_launch_config(&app)?
                }
            }
        }
    };

    // Sync launch_on_system_startup with actual OS autostart status
    // This will enable autostart if config has launch_on_system_startup: Some(true) or None (defaults to true)
    sync_autostart_status(&app, &mut config);

    Ok(config)
}

/// Create minimal config for first launch (no auth)
/// Only sets autostart to true - other settings will come from server when user logs in
fn create_first_launch_config(app: &AppHandle) -> Result<AppConfig, String> {
    println!("🔧 Creating first launch config with autostart enabled");

    let first_launch_config = AppConfig {
        languages: None,
        hotkeys: None,
        enhance_transcription: None,
        launch_on_system_startup: Some(true), // Enable autostart by default on first launch
        vocabulary: None,
        action_triggers: None,
        shortcuts: None,
    };

    // Save minimal config to store
    save_config_to_store(app, &first_launch_config)?;

    // Enable autostart on OS immediately
    let autolaunch = app.autolaunch();
    if let Err(e) = autolaunch.enable() {
        eprintln!("⚠️  Failed to enable autostart: {}", e);
    } else {
        println!("✅ Enabled autostart on OS (first launch)");
    }

    Ok(first_launch_config)
}

/// Fetch app configuration from server and save to local store
/// This bypasses the local store and always fetches fresh config from server
pub(crate) async fn fetch_config_from_server(app: &AppHandle) -> Result<AppConfig, String> {
    let auth_token = match get_auth_token_async(app).await {
        Some(token) => token,
        None => {
            // Token refresh failed - emit event to notify frontend
            app.emit("auth_expired", ())
                .unwrap_or_else(|e| eprintln!("Failed to emit auth_expired event: {}", e));
            return Err("Please sign in to sync your settings".to_string());
        }
    };

    let client = reqwest::Client::new();
    let url = app_config::get_url(Some(&format!("system_type={}", utils::get_system_type())));

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
    save_config_to_store(app, &config)?;

    println!("✅ Fetched and saved app config from server");
    Ok(config)
}

/// Update the app configuration in Tauri Store and sync with cloud API
///
/// Merges the provided config with existing config (partial updates supported).
/// Updates local storage and syncs with cloud API.
#[tauri::command]
pub async fn update_app_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    let mut current_config = get_app_config(app.clone()).await?;

    // Merge provided config with current config
    merge_config(&mut current_config, config);

    // Sync autostart with OS if launch_on_system_startup was updated
    if current_config.launch_on_system_startup.is_some() {
        sync_autostart_setting(&app, current_config.launch_on_system_startup.unwrap())
            .map_err(|e| format!("Unable to update startup settings: {}", e))?;
    }

    save_config_to_store(&app, &current_config)?;
    println!("✅ App config saved to Tauri Store");

    sync_config_to_cloud(&app, &current_config).await;

    Ok(current_config)
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

/// Sync autostart setting with OS
fn sync_autostart_setting(app: &AppHandle, should_enable: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if should_enable {
        autolaunch
            .enable()
            .map_err(|_| "Unable to enable startup on login".to_string())?;
        println!("✅ Auto-startup enabled");
    } else {
        autolaunch
            .disable()
            .map_err(|_| "Unable to disable startup on login".to_string())?;
        println!("❌ Auto-startup disabled");
    }
    Ok(())
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
    if provided.action_triggers.is_some() {
        current.action_triggers = provided.action_triggers;
    }
    if provided.shortcuts.is_some() {
        current.shortcuts = provided.shortcuts;
    }
}

/// Save config to Tauri Store
fn save_config_to_store(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|_| "Unable to access local storage. Please try again.".to_string())?;

    let config_json = serde_json::to_value(config)
        .map_err(|_| "Unable to save settings. Please try again.".to_string())?;

    store.set("config", config_json);
    store
        .save()
        .map_err(|_| "Unable to save settings to local storage. Please try again.".to_string())?;

    Ok(())
}

/// Convert server response to local AppConfig format
fn server_response_to_app_config(response: ServerAppConfigResponse) -> AppConfig {
    AppConfig {
        languages: Some(response.languages),
        hotkeys: Some(response.hotkeys),
        enhance_transcription: Some(response.enhance_transcription),
        launch_on_system_startup: Some(response.launch_on_system_startup),
        vocabulary: Some(response.vocabulary),
        action_triggers: Some(response.action_triggers),
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
    if let Some(ref action_triggers) = config.action_triggers {
        body.insert(
            "action_triggers".to_string(),
            serde_json::to_value(action_triggers).unwrap(),
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
