//! Audio playback for voice actions.
//!
//! Plays base64 audio from the action response (TTS is done on the server).

use base64::{engine::general_purpose::STANDARD, Engine};
use std::error::Error;
use std::fs;
use std::process::Command;
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
}
