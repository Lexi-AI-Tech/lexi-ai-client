//! Persistent local storage for app configuration (Tauri Store).

use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

use crate::commands::app_config::AppConfig;

const STORE_FILE: &str = ".app_config.dat";
const CONFIG_KEY: &str = "app_config";

/// Load app config from the local Tauri Store.
pub fn load_local_config(app: &AppHandle) -> Option<AppConfig> {
    let store = app.store(STORE_FILE).ok()?;
    let value = store.get(CONFIG_KEY)?;
    serde_json::from_value(value).ok()
}

/// Persist app config to the local Tauri Store and notify the UI.
pub fn save_local_config(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open app config store: {}", e))?;

    let value = serde_json::to_value(config)
        .map_err(|e| format!("Failed to serialize app config: {}", e))?;

    store.set(CONFIG_KEY, value);
    store
        .save()
        .map_err(|e| format!("Failed to save app config store: {}", e))?;

    let _ = app.emit("app_config_changed", ());
    Ok(())
}

/// Remove persisted app config (e.g. on logout).
pub fn clear_local_config(app: &AppHandle) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open app config store: {}", e))?;

    store.delete(CONFIG_KEY);
    store
        .save()
        .map_err(|e| format!("Failed to save app config store: {}", e))?;

    let _ = app.emit("app_config_changed", ());
    Ok(())
}
