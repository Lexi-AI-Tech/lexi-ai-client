//! Application Configuration Module
//!
//! This module provides all Tauri commands for managing application configuration.
//! It is the unified module for all configuration-related functionality, including:
//!
//! ## Configuration Storage (Tauri Store)
//! - App configuration persistence (language, hotkey, transcription settings)
//! - Direct read/write operations to persistent storage
//! - All operations go directly to Tauri Store
//!
//! ## Language Configuration
//! - Set/get transcription language preference
//! - Internal and frontend-facing commands
//!
//! ## Auto-startup Configuration
//! - Enable/disable application auto-start on system boot
//! - Check auto-startup status
//!
//! Unlike auth tokens, app config is stored locally and doesn't require
//! authentication or network access. All configuration is device-specific and
//! persists across application restarts.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = ".app-config.dat";

/// Application configuration structure
///
/// Represents all application settings that are persisted in Tauri Store.
/// All fields are optional to allow for partial updates and backward compatibility.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// Transcription language preference (e.g., "en", "es", "auto")
    pub language: Option<String>,
    /// Global hotkey for triggering recording (e.g., "Fn", "Cmd+Shift+R")
    pub hotkey: Option<String>,
    /// Whether to enhance transcriptions with LLM processing
    pub enhance_transcription: Option<bool>,
    /// Whether to use cursor context when transcribing
    pub transcribe_with_cursor_context: Option<bool>,
}

impl Default for AppConfig {
    /// Returns default configuration values
    ///
    /// These defaults are used when no configuration has been saved yet or when
    /// deserialization fails. All values are wrapped in `Some()` to indicate they
    /// are explicitly set defaults.
    fn default() -> Self {
        Self {
            language: Some("auto".to_string()),
            hotkey: Some("Fn".to_string()),
            enhance_transcription: Some(false),
            transcribe_with_cursor_context: Some(false),
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
/// Reads directly from persistent storage (Tauri Store). Returns default values
/// if no configuration has been saved yet. This is useful when you need to access
/// multiple configuration values at once.
///
/// # Returns
/// * `AppConfig` - The current app configuration or defaults if not found
#[tauri::command]
pub fn get_app_config(app: AppHandle) -> Result<AppConfig, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    // Try to load config from persistent storage
    if let Some(config_value) = store.get("config") {
        match serde_json::from_value::<AppConfig>(config_value.clone()) {
            Ok(config) => {
                println!("✅ Loaded app config from Tauri Store");
                return Ok(config);
            }
            Err(e) => {
                println!("⚠️  Failed to deserialize config, using defaults: {}", e);
            }
        }
    }

    // Return defaults if no config found in persistent storage
    println!("📝 Using default app config");
    Ok(AppConfig::default())
}

/// Update the app configuration in Tauri Store
///
/// Writes directly to persistent storage (Tauri Store).
///
/// # Arguments
/// * `config` - The complete app configuration to save
///
/// # Returns
/// * `AppConfig` - The saved configuration
#[tauri::command]
pub fn update_app_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    let config_json =
        serde_json::to_value(&config).map_err(|e| format!("Failed to serialize config: {}", e))?;

    // Write directly to persistent storage
    store.set("config", config_json);
    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    println!("✅ App config saved to Tauri Store");
    Ok(config)
}

/// Get a specific config value from Tauri Store
///
/// Reads directly from persistent storage. This is a lower-level function that
/// allows retrieving individual configuration values without loading the entire
/// configuration object. Returns None if the key doesn't exist or if the config
/// hasn't been initialized yet.
///
/// # Arguments
/// * `key` - The configuration key to retrieve. Supported keys:
///   - `"language"` - Transcription language preference
///   - `"hotkey"` - Global hotkey for recording
///   - `"enhance_transcription"` - Whether to enhance transcriptions
///   - `"transcribe_with_cursor_context"` - Whether to use cursor context
///
/// # Returns
/// * `Option<serde_json::Value>` - The config value if found, None otherwise
#[tauri::command]
pub fn get_config_value(app: AppHandle, key: String) -> Result<Option<serde_json::Value>, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    if let Some(config_value) = store.get("config") {
        if let Ok(config) = serde_json::from_value::<AppConfig>(config_value.clone()) {
            match key.as_str() {
                "language" => Ok(config.language.map(|v| serde_json::json!(v))),
                "hotkey" => Ok(config.hotkey.map(|v| serde_json::json!(v))),
                "enhance_transcription" => {
                    Ok(config.enhance_transcription.map(|v| serde_json::json!(v)))
                }
                "transcribe_with_cursor_context" => Ok(config
                    .transcribe_with_cursor_context
                    .map(|v| serde_json::json!(v))),
                _ => Err(format!("Unknown config key: {}", key)),
            }
        } else {
            Ok(None)
        }
    } else {
        Ok(None)
    }
}

/// Set a specific config value in Tauri Store
///
/// Updates a single configuration value by loading the current config from persistent
/// storage, updating the specified field, and saving it back. This ensures all
/// configuration is always persisted immediately. This is a lower-level function;
/// for convenience, use the specific setter commands like `set_language()` when available.
///
/// # Arguments
/// * `key` - The configuration key to update. Supported keys:
///   - `"language"` - Transcription language preference (String)
///   - `"hotkey"` - Global hotkey for recording (String)
///   - `"enhance_transcription"` - Whether to enhance transcriptions (bool)
///   - `"transcribe_with_cursor_context"` - Whether to use cursor context (bool)
/// * `value` - The new value to set (must match the expected type for the key)
///
/// # Returns
/// * `Result<(), String>` - Ok if successful, error message otherwise
#[tauri::command]
pub fn set_config_value(
    app: AppHandle,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    // Load current config from persistent storage
    let mut config = get_app_config(app.clone())?;

    // Update the specific field
    match key.as_str() {
        "language" => {
            config.language = value.as_str().map(|s| s.to_string());
        }
        "hotkey" => {
            config.hotkey = value.as_str().map(|s| s.to_string());
        }
        "enhance_transcription" => {
            config.enhance_transcription = value.as_bool();
        }
        "transcribe_with_cursor_context" => {
            config.transcribe_with_cursor_context = value.as_bool();
        }
        _ => return Err(format!("Unknown config key: {}", key)),
    }

    // Save updated config back to persistent storage
    update_app_config(app, config)?;
    Ok(())
}

// ============================================================================
// Language Configuration Commands
//
// These commands provide a convenient interface for managing the transcription
// language preference. They use the underlying get_config_value/set_config_value
// functions to interact with Tauri Store.
// ============================================================================

/// Set the transcription language from frontend
///
/// This command persists the language preference to Tauri Store.
/// The frontend should call this whenever the language preference changes.
///
/// # Arguments
/// * `language` - Optional language code from frontend (e.g., "en", "es", "auto")
#[tauri::command]
pub fn set_language(app: AppHandle, language: Option<String>) -> Result<(), String> {
    // Persist to Tauri Store
    set_config_value(app, "language".to_string(), serde_json::json!(language))?;
    println!("💾 Language saved to Tauri Store: {:?}", language);

    Ok(())
}

/// Get the current transcription language (internal function)
///
/// Reads directly from Tauri Store. This is the internal function used by Rust code.
/// For frontend access, use the `get_language` Tauri command instead.
///
/// # Arguments
/// * `app` - The Tauri AppHandle to access the store
///
/// # Returns
/// * `Option<String>` - The current language code if available, None otherwise
pub fn get_language_internal(app: &AppHandle) -> Result<Option<String>, String> {
    // Read directly from Tauri Store
    if let Ok(Some(language_value)) = get_config_value(app.clone(), "language".to_string()) {
        if let Some(lang) = language_value.as_str() {
            return Ok(Some(lang.to_string()));
        }
    }

    // Return None if not found (defaults will be handled by callers)
    Ok(None)
}

/// Get the current transcription language (Tauri command)
///
/// Reads directly from Tauri Store. This is the Tauri command wrapper for frontend access.
///
/// # Returns
/// * `Option<String>` - The current language code if available, None otherwise
#[tauri::command]
pub fn get_language(app: AppHandle) -> Result<Option<String>, String> {
    get_language_internal(&app)
}

// ============================================================================
// Auto-startup Configuration Commands
//
// These commands manage OS-level auto-startup settings. Unlike other configuration
// which is stored in Tauri Store, auto-startup is managed directly by the OS
// via the tauri-plugin-autostart plugin.
// ============================================================================

/// Enable auto-startup on system startup
///
/// This command enables the application to automatically start when the system boots.
#[tauri::command]
pub async fn enable_autostart(app: AppHandle) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    autolaunch
        .enable()
        .map_err(|e| format!("Failed to enable autostart: {}", e))?;
    println!("✅ Auto-startup enabled");
    Ok(())
}

/// Disable auto-startup on system startup
///
/// This command disables the automatic startup of the application.
#[tauri::command]
pub async fn disable_autostart(app: AppHandle) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    autolaunch
        .disable()
        .map_err(|e| format!("Failed to disable autostart: {}", e))?;
    println!("❌ Auto-startup disabled");
    Ok(())
}

/// Check if auto-startup is enabled
///
/// # Returns
/// * `bool` - true if auto-startup is enabled, false otherwise
#[tauri::command]
pub async fn is_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    let autolaunch = app.autolaunch();
    autolaunch
        .is_enabled()
        .map_err(|e| format!("Failed to check autostart status: {}", e))
}
