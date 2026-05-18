//! Microphone capture via `cpal`; WAV encoding differs by platform on stop.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, Stream, StreamConfig};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// **macOS:** Prefers built-in mic when found, else system default.
/// **Windows / Linux:** System default input device.
pub fn try_prioritized_input_device() -> Option<Device> {
    let host = cpal::default_host();

    #[cfg(target_os = "macos")]
    {
        let builtin_device = host.input_devices().ok().and_then(|mut devices| {
            devices.find(|d| {
                let name = d.name().unwrap_or_default();
                name.contains("MacBook") || name.contains("Built-in")
            })
        });
        builtin_device.or_else(|| host.default_input_device())
    }

    #[cfg(not(target_os = "macos"))]
    {
        host.default_input_device()
    }
}

pub struct AudioRecorder {
    device: Device,
    config: StreamConfig,
    stream: Option<Stream>,
    audio_data: Arc<Mutex<Vec<f32>>>,
    volume_tx: Option<Sender<f32>>,
    stream_tx: Option<Sender<Vec<u8>>>,
    recording_active: Arc<AtomicBool>,
}

impl AudioRecorder {
    pub fn new() -> Self {
        let device = try_prioritized_input_device()
            .expect("Failed to get default input device");

        println!(
            "🎙️ Audio input device: {}",
            device.name().unwrap_or_else(|_| "Unknown".to_string())
        );

        let config = device
            .default_input_config()
            .expect("Failed to get default input config")
            .into();

        Self {
            device,
            config,
            stream: None,
            audio_data: Arc::new(Mutex::new(Vec::new())),
            volume_tx: None,
            stream_tx: None,
            recording_active: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn release_stream(&mut self) {
        self.recording_active.store(false, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(30));
        if let Some(stream) = self.stream.take() {
            let _ = stream.pause();
            std::thread::sleep(Duration::from_millis(30));
            drop(stream);
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    pub fn set_volume_sender(&mut self, tx: Sender<f32>) {
        self.volume_tx = Some(tx);
    }

    pub fn start_recording(
        &mut self,
        stream_sender: Option<Sender<Vec<u8>>>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.stream_tx = stream_sender;

        let audio_data = Arc::clone(&self.audio_data);
        let recording_active = Arc::clone(&self.recording_active);

        audio_data.lock().unwrap().clear();
        recording_active.store(true, Ordering::SeqCst);

        let config = self.config.clone();
        let volume_tx = self.volume_tx.clone();
        let stream_tx = self.stream_tx.clone();

        let sample_rate = config.sample_rate.0 as usize;
        let samples_per_update = sample_rate / 20;
        let sample_counter = Arc::new(Mutex::new(0usize));

        let stream = self.device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if !recording_active.load(Ordering::Relaxed) {
                    return;
                }
                {
                    let mut audio_buffer = audio_data.lock().unwrap();
                    audio_buffer.extend_from_slice(data);
                }

                if let Some(ref tx) = stream_tx {
                    let amplitude = i16::MAX as f32;
                    let mut bytes = Vec::with_capacity(data.len() * 2);
                    for sample in data {
                        let val = (sample * amplitude) as i16;
                        bytes.extend_from_slice(&val.to_le_bytes());
                    }
                    let _ = tx.send(bytes);
                }

                if let Some(ref tx) = volume_tx {
                    let mut counter = sample_counter.lock().unwrap();
                    *counter += data.len();

                    if *counter >= samples_per_update {
                        *counter = 0;
                        let sum_squares: f32 = data.iter().map(|s| s * s).sum();
                        let rms = (sum_squares / data.len() as f32).sqrt();
                        let normalized = (rms * 5.0).min(1.0);
                        let _ = tx.send(normalized);
                    }
                }
            },
            move |err| {
                eprintln!("Error in audio stream: {}", err);
            },
            None,
        )?;

        stream.play()?;
        self.stream = Some(stream);
        Ok(())
    }

    pub fn stop_recording(&mut self) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
        self.recording_active.store(false, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(30));
        if let Some(stream) = self.stream.take() {
            let _ = stream.pause();
            std::thread::sleep(Duration::from_millis(30));
            drop(stream);
            std::thread::sleep(Duration::from_millis(20));
        }

        let mut audio_buffer = self.audio_data.lock().unwrap();
        let audio_data = std::mem::take(&mut *audio_buffer);
        drop(audio_buffer);

        let channels = self.config.channels;
        let sample_rate = self.config.sample_rate.0;

        #[cfg(target_os = "windows")]
        {
            return windows::encode_capture(&audio_data, channels, sample_rate);
        }

        #[cfg(target_os = "macos")]
        {
            return macos::encode_capture(&audio_data, channels, sample_rate);
        }

        #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
        {
            encode_native_wav(&audio_data, channels, sample_rate)
        }
    }
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn encode_native_wav(
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    use std::io::Cursor;
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)?;
        let amplitude = i16::MAX as f32;
        for &sample in samples {
            writer.write_sample((sample * amplitude) as i16)?;
        }
        writer.finalize()?;
    }
    Ok(cursor.into_inner())
}
