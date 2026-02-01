//! Audio Recorder Module
//!
//! This module handles capturing audio from the system's default microphone using the
//! `cpal` (Cross-Platform Audio Library) crate. It provides a simple interface for
//! starting and stopping audio recording, with automatic conversion to WAV format.
//!
//! ## Features
//!
//! - **Real-time Audio Capture**: Records audio as 32-bit floating point samples in real-time
//! - **Shared Buffer**: Stores captured samples in a thread-safe shared buffer (Arc<Mutex>)
//! - **WAV Conversion**: Automatically converts captured audio to 16-bit PCM WAV format
//!   for compatibility with speech-to-text APIs
//! - **Default Device**: Automatically uses the system's default input device (microphone)
//!
//! ## Audio Format
//!
//! - **Input**: 32-bit floating point samples from cpal (typically 44.1kHz or 48kHz sample rate)
//! - **Output**: 16-bit PCM WAV format (standard for speech-to-text APIs)
//! - **Channels**: Supports mono and stereo (preserves original channel configuration)
//!
//! ## Permissions Required
//!
//! - **Microphone** (macOS): Required for audio input access

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, Stream, StreamConfig};
use std::io::Cursor;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

/// AudioRecorder manages audio capture from the default input device
///
/// The recorder captures audio samples in real-time and stores them in a shared buffer.
/// When recording stops, the samples are converted to WAV format (16-bit PCM) for
/// compatibility with speech-to-text APIs.
pub struct AudioRecorder {
    device: Device,                     // The audio input device (microphone)
    config: StreamConfig,               // Audio configuration (sample rate, channels, etc.)
    stream: Option<Stream>,             // Active audio stream (None when not recording)
    audio_data: Arc<Mutex<Vec<f32>>>,   // Shared buffer storing captured audio samples
    volume_tx: Option<Sender<f32>>,     // Optional channel for real-time volume updates
    stream_tx: Option<Sender<Vec<u8>>>, // Optional channel for streaming audio data
}

impl AudioRecorder {
    /// Creates a new AudioRecorder instance
    ///
    /// Initializes the recorder with the system's default audio input device
    /// and its default configuration (sample rate, channels, format).
    /// This will typically use the system's default microphone.
    pub fn new() -> Self {
        // Get the default audio host for the current platform
        let host = cpal::default_host();

        // Get the default input device (microphone)
        // Panics if no input device is available (shouldn't happen on most systems)
        let device = host
            .default_input_device()
            .expect("Failed to get default input device");

        // Get the default configuration for the device
        // This includes sample rate, number of channels, and sample format
        let config = device
            .default_input_config()
            .expect("Failed to get default input config")
            .into();

        Self {
            device,
            config,
            stream: None,                                 // No active stream initially
            audio_data: Arc::new(Mutex::new(Vec::new())), // Empty audio buffer
            volume_tx: None,                              // No volume callback by default
            stream_tx: None,                              // No streaming by default
        }
    }

    /// Set a channel sender for real-time volume updates
    /// Volume values are 0.0-1.0 (RMS normalized)
    pub fn set_volume_sender(&mut self, tx: Sender<f32>) {
        self.volume_tx = Some(tx);
    }

    /// Starts recording audio from the input device
    ///
    /// Accepts an optional sender for streaming audio data.
    pub fn start_recording(
        &mut self,
        stream_sender: Option<Sender<Vec<u8>>>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.stream_tx = stream_sender;

        // Clone the Arc to share the audio buffer with the stream callback
        let audio_data = Arc::clone(&self.audio_data);

        // Clear any previous recording data
        audio_data.lock().unwrap().clear();

        // Clone the config for use in the stream callback
        let config = self.config.clone();
        let _channels = config.channels;

        // Clone senders for the callback
        let volume_tx = self.volume_tx.clone();
        let stream_tx = self.stream_tx.clone();

        // For throttling volume updates (every ~50ms worth of samples)
        let sample_rate = config.sample_rate.0 as usize;
        let samples_per_update = sample_rate / 20; // ~50ms
        let sample_counter = Arc::new(Mutex::new(0usize));

        // Build the input stream with callbacks
        let stream = self.device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // 1. Buffer for legacy stop_recording
                {
                    let mut audio_buffer = audio_data.lock().unwrap();
                    audio_buffer.extend_from_slice(data);
                }

                // 2. Stream if enabled
                if let Some(ref tx) = stream_tx {
                    // Convert f32 samples to i16 bytes (PCM)
                    let amplitude = i16::MAX as f32;
                    let mut bytes = Vec::with_capacity(data.len() * 2);
                    for sample in data {
                        let val = (sample * amplitude) as i16;
                        bytes.extend_from_slice(&val.to_le_bytes());
                    }
                    // Send chunk (ignore errors if receiver dropped)
                    let _ = tx.send(bytes);
                }

                // 3. Volume updates
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

    /// Stops recording and converts the captured audio to WAV format
    ///
    /// This function:
    /// 1. Stops the audio stream (drops it, which automatically stops recording)
    /// 2. Retrieves all captured audio samples from the buffer
    /// 3. Converts the 32-bit float samples to 16-bit integer PCM format
    /// 4. Writes the data as a WAV file in memory
    ///
    /// Returns the WAV file data as a byte vector, ready to be sent to the API.
    /// Returns an error if the conversion fails.
    pub fn stop_recording(&mut self) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
        // Stop the stream by dropping it
        // This automatically stops the audio capture
        if let Some(stream) = self.stream.take() {
            drop(stream);
        }

        // Extract the captured audio data from the shared buffer
        let audio_buffer = self.audio_data.lock().unwrap();
        let audio_data = audio_buffer.clone();
        drop(audio_buffer); // Release the lock as soon as possible

        // Define WAV file specification
        // We convert to 16-bit PCM format, which is widely supported by APIs
        let spec = hound::WavSpec {
            channels: self.config.channels, // Number of audio channels (1 = mono, 2 = stereo)
            sample_rate: self.config.sample_rate.0, // Sample rate in Hz (e.g., 44100, 48000)
            bits_per_sample: 16,            // 16-bit samples (standard for WAV)
            sample_format: hound::SampleFormat::Int, // Integer format (not float)
        };

        // Create an in-memory buffer to write the WAV file
        let mut cursor = Cursor::new(Vec::new());
        {
            // Create a WAV writer that writes to our in-memory buffer
            let mut writer = hound::WavWriter::new(&mut cursor, spec)?;

            // Convert each 32-bit float sample to 16-bit integer
            for sample in audio_data {
                // Normalize the float sample (-1.0 to 1.0) to 16-bit integer range
                // i16::MAX is 32767, which represents the maximum amplitude
                let amplitude = i16::MAX as f32;
                // Clamp and convert: sample * amplitude converts to integer range
                writer.write_sample((sample * amplitude) as i16)?;
            }

            // Finalize the WAV file (writes headers, etc.)
            writer.finalize()?;
        }

        // Return the WAV file data as bytes
        Ok(cursor.into_inner())
    }
}
