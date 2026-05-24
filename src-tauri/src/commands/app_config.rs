//! Application Configuration Module
//!
//! Cloud DB is the durable source of truth; the local Tauri Store is the runtime source.
//! Settings updates go cloud-first; local store is updated only after a successful response.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::api_endpoints::app_config;
use crate::commands::auth::get_auth_token_async;
use crate::commands::shortcuts::Shortcut;
use crate::state::{ActionHotkeyWatchState, HotkeyWatchState, OnboardingRecordingDryRun};
use crate::utils;
use std::sync::atomic::Ordering;

use crate::commands::app_config_store::{load_local_config, save_local_config};

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
    /// Whether to show the app icon in the dock
    pub show_icon: Option<bool>,
    /// Shortcuts for text expansion (array of shortcut items)
    pub shortcuts: Option<Vec<Shortcut>>,
}

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
    pub show_icon: bool,
    pub shortcuts: Vec<Shortcut>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefaultHotkeysResponse {
    pub hotkeys: Vec<String>,
    pub action_hotkeys: Vec<String>,
}

/// Fetches app config from the Tauri store and returns it.
pub fn load_app_config(app: &AppHandle) -> Result<AppConfig, String> {
    load_local_config(app).ok_or_else(|| {
        "App configuration not loaded. Please wait for settings to sync.".to_string()
    })
}

/// Primary language from local store (meetings WebSocket, rooms).
pub fn get_primary_language_from_store(app: &AppHandle) -> String {
    load_local_config(app)
        .and_then(|c| c.languages)
        .and_then(|langs| langs.first().cloned())
        .unwrap_or_else(|| "auto".to_string())
}

/// Return config from local store; hydrate from cloud if missing.
#[tauri::command]
pub async fn get_app_config(app: AppHandle) -> Result<AppConfig, String> {
    if let Some(config) = load_local_config(&app) {
        return Ok(config);
    }

    hydrate_app_config_from_cloud(&app).await
}

/// Fetch latest config from cloud, persist locally, and apply OS/hotkey side effects.
#[tauri::command]
pub async fn refresh_app_config(app: AppHandle) -> Result<AppConfig, String> {
    hydrate_app_config_from_cloud(&app).await
}

/// Startup/login hydration: cloud GET → local store → OS sync.
pub async fn hydrate_app_config_from_cloud(app: &AppHandle) -> Result<AppConfig, String> {
    println!("🔄 Hydrating app config from cloud...");

    match fetch_config_from_server(app).await {
        Ok(config) => {
            let config = apply_config_side_effects(app, config, true)?;
            println!(
                "✅ App config hydrated with hotkeys: {:?}",
                config.hotkeys
            );
            Ok(config)
        }
        Err(e) => {
            println!("⚠️  Failed to fetch from cloud: {}", e);
            if let Some(local) = load_local_config(app) {
                println!("📦 Using cached local app config");
                return Ok(apply_config_side_effects(app, local, false)?);
            }
            Err(e)
        }
    }
}

/// Get server-defined default hotkeys (used by "Reset to defaults").
#[tauri::command]
pub async fn get_default_hotkeys(app: AppHandle) -> Result<DefaultHotkeysResponse, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Ok(token) => token,
        Err(e) if e == "network_error" => {
            return Err(
                "Network error while trying to authenticate. Please check your connection."
                    .to_string(),
            );
        }
        Err(_) => {
            crate::commands::auth::handle_auth_expired(&app);
            return Err("Please sign in to sync your settings".to_string());
        }
    };

    let client = crate::utils::create_http_client();
    let url = app_config::defaults_hotkeys_url(Some(&format!(
        "system_type={}",
        utils::get_system_type()
    )));

    utils::log_api_request("GET", &url);

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
        return Err(format!("Unable to load default hotkeys: {}", error_msg));
    }

    let server_response: DefaultHotkeysResponse = response.json().await.map_err(|_| {
        "Received invalid default-hotkeys format from server. Please try again.".to_string()
    })?;

    Ok(server_response)
}

/// Fetch app configuration from server
/// This always fetches fresh config from server
pub(crate) async fn fetch_config_from_server(app: &AppHandle) -> Result<AppConfig, String> {
    let auth_token = match get_auth_token_async(app).await {
        Ok(token) => token,
        Err(e) if e == "network_error" => {
            return Err(
                "Network error while trying to authenticate. Please check your connection."
                    .to_string(),
            );
        }
        Err(_) => {
            crate::commands::auth::handle_auth_expired(app);
            return Err("Please sign in to sync your settings".to_string());
        }
    };

    let client = crate::utils::create_http_client();
    let url = app_config::get_url(Some(&format!("system_type={}", utils::get_system_type())));

    utils::log_api_request("GET", &url);

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

/// Cloud-first update: merge with local → PUT → persist response locally.
#[tauri::command]
pub async fn update_app_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    let mut current_config = load_local_config(&app).unwrap_or_default();
    merge_config(&mut current_config, config);

    let updated_config = sync_config_to_cloud(&app, &current_config).await?;
    apply_config_side_effects(&app, updated_config, true)
}

/// Merge shortcuts into the local store after shortcuts CRUD API calls.
pub fn merge_shortcuts_into_local_store(
    app: &AppHandle,
    shortcuts: Vec<Shortcut>,
) -> Result<(), String> {
    let mut config = load_local_config(app).unwrap_or_default();
    config.shortcuts = Some(shortcuts);
    apply_config_side_effects(app, config, true)?;
    Ok(())
}

fn apply_config_side_effects(
    app: &AppHandle,
    mut config: AppConfig,
    persist: bool,
) -> Result<AppConfig, String> {
    sync_autostart_status(app, &mut config);
    sync_dock_icon_status(app, &config);
    update_hotkey_state(app, &config);

    if persist {
        save_local_config(app, &config)?;
    }

    Ok(config)
}

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

/// Sync dock icon visibility status from config
#[cfg(target_os = "macos")]
pub(crate) fn sync_dock_icon_status(app: &AppHandle, config: &AppConfig) {
    // Default to true (icon is visible) if not set
    let show_icon = config.show_icon.unwrap_or(true);

    // Tauri's set_dock_visibility under the hood calls macOS TransformProcessType
    let _ = app.set_dock_visibility(show_icon);

    println!("✅ Synced: app icon shown = {}", show_icon);
}

/// When `show_icon` is false, hide the main window from the taskbar (tray remains).
#[cfg(target_os = "windows")]
pub(crate) fn sync_dock_icon_status(app: &AppHandle, config: &AppConfig) {
    let show_icon = config.show_icon.unwrap_or(true);
    let skip_taskbar = !show_icon;
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.set_skip_taskbar(skip_taskbar) {
            eprintln!("⚠️ Failed to set_skip_taskbar on main window: {}", e);
        }
    }
    println!("✅ Synced: taskbar icon (main window) shown = {}", show_icon);
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
pub(crate) fn sync_dock_icon_status(_app: &AppHandle, _config: &AppConfig) {}

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
    if provided.show_icon.is_some() {
        current.show_icon = provided.show_icon;
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
        show_icon: Some(response.show_icon),
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
    if let Some(show_icon) = config.show_icon {
        body.insert(
            "show_icon".to_string(),
            serde_json::to_value(show_icon).unwrap(),
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

async fn sync_config_to_cloud(app: &AppHandle, config: &AppConfig) -> Result<AppConfig, String> {
    let auth_token = get_auth_token_async(app)
        .await
        .map_err(|_| "Please sign in to sync your settings".to_string())?;

    let client = crate::utils::create_http_client();
    let url = app_config::update_url();
    let request_body = build_request_body(config);

    utils::log_api_request("PUT", &url);

    let response = client
        .put(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let json_value: serde_json::Value = response
            .json()
            .await
            .unwrap_or_else(|_| serde_json::json!({}));
        let error_msg = extract_error_message(&json_value, status);
        return Err(error_msg);
    }

    let server_response: ServerAppConfigResponse = response.json().await.map_err(|_| {
        "Received invalid settings format from server. Please try again.".to_string()
    })?;

    Ok(server_response_to_app_config(server_response))
}

/// Fallback when server default-hotkeys API is unavailable.
fn local_onboarding_hotkey_fallback() -> DefaultHotkeysResponse {
    #[cfg(target_os = "macos")]
    {
        DefaultHotkeysResponse {
            hotkeys: vec!["Fn".to_string()],
            action_hotkeys: vec!["Fn+Control".to_string()],
        }
    }
    #[cfg(target_os = "windows")]
    {
        DefaultHotkeysResponse {
            hotkeys: vec!["Control+Windows".to_string()],
            action_hotkeys: vec!["Control+Alt".to_string()],
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        DefaultHotkeysResponse {
            hotkeys: vec!["Control".to_string()],
            action_hotkeys: vec!["Control+Shift".to_string()],
        }
    }
}

/// Onboarding hotkey step: avoid transcription/actions API on recording stop; listener uses server defaults (or local fallback).
#[tauri::command]
pub async fn begin_onboarding_hotkey_dry_run(
    app: AppHandle,
    dry_run: tauri::State<'_, OnboardingRecordingDryRun>,
) -> Result<DefaultHotkeysResponse, String> {
    dry_run.0.store(true, Ordering::SeqCst);

    let defaults = match get_default_hotkeys(app.clone()).await {
        Ok(d) => d,
        Err(e) => {
            println!(
                "⚠️  begin_onboarding_hotkey_dry_run: using local fallback ({})",
                e
            );
            local_onboarding_hotkey_fallback()
        }
    };

    if let Some(hotkey_state) = app.try_state::<HotkeyWatchState>() {
        let _ = hotkey_state.0.send(defaults.hotkeys.clone());
    }
    if let Some(action_state) = app.try_state::<ActionHotkeyWatchState>() {
        let _ = action_state.0.send(defaults.action_hotkeys.clone());
    }

    println!(
        "🧪 Onboarding hotkey dry-run ON; listener defaults: {:?} / {:?}",
        defaults.hotkeys, defaults.action_hotkeys
    );

    Ok(defaults)
}

#[tauri::command]
pub async fn end_onboarding_hotkey_dry_run(
    app: AppHandle,
    dry_run: tauri::State<'_, OnboardingRecordingDryRun>,
) -> Result<(), String> {
    dry_run.0.store(false, Ordering::SeqCst);

    match get_app_config(app.clone()).await {
        Ok(cfg) => {
            update_hotkey_state(&app, &cfg);
            println!("🧪 Onboarding hotkey dry-run OFF (hotkeys restored from app config)");
        }
        Err(e) => println!(
            "⚠️  end_onboarding_hotkey_dry_run: could not refresh app config: {}",
            e
        ),
    }

    Ok(())
}
