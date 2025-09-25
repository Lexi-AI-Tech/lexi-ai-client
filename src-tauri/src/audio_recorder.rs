use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, Stream, StreamConfig};
use std::sync::{Arc, Mutex};

pub struct AudioRecorder {
    device: Device,
    config: StreamConfig,
    stream: Option<Stream>,
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
            stream: None,
            audio_data: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn start_recording(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let audio_data = Arc::clone(&self.audio_data);
        let config = self.config.clone();

        let stream = self.device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let mut audio_buffer = audio_data.lock().unwrap();
                audio_buffer.extend_from_slice(data);
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

    pub async fn stop_recording(&mut self) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
        if let Some(stream) = self.stream.take() {
            drop(stream);
        }

        let audio_buffer = self.audio_data.lock().unwrap();
        let audio_data = audio_buffer.clone();
        drop(audio_buffer);

        // Convert f32 samples to 16-bit PCM
        let pcm_data: Vec<i16> = audio_data
            .iter()
            .map(|&sample| (sample * i16::MAX as f32) as i16)
            .collect();

        // Convert to bytes
        let mut bytes = Vec::new();
        for sample in pcm_data {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }

        // Clear the buffer for next recording
        let mut audio_buffer = self.audio_data.lock().unwrap();
        audio_buffer.clear();

        Ok(bytes)
    }
}
