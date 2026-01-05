//! Text-to-Speech Service Module
//!
//! This module handles text-to-speech conversion by calling the Lexi AI Server TTS endpoint.
//! It converts text to speech and plays the audio output.

use crate::commands::auth::get_auth_token;
use crate::config;
use reqwest::multipart;
use std::error::Error;
use std::fs;
use std::process::Command;
use tauri::AppHandle;
use tempfile::TempDir;

/// Text-to-Speech service using Lexi AI Server
pub struct TtsService {
    app_handle: AppHandle,
}

impl TtsService {
    /// Creates a new TTS service instance
    ///
    /// # Arguments
    /// * `app_handle` - Tauri AppHandle for accessing auth token and config
    ///
    /// # Returns
    /// * `TtsService` - A new TTS service instance
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    /// Converts text to speech and plays it
    ///
    /// # Arguments
    /// * `text` - The text to convert to speech
    /// * `voice_id` - Optional voice ID (not used currently, server uses default)
    ///
    /// # Returns
    /// * `Ok(())` - If the text was successfully converted and played
    /// * `Err(Box<dyn Error>)` - If there was an error during conversion or playback
    pub async fn speak(&self, text: &str, _voice_id: Option<String>) -> Result<(), Box<dyn Error>> {
        if text.trim().is_empty() {
            return Ok(());
        }

        println!("🔊 Converting text to speech: '{}'", text);

        // Get authentication token
        let auth_token = get_auth_token(&self.app_handle);
        if auth_token.is_none() {
            return Err("Authentication required. Please log in.".into());
        }

        // Get API base URL
        let api_base_url = config::api_base_url();

        // Create HTTP client
        let client = reqwest::Client::new();

        // Build multipart form
        let form = multipart::Form::new().text("text", text.to_string());

        // Build the request
        let url = format!("{}/api/tts/speak", api_base_url);
        let mut request = client.post(&url).multipart(form);

        // Add authorization header
        if let Some(token) = &auth_token {
            request = request.header("Authorization", format!("Bearer {}", token));
        }

        // Make API request
        let response = request.send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!("TTS API error ({}): {}", status, error_text).into());
        }

        // Get audio bytes
        let audio_bytes = response.bytes().await?;

        // Save to temporary file and play
        let temp_dir = TempDir::new()?;
        let audio_path = temp_dir.path().join("tts_output.mp3");
        fs::write(&audio_path, &audio_bytes)?;

        // Play audio using macOS `afplay` command
        #[cfg(target_os = "macos")]
        {
            let output = Command::new("afplay").arg(&audio_path).output()?;

            if !output.status.success() {
                let error = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Failed to play audio: {}", error).into());
            }
        }

        // For other platforms, you might want to use different audio players
        #[cfg(not(target_os = "macos"))]
        {
            // Try to use system default audio player
            #[cfg(target_os = "linux")]
            {
                Command::new("mpg123").arg(&audio_path).output()?;
            }
            #[cfg(target_os = "windows")]
            {
                Command::new("powershell")
                    .args(&[
                        "-Command",
                        &format!(
                            "(New-Object Media.SoundPlayer '{}').PlaySync()",
                            audio_path.display()
                        ),
                    ])
                    .output()?;
            }
        }

        println!("✅ Text-to-speech completed successfully");
        Ok(())
    }
}
