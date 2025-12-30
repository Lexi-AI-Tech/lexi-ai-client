//! Whisper.cpp Integration Module
//!
//! This module provides local speech-to-text transcription using whisper.cpp binary.
//! It handles path resolution for bundled resources and executes the whisper.cpp
//! binary to transcribe audio files.
//!
//! ## Architecture
//!
//! - Uses external whisper.cpp binary bundled with the app
//! - Requires pre-recorded audio file in WAV format (16 kHz, mono, 16-bit PCM)
//! - Returns plain text transcription
//!
//! ## Resources
//!
//! The following resources must be bundled in tauri.conf.json:
//! - `bin/whisper` - The whisper.cpp binary
//! - `models/ggml-small-q5_1.bin` - The quantized multilingual model file

use std::path::PathBuf;
use std::process::Command;
use tauri::AppHandle;

/// Resolves the paths to the bundled whisper binary and model file
///
/// Searches in multiple locations:
/// 1. Resource directory (production bundle)
/// 2. Executable directory (development)
/// 3. Current working directory (development)
///
/// # Arguments
/// * `_app` - Tauri AppHandle (unused, kept for API consistency)
///
/// # Returns
/// * `Ok((PathBuf, PathBuf))` - Tuple of (whisper_bin_path, model_path)
/// * `Err(String)` - Error message if paths cannot be resolved
fn resolve_whisper_paths(_app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let mut search_dirs = Vec::new();

    // Try to get resource directory (production)
    if let Ok(exe_path) = std::env::current_exe() {
        let mut dir_opt = exe_path.parent();
        while let Some(dir) = dir_opt {
            // In macOS bundle, resources are in Contents/Resources
            #[cfg(target_os = "macos")]
            {
                let resources_dir = dir.join("Resources");
                if resources_dir.exists() {
                    search_dirs.push(resources_dir);
                }
                // Also check MacOS directory (where externalBin might be)
                search_dirs.push(dir.to_path_buf());
            }
            #[cfg(not(target_os = "macos"))]
            {
                search_dirs.push(dir.to_path_buf());
            }
            dir_opt = dir.parent();
        }
    }

    // Add development paths
    if let Ok(cwd) = std::env::current_dir() {
        search_dirs.push(cwd.join("src-tauri"));
        search_dirs.push(cwd);
    }

    // Search for whisper binary
    let mut whisper_bin: Option<PathBuf> = None;
    for dir in &search_dirs {
        let candidate = dir.join("bin").join("whisper");
        #[cfg(target_os = "windows")]
        let candidate = candidate.with_extension("exe");
        if candidate.exists() {
            whisper_bin = Some(candidate);
            break;
        }
    }

    let whisper_bin = whisper_bin.ok_or_else(|| {
        format!(
            "whisper binary not found. Searched in: {:?}",
            search_dirs
        )
    })?;

    // Search for model
    let mut model: Option<PathBuf> = None;
    for dir in &search_dirs {
        let candidate = dir.join("models").join("ggml-small-q5_1.bin");
        if candidate.exists() {
            model = Some(candidate);
            break;
        }
    }

    let model = model.ok_or_else(|| {
        format!(
            "whisper model not found. Searched in: {:?}",
            search_dirs
        )
    })?;

    Ok((whisper_bin, model))
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
/// * `app` - Tauri AppHandle for resolving bundled resources
/// * `audio_data` - WAV audio data as bytes (must be 16 kHz, mono, 16-bit PCM for best results)
/// * `language` - Language code to use for transcription (e.g., "en", "es", "fr", "de")
///
/// # Returns
/// * `Ok(String)` - The transcribed text
/// * `Err(String)` - Error message if transcription fails
pub fn transcribe_audio_data(app: AppHandle, audio_data: Vec<u8>, language: String) -> Result<String, String> {
    println!("🎤 Starting local transcription (audio size: {} bytes)", audio_data.len());

    // Create a temporary file for the audio data
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!("lexi_audio_{}.wav", uuid::Uuid::new_v4()));
    let temp_path = temp_file.to_str().ok_or_else(|| "Failed to create temp file path".to_string())?;

    // Write audio data to temporary file
    std::fs::write(&temp_file, audio_data)
        .map_err(|e| format!("Failed to write audio to temp file: {}", e))?;

    println!("📝 Wrote audio to temp file: {:?}", temp_file);

    // Ensure cleanup happens even if transcription fails
    let result = transcribe_audio_file(app, temp_path.to_string(), language);

    // Clean up temporary file
    if let Err(e) = std::fs::remove_file(&temp_file) {
        eprintln!("⚠️  Warning: Failed to remove temp file {:?}: {}", temp_file, e);
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
/// * `app` - Tauri AppHandle for resolving bundled resources
/// * `audio_path` - Absolute path to the audio file (must be WAV format: 16 kHz, mono, 16-bit PCM)
/// * `language` - Language code to use for transcription (e.g., "en", "es", "fr", "de")
///
/// # Returns
/// * `Ok(String)` - The transcribed text
/// * `Err(String)` - Error message if transcription fails
pub fn transcribe_audio_file(app: AppHandle, audio_path: String, language: String) -> Result<String, String> {
    println!("🎤 Starting local transcription for: {}", audio_path);

    // Resolve bundled paths
    let (whisper_bin, model_path) = resolve_whisper_paths(&app)?;

    println!(
        "📦 Using whisper binary: {:?}, model: {:?}",
        whisper_bin, model_path
    );

    // Verify audio file exists
    if !std::path::Path::new(&audio_path).exists() {
        return Err(format!("Audio file not found: {}", audio_path));
    }

    // Execute whisper.cpp
    let output = Command::new(&whisper_bin)
        .args([
            "-m",
            model_path
                .to_str()
                .ok_or_else(|| "Model path contains invalid UTF-8".to_string())?,
            "-f",
            &audio_path,
            "--no-timestamps",
            "--language",
            &language,
            "--threads",
            "4",
            "--beam-size",
            "1",
            "--best-of",
            "1",
        ])
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

