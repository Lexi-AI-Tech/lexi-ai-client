//! Application Configuration Module
//!
//! This module provides unified commands for managing application configuration.
//! All configuration is stored in Tauri Store and synced with OS-level settings (autostart).
//! Configuration changes are also synced with the cloud API when authenticated.
//!
//! ## Unified Commands
//! - `get_app_config` - Get complete app configuration
//! - `update_app_config` - Update app configuration (automatically syncs autostart and cloud)
//!
//! Configuration is stored locally in Tauri Store and synced with the cloud API when
//! the user is authenticated. This ensures settings persist across devices.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_store::StoreExt;

use crate::commands::auth::get_auth_token;
use crate::config;

const STORE_FILE: &str = ".app-config.dat";

/// Vocabulary item structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VocabularyItem {
    pub value: String,
    pub is_system_generated: bool,
    pub hidden: bool,
}

/// Application configuration structure
///
/// Represents all application settings that are persisted in Tauri Store.
/// All fields are optional to allow for partial updates and backward compatibility.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// Transcription language preferences (e.g., ["en"], ["es"], ["auto"])
    pub languages: Option<Vec<String>>,
    /// Global hotkeys for triggering recording (e.g., ["Fn"], ["Cmd+Shift+R"])
    pub transcription_hotkeys: Option<Vec<String>>,
    /// Whether to enhance transcriptions with LLM processing
    pub enhance_transcription: Option<bool>,
    /// Whether to use cursor context when transcribing
    pub transcribe_with_cursor_context: Option<bool>,
    /// Whether to launch application on system startup
    pub launch_on_system_startup: Option<bool>,
    /// Vocabulary dictionary for transcription (array of vocabulary items)
    pub vocabulary: Option<Vec<VocabularyItem>>,
}

// ============================================================================
// App Configuration Storage Commands
//
// These commands provide low-level access to the Tauri Store for reading and
// writing application configuration. They handle serialization, deserialization,
// and error handling for the persistent storage layer.
// ============================================================================

/// Get the complete app configuration from Tauri Store
///
/// Reads directly from persistent storage (Tauri Store) and syncs autostart status
/// from OS-level settings. Returns empty config if no configuration has been saved yet.
/// The server will provide default values when needed.
///
/// # Returns
/// * `AppConfig` - The current app configuration or empty config if not found
#[tauri::command]
pub async fn get_app_config(app: AppHandle) -> Result<AppConfig, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    let mut config = if let Some(config_value) = store.get("config") {
        match serde_json::from_value::<AppConfig>(config_value.clone()) {
            Ok(config) => {
                println!("✅ Loaded app config from Tauri Store");
                config
            }
            Err(e) => {
                println!(
                    "⚠️  Failed to deserialize config, returning empty config: {}",
                    e
                );
                AppConfig {
                    languages: None,
                    transcription_hotkeys: None,
                    enhance_transcription: None,
                    transcribe_with_cursor_context: None,
                    launch_on_system_startup: None,
                    vocabulary: None,
                }
            }
        }
    } else {
        println!("📝 No config found in Tauri Store, returning empty config");
        AppConfig {
            languages: None,
            transcription_hotkeys: None,
            enhance_transcription: None,
            transcribe_with_cursor_context: None,
            launch_on_system_startup: None,
            vocabulary: None,
        }
    };

    // Sync launch_on_system_startup with actual OS autostart status
    let autolaunch = app.autolaunch();
    match autolaunch.is_enabled() {
        Ok(enabled) => {
            config.launch_on_system_startup = Some(enabled);
        }
        Err(e) => {
            println!("⚠️  Failed to check autostart status: {}", e);
        }
    }

    Ok(config)
}

/// Update the app configuration in Tauri Store and sync with cloud API
///
/// This function performs two operations:
/// 1. Updates the local Tauri Store with the new configuration
/// 2. Syncs the configuration with the cloud API (if authenticated)
///
/// Writes directly to persistent storage (Tauri Store) and syncs autostart setting
/// with OS-level configuration. Also attempts to sync with cloud API.
///
/// # Arguments
/// * `config` - The complete app configuration to save (partial updates supported via Option fields)
///
/// # Returns
/// * `AppConfig` - The saved configuration
#[tauri::command]
pub async fn update_app_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    // Load current config to merge partial updates
    let mut current_config = get_app_config(app.clone()).await?;

    // Merge provided config with current config (only update provided fields)
    if config.languages.is_some() {
        current_config.languages = config.languages;
    }
    if config.transcription_hotkeys.is_some() {
        current_config.transcription_hotkeys = config.transcription_hotkeys;
    }
    if config.enhance_transcription.is_some() {
        current_config.enhance_transcription = config.enhance_transcription;
    }
    if config.transcribe_with_cursor_context.is_some() {
        current_config.transcribe_with_cursor_context = config.transcribe_with_cursor_context;
    }
    if config.launch_on_system_startup.is_some() {
        current_config.launch_on_system_startup = config.launch_on_system_startup;
    }
    if config.vocabulary.is_some() {
        current_config.vocabulary = config.vocabulary;
    }

    // Sync autostart with OS if launch_on_system_startup was updated
    if config.launch_on_system_startup.is_some() {
        let autolaunch = app.autolaunch();
        let should_enable = current_config.launch_on_system_startup.unwrap_or(false);
        if should_enable {
            autolaunch
                .enable()
                .map_err(|e| format!("Failed to enable autostart: {}", e))?;
            println!("✅ Auto-startup enabled");
        } else {
            autolaunch
                .disable()
                .map_err(|e| format!("Failed to disable autostart: {}", e))?;
            println!("❌ Auto-startup disabled");
        }
    }

    // 1. Save to Tauri Store (local storage)
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    let config_json = serde_json::to_value(&current_config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    store.set("config", config_json);
    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    println!("✅ App config saved to Tauri Store");

    // 2. Sync with cloud API (if authenticated)
    sync_config_to_cloud(&app, &current_config).await;

    Ok(current_config)
}

/// Sync app configuration to cloud API
///
/// Attempts to update the user's app configuration on the server.
/// This is a best-effort operation - failures are logged but don't prevent
/// the local update from succeeding.
///
/// # Arguments
/// * `app` - The Tauri AppHandle
/// * `config` - The configuration to sync
async fn sync_config_to_cloud(app: &AppHandle, config: &AppConfig) {
    // Get authentication token
    let auth_token = match get_auth_token(app) {
        Some(token) => token,
        None => {
            println!("⚠️  No auth token available, skipping cloud sync");
            return;
        }
    };

    // Build the API request payload
    // Only include fields that are Some (not None) for partial updates
    let mut request_body = serde_json::Map::new();

    if let Some(ref languages) = config.languages {
        request_body.insert(
            "languages".to_string(),
            serde_json::to_value(languages).unwrap(),
        );
    }
    if let Some(ref transcription_hotkeys) = config.transcription_hotkeys {
        request_body.insert(
            "transcription_hotkeys".to_string(),
            serde_json::to_value(transcription_hotkeys).unwrap(),
        );
    }
    if let Some(enhance_transcription) = config.enhance_transcription {
        request_body.insert(
            "enhance_transcription".to_string(),
            serde_json::to_value(enhance_transcription).unwrap(),
        );
    }
    if let Some(transcribe_with_cursor_context) = config.transcribe_with_cursor_context {
        request_body.insert(
            "transcribe_with_cursor_context".to_string(),
            serde_json::to_value(transcribe_with_cursor_context).unwrap(),
        );
    }
    if let Some(launch_on_system_startup) = config.launch_on_system_startup {
        request_body.insert(
            "launch_on_system_startup".to_string(),
            serde_json::to_value(launch_on_system_startup).unwrap(),
        );
    }
    if let Some(ref vocabulary) = config.vocabulary {
        request_body.insert(
            "vocabulary".to_string(),
            serde_json::to_value(vocabulary).unwrap(),
        );
    }

    // Add system_type (default to "mac" for now)
    request_body.insert(
        "system_type".to_string(),
        serde_json::Value::String("mac".to_string()),
    );

    // Make API request
    let client = reqwest::Client::new();
    let api_base_url = config::api_base_url();
    let url = format!("{}/api/users/me/config", api_base_url);

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
