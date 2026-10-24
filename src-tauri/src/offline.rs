//! Offline mode settings and model locations.
//!
//! Stored in its own local-only Tauri Store (`.offline.dat`) rather than `AppConfig`, so nothing
//! here is synced to the cloud.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
use tokio::io::AsyncWriteExt;

use crate::commands::auth::get_auth_token_async;

const STORE_FILE: &str = ".offline.dat";
const MODE_KEY: &str = "inference_mode";
const MODELS_DIR: &str = "models";
const SELECTED_MODEL_KEY: &str = "selected_stt_model";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum InferenceMode {
    #[default]
    Cloud,
    Offline,
}

#[derive(Debug, Serialize)]
pub struct OfflineStatus {
    pub mode: InferenceMode,
    /// Whether this build/machine can run local inference (Apple Silicon only).
    pub supported: bool,
    /// File name of the model that will be used for transcription, if any is installed.
    pub stt_model: Option<String>,
    pub models_dir: String,
}

/// Mirrors the server's `HardwareRequirements` DTO field-for-field.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareRequirements {
    pub min_ram_gb: f64,
    pub recommended_ram_gb: f64,
    pub disk_mb: u64,
    pub supported_platforms: Vec<String>,
    pub recommended_chip: String,
    pub gpu_acceleration: String,
}

/// Mirrors the server's `OfflineModelInfo` DTO field-for-field.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerModel {
    pub id: String,
    /// Stable key used to download the model.
    pub slug: String,
    pub name: String,
    pub description: String,
    pub languages: String,
    pub speed: String,
    pub accuracy: String,
    pub hardware: HardwareRequirements,
    pub file_name: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub recommended: bool,
}

#[derive(Debug, Deserialize)]
struct ModelListResponse {
    models: Vec<ServerModel>,
}

/// A server model plus this machine's local state.
#[derive(Debug, Serialize)]
pub struct OfflineModel {
    #[serde(flatten)]
    pub model: ServerModel,
    pub installed: bool,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize)]
struct DownloadProgress {
    id: String,
    downloaded: u64,
    total: u64,
}

fn valid_model_file_name(name: &str) -> bool {
    name.starts_with("ggml-")
        && name.ends_with(".bin")
        && !name.contains(['/', '\\'])
        && !name.contains("..")
}

fn selected_model_name(app: &AppHandle) -> Option<String> {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(SELECTED_MODEL_KEY))
        .and_then(|v| v.as_str().map(str::to_string))
}

fn set_selected_model(app: &AppHandle, file_name: &str) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open offline store: {}", e))?;
    store.set(SELECTED_MODEL_KEY, serde_json::json!(file_name));
    store
        .save()
        .map_err(|e| format!("Failed to save offline store: {}", e))
}

pub fn inference_mode(app: &AppHandle) -> InferenceMode {
    app.store(STORE_FILE)
        .ok()
        .and_then(|store| store.get(MODE_KEY))
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

pub fn is_offline(app: &AppHandle) -> bool {
    inference_mode(app) == InferenceMode::Offline
}

pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(MODELS_DIR))
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))
}

/// The selected model if it is installed, otherwise the first installed ggml model by name.
pub fn find_stt_model(app: &AppHandle) -> Option<PathBuf> {
    let dir = models_dir(app).ok()?;
    if let Some(selected) = selected_model_name(app).filter(|n| valid_model_file_name(n)) {
        let path = dir.join(selected);
        if path.exists() {
            return Some(path);
        }
    }
    let mut models: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(valid_model_file_name)
        })
        .collect();
    models.sort();
    models.into_iter().next()
}

#[tauri::command]
pub fn get_offline_status(app: AppHandle) -> Result<OfflineStatus, String> {
    Ok(OfflineStatus {
        mode: inference_mode(&app),
        supported: crate::engine::stt::SUPPORTED,
        stt_model: find_stt_model(&app)
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())),
        models_dir: models_dir(&app)?.to_string_lossy().into_owned(),
    })
}

async fn authed_get(
    app: &AppHandle,
    client: reqwest::Client,
    path: &str,
) -> Result<reqwest::Response, String> {
    let token = get_auth_token_async(app)
        .await
        .map_err(|_| "Sign in to browse and download models".to_string())?;
    let url = format!("{}{}", crate::config::api_base_url(), path);
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Server error ({}): {}", status, body));
    }
    Ok(response)
}

/// Models offered by the server, merged with what is installed on this machine.
#[tauri::command]
pub async fn list_offline_models(app: AppHandle) -> Result<Vec<OfflineModel>, String> {
    let list: ModelListResponse = authed_get(
        &app,
        crate::utils::create_http_client(),
        &format!("/api/v1/models?os={}", std::env::consts::OS),
    )
    .await?
    .json()
    .await
    .map_err(|e| format!("Invalid model list: {}", e))?;

    let dir = models_dir(&app)?;
    let active =
        find_stt_model(&app).and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()));
    Ok(list
        .models
        .into_iter()
        .map(|model| OfflineModel {
            installed: dir.join(&model.file_name).exists(),
            selected: active.as_deref() == Some(model.file_name.as_str()),
            model,
        })
        .collect())
}

/// Downloads a model through the Lexi server, emitting `offline_model_progress`.
/// Written to a `.part` file, verified (size and sha256 from the server) and renamed on
/// completion so a partial or corrupt file is never picked up.
#[tauri::command]
pub async fn download_offline_model(
    app: AppHandle,
    slug: String,
    file_name: String,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use sha2::{Digest, Sha256};

    if !valid_model_file_name(&file_name) {
        return Err("Invalid model file name".to_string());
    }
    let dir = models_dir(&app)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Failed to create models dir: {}", e))?;
    let final_path = dir.join(&file_name);
    let part_path = dir.join(format!("{}.part", file_name));

    // Models are large: no overall timeout, only a connect timeout.
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    let response = authed_get(
        &app,
        client,
        &format!("/api/v1/models/{}/download", urlencoding::encode(&slug)),
    )
    .await?;
    let total = response.content_length().unwrap_or(0);
    let expected_sha256 = response
        .headers()
        .get("x-content-sha256")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let id = slug.clone();

    let result: Result<(), String> = async {
        let mut file = tokio::fs::File::create(&part_path)
            .await
            .map_err(|e| format!("Failed to create file: {}", e))?;
        let mut hasher = Sha256::new();
        let mut stream = response.bytes_stream();
        let mut downloaded = 0u64;
        let mut last_emit = 0u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Download interrupted: {}", e))?;
            hasher.update(&chunk);
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Failed to write file: {}", e))?;
            downloaded += chunk.len() as u64;
            if downloaded - last_emit >= 512 * 1024 {
                last_emit = downloaded;
                let _ = app.emit(
                    "offline_model_progress",
                    DownloadProgress {
                        id: id.clone(),
                        downloaded,
                        total,
                    },
                );
            }
        }
        file.flush()
            .await
            .map_err(|e| format!("Failed to write file: {}", e))?;
        if total > 0 && downloaded != total {
            return Err("Download incomplete".to_string());
        }
        if let Some(expected) = expected_sha256.as_deref() {
            let actual: String = hasher
                .finalize()
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect();
            if !actual.eq_ignore_ascii_case(expected) {
                return Err("Checksum mismatch; the download is corrupt".to_string());
            }
        }
        Ok(())
    }
    .await;

    match result {
        Ok(()) => {
            tokio::fs::rename(&part_path, &final_path)
                .await
                .map_err(|e| format!("Failed to finalize model: {}", e))?;
            // First model installed becomes the active one.
            if find_stt_model(&app).is_none_or(|p| p == final_path) {
                set_selected_model(&app, &file_name)?;
            }
            Ok(())
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&part_path).await;
            Err(e)
        }
    }
}

#[tauri::command]
pub fn select_offline_model(app: AppHandle, file_name: String) -> Result<(), String> {
    if !valid_model_file_name(&file_name) || !models_dir(&app)?.join(&file_name).exists() {
        return Err("Model is not installed".to_string());
    }
    set_selected_model(&app, &file_name)
}

#[tauri::command]
pub fn delete_offline_model(app: AppHandle, file_name: String) -> Result<(), String> {
    if !valid_model_file_name(&file_name) {
        return Err("Invalid model".to_string());
    }
    std::fs::remove_file(models_dir(&app)?.join(&file_name))
        .map_err(|e| format!("Failed to delete model: {}", e))?;
    // No model left: fall back to cloud so dictation doesn't fail.
    if find_stt_model(&app).is_none() && is_offline(&app) {
        set_inference_mode(app, InferenceMode::Cloud)?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_inference_mode(app: AppHandle, mode: InferenceMode) -> Result<(), String> {
    if mode == InferenceMode::Offline && !crate::engine::stt::SUPPORTED {
        return Err("Offline mode requires an Apple Silicon Mac".to_string());
    }
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to open offline store: {}", e))?;
    store.set(
        MODE_KEY,
        serde_json::to_value(mode).map_err(|e| e.to_string())?,
    );
    store
        .save()
        .map_err(|e| format!("Failed to save offline store: {}", e))?;
    let _ = app.emit("inference_mode_changed", mode);
    Ok(())
}
