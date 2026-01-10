//! Model Management Commands
//!
//! Tauri commands for managing Whisper models and executables.
//! These commands allow the frontend to:
//! - List available models
//! - Check which models are installed
//! - Get model and executable paths

use crate::model_manager;
use tauri::command;

/// Lists all available models that can be downloaded
///
/// Returns a list of models with their metadata including:
/// - Model ID and display name
/// - Size information
/// - Download status
/// - Download URLs
///
/// # Returns
/// * `Vec<ModelInfo>` - List of available models
#[command]
pub fn list_available_models() -> Vec<model_manager::ModelInfo> {
    let mut models = model_manager::list_available_models();

    // Update is_downloaded status for each model
    for model in &mut models {
        model.is_downloaded = model_manager::model_exists(&model.id).unwrap_or(false);

        // Update size if model is downloaded
        if model.is_downloaded {
            if let Ok(path) = model_manager::resolve_model_path(&model.id) {
                if let Ok(metadata) = std::fs::metadata(&path) {
                    model.size = Some(metadata.len());
                }
            }
        }
    }

    models
}

/// Gets information about installed models
///
/// Scans the models directory and returns information about downloaded models.
///
/// # Returns
/// * `Result<Vec<ModelInfo>, String>` - List of installed models or error message
#[command]
pub fn get_installed_models() -> Result<Vec<model_manager::ModelInfo>, String> {
    model_manager::get_installed_models()
}

/// Checks if a specific model is installed
///
/// # Arguments
/// * `model_id` - Identifier of the model to check (e.g., "ggml-small-q5_1.bin")
///
/// # Returns
/// * `Result<bool, String>` - True if model is installed, false otherwise, or error
#[command]
pub fn is_model_installed(model_id: String) -> Result<bool, String> {
    model_manager::model_exists(&model_id)
}

/// Gets the path where models are stored
///
/// # Returns
/// * `Result<String, String>` - Path to the models directory or error message
#[command]
pub fn get_models_directory() -> Result<String, String> {
    model_manager::get_models_directory().map(|p| p.to_string_lossy().to_string())
}

/// Gets the path where executables are stored
///
/// # Returns
/// * `Result<String, String>` - Path to the executables directory or error message
#[command]
pub fn get_executables_directory() -> Result<String, String> {
    model_manager::get_executables_directory().map(|p| p.to_string_lossy().to_string())
}

/// Checks if the whisper executable is installed
///
/// # Returns
/// * `Result<bool, String>` - True if executable exists, false otherwise, or error
// #[command]
// pub fn is_whisper_executable_installed() -> Result<bool, String> {
//     model_manager::whisper_executable_exists()
// }
