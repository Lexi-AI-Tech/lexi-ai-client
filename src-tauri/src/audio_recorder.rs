use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, Stream, StreamConfig, Host};
use std::sync::{Arc, Mutex};

pub struct AudioRecorder {
    host: Host,
    mic_device: Device,
    mic_config: StreamConfig,
    system_device: Option<Device>,
    system_config: Option<StreamConfig>,
    mic_stream: Option<Stream>,
    system_stream: Option<Stream>,
    audio_data: Arc<Mutex<Vec<f32>>>,
}

impl AudioRecorder {
    pub fn new() -> Self {
        let host = cpal::default_host();
        let mic_device = host
            .default_input_device()
            .expect("Failed to get default input device");
        
        let mic_config = mic_device
            .default_input_config()
            .expect("Failed to get default input config")
            .into();

        // Try to find BlackHole device for system audio
        let system_device = host.input_devices()
            .ok()
            .and_then(|mut devices| {
                devices.find(|d| {
                    d.name()
                        .map(|name| name.contains("BlackHole"))
                        .unwrap_or(false)
                })
            });

        let system_config = system_device.as_ref().and_then(|device| {
            device.default_input_config().ok().map(|c| c.into())
        });

        Self {
            host,
            mic_device,
            mic_config,
            system_device,
            system_config,
            mic_stream: None,
            system_stream: None,
            audio_data: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn list_input_devices() -> Vec<String> {
        let host = cpal::default_host();
        host.input_devices()
            .ok()
            .map(|devices| {
                devices
                    .filter_map(|d| d.name().ok())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn has_system_audio(&self) -> bool {
        self.system_device.is_some()
    }

    pub fn start_recording(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let audio_data = Arc::clone(&self.audio_data);
        audio_data.lock().unwrap().clear();

        let mic_config = self.mic_config.clone();
        let mic_audio_data = audio_data.clone();

        // Start microphone stream
        let mic_stream = self.mic_device.build_input_stream(
            &mic_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let mut audio_buffer = mic_audio_data.lock().unwrap();
                audio_buffer.extend_from_slice(data);
            },
            move |err| {
                eprintln!("Error in mic audio stream: {}", err);
            },
            None,
        )?;

        mic_stream.play()?;
        self.mic_stream = Some(mic_stream);

        // Start system audio stream if available
        if let (Some(system_device), Some(system_config)) = (&self.system_device, &self.system_config) {
            let system_config = system_config.clone();
            let system_audio_data = audio_data.clone();

            let system_stream = system_device.build_input_stream(
                &system_config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let mut audio_buffer = system_audio_data.lock().unwrap();
                    audio_buffer.extend_from_slice(data);
                },
                move |err| {
                    eprintln!("Error in system audio stream: {}", err);
                },
                None,
            )?;

            system_stream.play()?;
            self.system_stream = Some(system_stream);
            
            println!("✅ Recording with both microphone and system audio (BlackHole)");
        } else {
            println!("⚠️  Recording with microphone only (BlackHole not found)");
        }

        Ok(())
    }

    pub fn stop_recording(&mut self) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
        if let Some(stream) = self.mic_stream.take() {
            drop(stream);
        }

        if let Some(stream) = self.system_stream.take() {
            drop(stream);
        }

        let audio_buffer = self.audio_data.lock().unwrap();
        let audio_data = audio_buffer.clone();
        drop(audio_buffer);

        // Create a WAV writer
        let spec = hound::WavSpec {
            channels: self.mic_config.channels,
            sample_rate: self.mic_config.sample_rate.0,
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
