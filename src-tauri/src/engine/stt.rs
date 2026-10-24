//! Local speech-to-text (whisper.cpp via `whisper-rs`, Metal). Apple Silicon only; other
//! targets get a stub that returns an error so the universal build still compiles.

use std::io::Cursor;

use tauri::AppHandle;

use crate::audio::pipeline::process_for_stt;

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub const SUPPORTED: bool = true;
#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
pub const SUPPORTED: bool = false;

/// Decodes a recorded WAV (any rate/channels, PCM16 or float) to mono 16 kHz f32 samples.
fn wav_to_whisper_samples(wav: &[u8]) -> Result<Vec<f32>, String> {
    let mut reader =
        hound::WavReader::new(Cursor::new(wav)).map_err(|e| format!("Invalid WAV: {}", e))?;
    let spec = reader.spec();
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Failed to read WAV: {}", e))?,
        hound::SampleFormat::Int => {
            let scale = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 / scale))
                .collect::<Result<_, _>>()
                .map_err(|e| format!("Failed to read WAV: {}", e))?
        }
    };

    let processed = process_for_stt(&samples, spec.channels, spec.sample_rate)?;
    let mut reader = hound::WavReader::new(Cursor::new(processed))
        .map_err(|e| format!("Invalid processed WAV: {}", e))?;
    reader
        .samples::<i16>()
        .map(|s| s.map(|v| v as f32 / i16::MAX as f32))
        .collect::<Result<_, _>>()
        .map_err(|e| format!("Failed to read processed WAV: {}", e))
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod engine {
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use lazy_static::lazy_static;
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    /// Unload the model after this long without a transcription.
    const IDLE_UNLOAD: Duration = Duration::from_secs(300);

    struct Loaded {
        path: PathBuf,
        ctx: WhisperContext,
        last_used: Instant,
    }

    lazy_static! {
        static ref ENGINE: Mutex<Option<Loaded>> = Mutex::new(None);
    }

    fn ensure_loaded(slot: &mut Option<Loaded>, model: &Path) -> Result<(), String> {
        if slot.as_ref().is_some_and(|l| l.path == model) {
            return Ok(());
        }
        println!("📦 Loading whisper model: {}", model.display());
        let ctx = WhisperContext::new_with_params(
            model.to_str().ok_or("Invalid model path")?,
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("Failed to load whisper model: {}", e))?;
        *slot = Some(Loaded {
            path: model.to_path_buf(),
            ctx,
            last_used: Instant::now(),
        });
        Ok(())
    }

    pub fn preload(model: &Path) -> Result<(), String> {
        let mut slot = ENGINE.lock().map_err(|_| "STT engine lock poisoned")?;
        ensure_loaded(&mut slot, model)
    }

    pub fn unload_if_idle() {
        if let Ok(mut slot) = ENGINE.lock() {
            if slot
                .as_ref()
                .is_some_and(|l| l.last_used.elapsed() >= IDLE_UNLOAD)
            {
                println!("📦 Unloading idle whisper model");
                *slot = None;
            }
        }
    }

    pub fn idle_unload_delay() -> Duration {
        IDLE_UNLOAD + Duration::from_secs(1)
    }

    pub fn transcribe(
        model: &Path,
        samples: &[f32],
        language: &str,
        vocabulary: &[String],
    ) -> Result<String, String> {
        let mut slot = ENGINE.lock().map_err(|_| "STT engine lock poisoned")?;
        ensure_loaded(&mut slot, model)?;
        let loaded = slot.as_mut().ok_or("Model not loaded")?;

        let mut state = loaded
            .ctx
            .create_state()
            .map_err(|e| format!("Failed to create whisper state: {}", e))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(if language == "auto" {
            None
        } else {
            Some(language)
        });
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        params.set_no_context(true);
        let prompt = vocabulary.join(", ");
        if !prompt.is_empty() {
            params.set_initial_prompt(&prompt);
        }

        state
            .full(params, samples)
            .map_err(|e| format!("Transcription failed: {}", e))?;

        let mut text = String::new();
        for segment in state.as_iter() {
            let part = segment
                .to_str_lossy()
                .map_err(|e| format!("Failed to read segment: {}", e))?;
            text.push_str(&part);
        }
        loaded.last_used = Instant::now();
        Ok(text.trim().to_string())
    }
}

/// Loads the model in the background so the first dictation doesn't pay the load cost.
pub fn preload(app: &AppHandle) {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    if let Some(model) = crate::offline::find_stt_model(app) {
        tauri::async_runtime::spawn_blocking(move || {
            if let Err(e) = engine::preload(&model) {
                eprintln!("⚠️  STT preload failed: {}", e);
            }
        });
    }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    let _ = app;
}

/// Transcribes recorded WAV bytes locally. Runs inference on a blocking thread.
pub async fn transcribe(
    app: &AppHandle,
    wav: Vec<u8>,
    language: String,
    vocabulary: Vec<String>,
) -> Result<String, String> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        let model = crate::offline::find_stt_model(app).ok_or_else(|| {
            format!(
                "No offline speech model found. Put a ggml whisper model in {}",
                crate::offline::models_dir(app)
                    .map(|d| d.display().to_string())
                    .unwrap_or_default()
            )
        })?;
        let text = tauri::async_runtime::spawn_blocking(move || {
            let samples = wav_to_whisper_samples(&wav)?;
            engine::transcribe(&model, &samples, &language, &vocabulary)
        })
        .await
        .map_err(|e| format!("Transcription task failed: {}", e))??;

        tauri::async_runtime::spawn(async {
            tokio::time::sleep(engine::idle_unload_delay()).await;
            engine::unload_if_idle();
        });
        Ok(text)
    }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        let _ = (app, wav, language, vocabulary);
        Err("Offline mode requires an Apple Silicon Mac".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(samples: &[i16], rate: u32, channels: u16) -> Vec<u8> {
        let spec = hound::WavSpec {
            channels,
            sample_rate: rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = hound::WavWriter::new(&mut cursor, spec).unwrap();
            for s in samples {
                writer.write_sample(*s).unwrap();
            }
            writer.finalize().unwrap();
        }
        cursor.into_inner()
    }

    #[test]
    fn decodes_and_resamples_to_16khz_mono() {
        let tone: Vec<i16> = (0..48_000)
            .map(|i| ((i as f32 * 0.05).sin() * 8000.0) as i16)
            .collect();
        let out = wav_to_whisper_samples(&wav(&tone, 48_000, 1)).unwrap();
        // 1 s at 48 kHz -> ~16000 samples at 16 kHz
        assert!((out.len() as i64 - 16_000).abs() < 200, "len {}", out.len());
    }

    #[test]
    fn rejects_garbage() {
        assert!(wav_to_whisper_samples(b"nope").is_err());
    }

    /// Real-model smoke test. Run with:
    /// `LEXI_TEST_MODEL=/path/ggml-base.en.bin LEXI_TEST_WAV=/path/speech.wav cargo test -- --ignored`
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[test]
    #[ignore]
    fn transcribes_real_speech() {
        let model = std::env::var("LEXI_TEST_MODEL").expect("LEXI_TEST_MODEL");
        let wav = std::fs::read(std::env::var("LEXI_TEST_WAV").expect("LEXI_TEST_WAV")).unwrap();
        let samples = wav_to_whisper_samples(&wav).unwrap();
        let start = std::time::Instant::now();
        let text = engine::transcribe(std::path::Path::new(&model), &samples, "en", &[]).unwrap();
        println!(
            "transcript ({:.2}s): {}",
            start.elapsed().as_secs_f64(),
            text
        );
        assert!(text.to_lowercase().contains("hello world"), "got: {text}");
    }
}
