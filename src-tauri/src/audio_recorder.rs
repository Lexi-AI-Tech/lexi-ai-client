use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, Stream, StreamConfig};
use std::sync::{Arc, Mutex};
use std::io::Cursor;

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

    pub fn start_recording(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let audio_data = Arc::clone(&self.audio_data);
        // Clear previous data
        audio_data.lock().unwrap().clear();

        let config = self.config.clone();
        let _channels = config.channels;

        let stream = self.device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let mut audio_buffer = audio_data.lock().unwrap();
                // If stereo, we might want to mix down or just keep it. 
                // For simplicity, we just append all samples.
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

    pub fn stop_recording(&mut self) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
        if let Some(stream) = self.stream.take() {
            drop(stream);
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

        let mut cursor = Cursor::new(Vec::new());
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
