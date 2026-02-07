//! TTS playback for actions.
//!
//! Calls POST /api/v1/tts/speak (form body), waits for full audio, then plays.

use crate::api_endpoints::tts;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::error::Error;
use std::fs;
use std::process::Command;
use std::time::Instant;
use tauri::AppHandle;
use tempfile::TempDir;

pub struct TtsService {
    _app_handle: AppHandle,
}

impl TtsService {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            _app_handle: app_handle,
        }
    }

    /// Play audio from base64-encoded string (e.g. voice action response from server).
    pub fn play_audio_base64(&self, audio_base64: &str) -> Result<(), Box<dyn Error>> {
        let audio_bytes = STANDARD.decode(audio_base64.trim())?;
        self.play_audio_bytes(&audio_bytes)
    }

    /// Plays raw audio bytes (e.g. MP3). No network call.
    pub fn play_audio_bytes(&self, audio_bytes: &[u8]) -> Result<(), Box<dyn Error>> {
        if audio_bytes.is_empty() {
            return Ok(());
        }
        let temp_dir = TempDir::new()?;
        let audio_path = temp_dir.path().join("tts_output.mp3");
        fs::write(&audio_path, audio_bytes)?;

        #[cfg(target_os = "macos")]
        {
            let output = Command::new("afplay").arg(&audio_path).output()?;
            if !output.status.success() {
                let error = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Failed to play audio: {}", error).into());
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
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
        Ok(())
    }

    /// Fetches TTS from POST /tts/speak (form body). Kept for optional standalone use; voice actions use server-returned audio.
    #[allow(dead_code)]
    pub async fn play_tts_speak(
        &self,
        text: &str,
        auth_token: &str,
    ) -> Result<(), Box<dyn Error>> {
        if text.trim().is_empty() {
            return Ok(());
        }
        let t0 = Instant::now();
        let url = tts::speak_url();
        let client = reqwest::Client::new();
        let res = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", auth_token))
            .form(&[("text", text)])
            .send()
            .await?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(format!("TTS failed ({}): {}", status, body).into());
        }
        let bytes = res.bytes().await?;
        let time_to_response_ms = t0.elapsed().as_millis();
        let total_bytes = bytes.len();
        let slice: &[u8] = bytes.as_ref();

        let play_start = Instant::now();
        self.play_audio_bytes(slice)?;
        let playback_duration_ms = play_start.elapsed().as_millis();

        println!(
            "[TTS] time_to_response_ms={} total_bytes={} playback_duration_ms={} total_elapsed_ms={}",
            time_to_response_ms,
            total_bytes,
            playback_duration_ms,
            t0.elapsed().as_millis()
        );
        Ok(())
    }
}
