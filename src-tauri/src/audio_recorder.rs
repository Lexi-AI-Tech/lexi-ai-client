use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, Stream, StreamConfig};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use crate::system_audio::SystemAudioRecorder;

pub struct AudioRecorder {
    device: Device,
    config: StreamConfig,
    mic_stream: Option<Stream>,
    system_recorder: Option<SystemAudioRecorder>,
    audio_data: Arc<Mutex<Vec<f32>>>,
}

impl AudioRecorder {
    pub fn new() -> Self {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .expect("Failed to get default input device");
        
        let config = device
            .default_input_config()
            .expect("Failed to get default input config")
            .into();

        Self {
            device,
            config,
            mic_stream: None,
            system_recorder: None,
            audio_data: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn start_recording(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let audio_data = Arc::clone(&self.audio_data);
        // Clear previous data
        audio_data.lock().unwrap().clear();

        let config = self.config.clone();
        
        // Channel for mixing
        let (tx, rx) = mpsc::channel::<Vec<f32>>();
        let tx_mic = tx.clone();
        let tx_sys = tx.clone();

        // Start Mic Stream
        let mic_stream = self.device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let _ = tx_mic.send(data.to_vec());
            },
            move |err| {
                eprintln!("Error in audio stream: {}", err);
            },
            None,
        )?;

        mic_stream.play()?;
        self.mic_stream = Some(mic_stream);

        // Start System Recorder
        let mut sys_recorder = SystemAudioRecorder::new(tx_sys);
        
        // We need to start it in a way that keeps it alive in the struct
        // But start() is async.
        // We can spawn a task that runs start(), but start() holds the stream.
        // If we await start(), it returns when capture starts.
        // We need to keep the `sys_recorder` instance which holds the `stream`.
        
        // To do this, we need to run the async start method but keep ownership of sys_recorder.
        // This is hard because start(&mut self) borrows self.
        
        // Let's modify SystemAudioRecorder to have a `start_capture` that consumes self and returns a RunningSystemRecorder?
        // Or just use a channel to send the started recorder back?
        
        let (recorder_tx, recorder_rx) = mpsc::channel();
        
        thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                if let Err(e) = sys_recorder.start().await {
                    eprintln!("Failed to start system audio: {}", e);
                }
                let _ = recorder_tx.send(sys_recorder);
            });
        });
        
        // Wait for the recorder to be returned (started)
        if let Ok(started_recorder) = recorder_rx.recv() {
            self.system_recorder = Some(started_recorder);
        } else {
            eprintln!("Failed to receive started system recorder");
        }
        
        // Mixer thread
        let mixer_audio_data = audio_data.clone();
        thread::spawn(move || {
            while let Ok(samples) = rx.recv() {
                let mut buffer = mixer_audio_data.lock().unwrap();
                buffer.extend_from_slice(&samples);
            }
        });

        Ok(())
    }

    pub fn stop_recording(&mut self) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
        if let Some(stream) = self.mic_stream.take() {
            drop(stream);
        }
        
        // Stop system recorder
        if let Some(mut recorder) = self.system_recorder.take() {
            recorder.stop();
        }

        let audio_buffer = self.audio_data.lock().unwrap();
        let audio_data = audio_buffer.clone();
        drop(audio_buffer);

        // Create a WAV writer
        let spec = hound::WavSpec {
            channels: self.config.channels,
            sample_rate: self.config.sample_rate.0,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut writer = hound::WavWriter::new(&mut cursor, spec)?;
            for sample in audio_data {
                let amplitude = i16::MAX as f32;
                writer.write_sample((sample * amplitude) as i16)?;
            }
            writer.finalize()?;
        }

        Ok(cursor.into_inner())
    }
}
