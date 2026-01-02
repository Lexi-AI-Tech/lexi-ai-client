//! Application Configuration Module
//!
//! This module provides unified commands for managing application configuration.
//! All configuration is stored in Tauri Store and synced with OS-level settings (autostart).
//!
//! ## Unified Commands
//! - `get_app_config` - Get complete app configuration
//! - `update_app_config` - Update app configuration (automatically syncs autostart)
//!
//! Unlike auth tokens, app config is stored locally and doesn't require
//! authentication or network access. All configuration is device-specific and
//! persists across application restarts.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = ".app-config.dat";

/// Vocabulary item structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VocabularyItem {
    pub value: String,
    #[serde(rename = "isSystemGenerated")]
    pub is_system_generated: bool,
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

impl Default for AppConfig {
    /// Returns default configuration values
    ///
    /// These defaults are used when no configuration has been saved yet or when
    /// deserialization fails. All values are wrapped in `Some()` to indicate they
    /// are explicitly set defaults.
    fn default() -> Self {
        Self {
            languages: Some(vec!["auto".to_string()]),
            transcription_hotkeys: Some(vec!["Fn".to_string()]),
            enhance_transcription: Some(false),
            transcribe_with_cursor_context: Some(false),
            launch_on_system_startup: Some(true),
            vocabulary: Some(vec![
                VocabularyItem {
                    value: "Lexi".to_string(),
                    is_system_generated: true,
                },
                VocabularyItem {
                    value: "anadi".to_string(),
                    is_system_generated: true,
                },
                VocabularyItem {
                    value: "Ranjeet Baraik".to_string(),
                    is_system_generated: true,
                },
                VocabularyItem {
                    value: "linkedin".to_string(),
                    is_system_generated: true,
                },
                VocabularyItem {
                    value: "google".to_string(),
                    is_system_generated: true,
                },
                VocabularyItem {
                    value: "hey lexi".to_string(),
                    is_system_generated: true,
                },
            ]),
        }
    }
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
/// from OS-level settings. Returns default values if no configuration has been saved yet.
///
/// # Returns
/// * `AppConfig` - The current app configuration or defaults if not found
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
                println!("⚠️  Failed to deserialize config, using defaults: {}", e);
                AppConfig::default()
            }
        }
    } else {
        println!("📝 Using default app config");
        AppConfig::default()
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

/// Update the app configuration in Tauri Store
///
/// Writes directly to persistent storage (Tauri Store) and syncs autostart setting
/// with OS-level configuration.
///
/// # Arguments
/// * `config` - The complete app configuration to save (partial updates supported via Option fields)
///
/// # Returns
/// * `AppConfig` - The saved configuration
#[tauri::command]
pub async fn update_app_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    // Load current config to merge partial updates
    let mut current_config = get_app_config(app.clone())?;

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

    // Save to Tauri Store
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
    Ok(current_config)
}
