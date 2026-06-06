//! Local storage for the signed feature usage JWT (Tauri Store).

use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = ".feature_usage.dat";
const FEATURE_USAGE_KEY: &str = "feature_usage";

pub fn get_feature_usage(app: &AppHandle) -> Option<String> {
    let store = app.store(STORE_FILE).ok()?;
    let value = store.get(FEATURE_USAGE_KEY)?;
    value.as_str().map(|s| s.to_string())
}

pub fn save_feature_usage(app: &AppHandle, jwt: &str) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open feature usage store: {}", e))?;
    store.set(
        FEATURE_USAGE_KEY,
        serde_json::Value::String(jwt.to_string()),
    );
    store
        .save()
        .map_err(|e| format!("Failed to save feature usage store: {}", e))?;
    Ok(())
}

pub fn clear_feature_usage_store(app: &AppHandle) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open feature usage store: {}", e))?;
    store.delete(FEATURE_USAGE_KEY);
    store
        .save()
        .map_err(|e| format!("Failed to save feature usage store: {}", e))?;
    Ok(())
}
