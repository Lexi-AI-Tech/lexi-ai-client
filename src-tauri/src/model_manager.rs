//! Model Management Module
//!
//! This module handles downloading, managing, and resolving paths for Whisper models.
//! Models are stored in a user-accessible directory instead of being bundled with the app.
//!
//! ## Architecture
//!
//! - Models are stored in a platform-specific user data directory
//! - Users can download models on-demand through the UI
//! - The module provides functions to check model availability and resolve paths
//!
//! ## Future Implementation
//!
//! This module contains placeholders for:
//! - Downloading models from remote sources
//! - Listing available models
//! - Managing model versions
//! - Verifying model integrity

use std::path::PathBuf;

/// Gets the base directory where models should be stored
///
/// Returns a platform-specific path:
/// - macOS: `~/Library/Application Support/com.lexi.ai/models`
/// - Linux: `~/.local/share/lexi-ai/models`
/// - Windows: `%APPDATA%\lexi-ai\models`
///
/// # Returns
/// * `Ok(PathBuf)` - The models directory path
/// * `Err(String)` - Error message if path cannot be determined
pub fn get_models_directory() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME environment variable not set")?;
        Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.lexi.ai")
            .join("models"))
    }

    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME environment variable not set")?;
        Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("lexi-ai")
            .join("models"))
    }

    #[cfg(target_os = "windows")]
    {
        let appdata =
            std::env::var("APPDATA").map_err(|_| "APPDATA environment variable not set")?;
        Ok(PathBuf::from(appdata).join("lexi-ai").join("models"))
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Err("Unsupported platform".to_string())
    }
}

/// Gets the directory where executables (like whisper binary) should be stored
///
/// # Returns
/// * `Ok(PathBuf)` - The executables directory path
/// * `Err(String)` - Error message if path cannot be determined
pub fn get_executables_directory() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME environment variable not set")?;
        Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.lexi.ai")
            .join("bin"))
    }

    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME environment variable not set")?;
        Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("lexi-ai")
            .join("bin"))
    }

    #[cfg(target_os = "windows")]
    {
        let appdata =
            std::env::var("APPDATA").map_err(|_| "APPDATA environment variable not set")?;
        Ok(PathBuf::from(appdata).join("lexi-ai").join("bin"))
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Err("Unsupported platform".to_string())
    }
}

/// Ensures the models directory exists
///
/// Creates the directory if it doesn't exist.
///
/// # Returns
/// * `Ok(PathBuf)` - The models directory path
/// * `Err(String)` - Error message if directory cannot be created
pub fn ensure_models_directory() -> Result<PathBuf, String> {
    let dir = get_models_directory()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create models directory: {}", e))?;
    Ok(dir)
}

/// Ensures the executables directory exists
///
/// # Returns
/// * `Ok(PathBuf)` - The executables directory path
/// * `Err(String)` - Error message if directory cannot be created
pub fn ensure_executables_directory() -> Result<PathBuf, String> {
    let dir = get_executables_directory()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create executables directory: {}", e))?;
    Ok(dir)
}

/// Resolves the path to a specific model file
///
/// # Arguments
/// * `model_name` - Name of the model file (e.g., "ggml-small-q5_1.bin")
///
/// # Returns
/// * `Ok(PathBuf)` - The full path to the model file
/// * `Err(String)` - Error message if path cannot be resolved
pub fn resolve_model_path(model_name: &str) -> Result<PathBuf, String> {
    let models_dir = get_models_directory()?;
    Ok(models_dir.join(model_name))
}

/// Checks if a model file exists
///
/// # Arguments
/// * `model_name` - Name of the model file (e.g., "ggml-small-q5_1.bin")
///
/// # Returns
/// * `Ok(bool)` - True if the model exists, false otherwise
/// * `Err(String)` - Error message if path cannot be resolved
pub fn model_exists(model_name: &str) -> Result<bool, String> {
    let model_path = resolve_model_path(model_name)?;
    Ok(model_path.exists())
}

/// Resolves the path to the whisper executable
///
/// # Returns
/// * `Ok(PathBuf)` - The full path to the whisper executable
/// * `Err(String)` - Error message if path cannot be resolved
pub fn resolve_whisper_executable_path() -> Result<PathBuf, String> {
    let bin_dir = get_executables_directory()?;
    #[cfg(target_os = "windows")]
    {
        Ok(bin_dir.join("whisper.exe"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(bin_dir.join("whisper"))
    }
}

/// Checks if the whisper executable exists
///
/// # Returns
/// * `Ok(bool)` - True if the executable exists, false otherwise
/// * `Err(String)` - Error message if path cannot be resolved
pub fn whisper_executable_exists() -> Result<bool, String> {
    let exe_path = resolve_whisper_executable_path()?;
    Ok(exe_path.exists())
}

/// Information about an available model
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModelInfo {
    /// Model identifier (e.g., "ggml-small-q5_1.bin")
    pub id: String,
    /// Display name for the model
    pub name: String,
    /// Model size in bytes
    pub size: Option<u64>,
    /// Whether the model is currently downloaded
    pub is_downloaded: bool,
    /// Download URL for the model (placeholder for future implementation)
    pub download_url: Option<String>,
}

/// Lists all available models (placeholder for future implementation)
///
/// This is a placeholder that returns a default set of models.
/// In the future, this could fetch available models from a remote API or config file.
///
/// # Returns
/// * `Vec<ModelInfo>` - List of available models
pub fn list_available_models() -> Vec<ModelInfo> {
    // Placeholder: Return a default set of models
    // In the future, this could be fetched from a remote API or config file
    vec![
        ModelInfo {
            id: "ggml-tiny-q5_1.bin".to_string(),
            name: "Whisper Tiny (Multilingual)".to_string(),
            size: Some(75 * 1024 * 1024), // ~75 MB
            is_downloaded: false,
            download_url: Some("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin".to_string()),
        },
        ModelInfo {
            id: "ggml-base-q5_1.bin".to_string(),
            name: "Whisper Base (Multilingual)".to_string(),
            size: Some(142 * 1024 * 1024), // ~142 MB
            is_downloaded: false,
            download_url: Some("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin".to_string()),
        },
        ModelInfo {
            id: "ggml-small-q5_1.bin".to_string(),
            name: "Whisper Small (Multilingual)".to_string(),
            size: Some(181 * 1024 * 1024), // ~181 MB
            is_downloaded: false,
            download_url: Some("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin".to_string()),
        },
        ModelInfo {
            id: "ggml-small.en-q5_1.bin".to_string(),
            name: "Whisper Small (English Only)".to_string(),
            size: Some(181 * 1024 * 1024), // ~181 MB
            is_downloaded: false,
            download_url: Some("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin".to_string()),
        },
        ModelInfo {
            id: "ggml-large-v3-turbo-q5_0.bin".to_string(),
            name: "Whisper Large v3 Turbo (Multilingual)".to_string(),
            size: Some(547 * 1024 * 1024), // ~547 MB
            is_downloaded: false,
            download_url: Some("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin".to_string()),
        },
    ]
}

/// Gets information about installed models
///
/// Scans the models directory and returns information about downloaded models.
///
/// # Returns
/// * `Ok(Vec<ModelInfo>)` - List of installed models with their sizes
/// * `Err(String)` - Error message if directory cannot be accessed
pub fn get_installed_models() -> Result<Vec<ModelInfo>, String> {
    let models_dir = get_models_directory()?;

    if !models_dir.exists() {
        return Ok(vec![]);
    }

    let mut installed = Vec::new();
    let available = list_available_models();

    // Check which available models are installed
    for model in available {
        let model_path = models_dir.join(&model.id);
        if model_path.exists() {
            let size = std::fs::metadata(&model_path).ok().map(|m| m.len());

            installed.push(ModelInfo {
                id: model.id.clone(),
                name: model.name.clone(),
                size,
                is_downloaded: true,
                download_url: model.download_url.clone(),
            });
        }
    }

    Ok(installed)
}

/// Downloads a model from a remote URL (placeholder for future implementation)
///
/// This is a placeholder function. In the future, this will:
/// 1. Download the model from the provided URL
/// 2. Show progress updates
/// 3. Verify the downloaded file integrity
/// 4. Handle errors and retries
///
/// # Arguments
/// * `model_id` - Identifier of the model to download
/// * `download_url` - URL to download the model from
/// * `progress_callback` - Optional callback for progress updates (placeholder)
///
/// # Returns
/// * `Ok(PathBuf)` - Path to the downloaded model file
/// * `Err(String)` - Error message if download fails
pub async fn download_model(
    _model_id: &str,
    _download_url: &str,
    _progress_callback: Option<Box<dyn Fn(u64, u64) + Send + Sync>>,
) -> Result<PathBuf, String> {
    // Placeholder: This will be implemented in the future
    Err("Model download is not yet implemented. Please download models manually and place them in the models directory.".to_string())
}
