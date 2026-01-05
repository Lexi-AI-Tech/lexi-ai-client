//! Whisper.cpp Integration Module
//!
//! This module provides local speech-to-text transcription using whisper.cpp binary.
//! It handles path resolution for user-downloaded resources and executes the whisper.cpp
//! binary to transcribe audio files.
//!
//! ## Architecture
//!
//! - Uses external whisper.cpp binary stored in user data directory
//! - Uses models stored in user data directory (downloaded on-demand)
//! - Requires pre-recorded audio file in WAV format (16 kHz, mono, 16-bit PCM)
//! - Returns plain text transcription
//!
//! ## Resources
//!
//! Models and executables are stored in platform-specific user data directories:
//! - macOS: `~/Library/Application Support/com.lexi.ai/`
//! - Linux: `~/.local/share/lexi-ai/`
//! - Windows: `%APPDATA%\lexi-ai\`
//!
//! Users can download models through the UI. The default model is `ggml-small-q5_1.bin`.

use crate::model_manager;
use std::path::PathBuf;
use std::process::Command;
use uuid::Uuid;

/// Resolves the paths to the whisper binary and model file
///
/// Searches in the following order:
/// 1. User data directory (primary location for downloaded models/executables)
/// 2. Development paths (only in debug mode, for local testing)
///
/// # Returns
/// * `Ok((PathBuf, PathBuf))` - Tuple of (whisper_bin_path, model_path)
/// * `Err(String)` - Error message if paths cannot be resolved
pub fn resolve_whisper_paths() -> Result<(PathBuf, PathBuf), String> {
    // Default model name (can be made configurable in the future)
    let default_model = "ggml-small-q5_1.bin";

    // Try to get whisper executable from user data directory
    let whisper_bin = match model_manager::resolve_whisper_executable_path() {
        Ok(path) if path.exists() => path,
        _ => {
            // Fallback to development paths in debug mode
            #[cfg(debug_assertions)]
            {
                if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
                    let dev_path = PathBuf::from(manifest_dir).join("bin").join("whisper");
                    #[cfg(target_os = "windows")]
                    let dev_path = dev_path.with_extension("exe");
                    if dev_path.exists() {
                        dev_path
                    } else {
                        return Err(format!(
                            "Whisper executable not found. Please download it and place it in: {}",
                            model_manager::get_executables_directory()
                                .unwrap_or_else(|_| PathBuf::from("user-data/bin"))
                                .display()
                        ));
                    }
                } else {
                    return Err(format!(
                        "Whisper executable not found. Please download it and place it in: {}",
                        model_manager::get_executables_directory()
                            .unwrap_or_else(|_| PathBuf::from("user-data/bin"))
                            .display()
                    ));
                }
            }
            #[cfg(not(debug_assertions))]
            {
                return Err(format!(
                    "Whisper executable not found. Please download it and place it in: {}",
                    model_manager::get_executables_directory()
                        .unwrap_or_else(|_| PathBuf::from("user-data/bin"))
                        .display()
                ));
            }
        }
    };

    // Try to get model from user data directory
    let model = match model_manager::resolve_model_path(default_model) {
        Ok(path) if path.exists() => path,
        _ => {
            // Fallback to development paths in debug mode
            #[cfg(debug_assertions)]
            {
                if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
                    let dev_path = PathBuf::from(manifest_dir)
                        .join("models")
                        .join(default_model);
                    if dev_path.exists() {
                        dev_path
                    } else {
                        return Err(format!(
                            "Model '{}' not found. Please download it through the Settings page or place it in: {}",
                            default_model,
                            model_manager::get_models_directory()
                                .unwrap_or_else(|_| PathBuf::from("user-data/models"))
                                .display()
                        ));
                    }
                } else {
                    return Err(format!(
                        "Model '{}' not found. Please download it through the Settings page or place it in: {}",
                        default_model,
                        model_manager::get_models_directory()
                            .unwrap_or_else(|_| PathBuf::from("user-data/models"))
                            .display()
                    ));
                }
            }
            #[cfg(not(debug_assertions))]
            {
                return Err(format!(
                    "Model '{}' not found. Please download it through the Settings page or place it in: {}",
                    default_model,
                    model_manager::get_models_directory()
                        .unwrap_or_else(|_| PathBuf::from("user-data/models"))
                        .display()
                ));
            }
        }
    };

    Ok((whisper_bin, model))
}

/// Preloads the Whisper model by verifying paths exist
/// This helps reduce the first transcription latency by ensuring
/// the model and binary are accessible before first use.
///
/// # Returns
/// * `Ok(())` - Paths verified successfully
/// * `Err(String)` - Error message if paths cannot be resolved
pub fn preload_model() -> Result<(), String> {
    println!("🔍 Preloading Whisper model...");
    let (whisper_bin, model_path) = resolve_whisper_paths()?;

    // Verify both files exist and are accessible
    if !whisper_bin.exists() {
        return Err(format!("Whisper binary not found: {:?}", whisper_bin));
    }

    if !model_path.exists() {
        return Err(format!("Whisper model not found: {:?}", model_path));
    }

    // Get file sizes for logging
    let bin_size = std::fs::metadata(&whisper_bin)
        .map(|m| m.len())
        .unwrap_or(0);
    let model_size = std::fs::metadata(&model_path).map(|m| m.len()).unwrap_or(0);

    println!(
        "✅ Model preloaded - Binary: {:?} ({} bytes), Model: {:?} ({} bytes)",
        whisper_bin, bin_size, model_path, model_size
    );

    Ok(())
}

/// Transcribes audio data using whisper.cpp
///
/// This function:
/// 1. Writes audio data to a temporary file
/// 2. Resolves paths to bundled whisper binary and model
/// 3. Executes whisper.cpp with the temporary audio file
/// 4. Parses and returns the transcribed text
/// 5. Cleans up the temporary file
///
/// # Arguments
/// * `audio_data` - WAV audio data as bytes (must be 16 kHz, mono, 16-bit PCM for best results)
/// * `language` - Language code to use for transcription (e.g., "en", "es", "fr", "de")
/// * `vocabulary` - Optional vocabulary array to use as initial prompt for better transcription accuracy
///
/// # Returns
/// * `Ok(String)` - The transcribed text
/// * `Err(String)` - Error message if transcription fails
pub fn transcribe_audio_data(
    audio_data: Vec<u8>,
    language: String,
    vocabulary: Option<Vec<String>>,
) -> Result<String, String> {
    println!(
        "🎤 Starting local transcription (audio size: {} bytes)",
        audio_data.len()
    );

    // Create a temporary file for the audio data
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!("lexi_audio_{}.wav", Uuid::new_v4()));
    let temp_path = temp_file
        .to_str()
        .ok_or_else(|| "Failed to create temp file path".to_string())?;

    // Write audio data to temporary file
    std::fs::write(&temp_file, audio_data)
        .map_err(|e| format!("Failed to write audio to temp file: {}", e))?;

    println!("📝 Wrote audio to temp file: {:?}", temp_file);

    // Ensure cleanup happens even if transcription fails
    let result = transcribe_audio_file(temp_path.to_string(), language, vocabulary);

    // Clean up temporary file
    if let Err(e) = std::fs::remove_file(&temp_file) {
        eprintln!(
            "⚠️  Warning: Failed to remove temp file {:?}: {}",
            temp_file, e
        );
    } else {
        println!("🧹 Cleaned up temp file: {:?}", temp_file);
    }

    result
}

/// Transcribes an audio file using whisper.cpp
///
/// This function:
/// 1. Resolves paths to bundled whisper binary and model
/// 2. Executes whisper.cpp with the audio file
/// 3. Parses and returns the transcribed text
///
/// # Arguments
/// * `audio_path` - Absolute path to the audio file (must be WAV format: 16 kHz, mono, 16-bit PCM)
/// * `language` - Language code to use for transcription (e.g., "en", "es", "fr", "de")
/// * `vocabulary` - Optional vocabulary array to use as initial prompt for better transcription accuracy
///
/// # Returns
/// * `Ok(String)` - The transcribed text
/// * `Err(String)` - Error message if transcription fails
pub fn transcribe_audio_file(
    audio_path: String,
    language: String,
    vocabulary: Option<Vec<String>>,
) -> Result<String, String> {
    println!("🎤 Starting local transcription for: {}", audio_path);

    // Resolve bundled paths
    let (whisper_bin, model_path) = resolve_whisper_paths()?;

    println!(
        "📦 Using whisper binary: {:?}, model: {:?}",
        whisper_bin, model_path
    );

    // Verify audio file exists
    if !std::path::Path::new(&audio_path).exists() {
        return Err(format!("Audio file not found: {}", audio_path));
    }

    // Build command arguments
    let mut args = vec![
        "-m".to_string(), // Model file path - specifies which Whisper model to use for transcription
        model_path
            .to_str()
            .ok_or_else(|| "Model path contains invalid UTF-8".to_string())?
            .to_string(),
        "-f".to_string(), // Audio file path - the input audio file to transcribe
        audio_path,
        "--no-timestamps".to_string(), // Don't include timestamps in the output (plain text only)
        "--language".to_string(), // Language code - specifies the language of the audio (e.g., "en", "es", "fr")
        language,
        "--threads".to_string(), // Number of CPU threads to use for processing (4 threads for parallel computation)
        "4".to_string(),
        "--beam-size".to_string(), // Beam search size - number of candidates to keep at each step (1 = greedy search, faster)
        "1".to_string(),
        "--best-of".to_string(), // Number of candidates to sample from (1 = deterministic, faster but potentially less accurate)
        "1".to_string(),
        "--temperature".to_string(), // Sampling temperature (0 = deterministic, no randomness)
        "0".to_string(),
    ];

    // Add prompt if vocabulary is provided
    if let Some(vocab) = vocabulary {
        if !vocab.is_empty() {
            let prompt = vocab.join(", ");
            println!("📝 Using prompt for vocabulary: {}", prompt);
            args.push("--prompt".to_string());
            args.push(prompt);
        }
    }

    // Execute whisper.cpp
    let output = Command::new(&whisper_bin)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute whisper binary: {}", e))?;

    // Check if command succeeded
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Whisper transcription failed: {}",
            if stderr.is_empty() {
                format!("Exit code: {}", output.status.code().unwrap_or(-1))
            } else {
                stderr.to_string()
            }
        ));
    }

    // Parse output
    let raw = String::from_utf8_lossy(&output.stdout);

    // Strip metadata lines (lines starting with '[')
    let text = raw
        .lines()
        .filter(|l| !l.trim().starts_with('[') && !l.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();

    if text.is_empty() {
        return Err("Transcription produced empty result".to_string());
    }

    println!("✅ Transcription successful: {} characters", text.len());
    Ok(text)
}
