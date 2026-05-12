//! macOS meeting system audio: Core Audio process tap + aggregate device + cpal input.

use std::sync::mpsc;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::Duration;

use cidre::{cf, core_audio as ca, ns};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

const SYSTEM_AUDIO_TAP_NAME: &str = "lexi-audio-tap";

/// Holds tap + aggregate + cpal stream so Core Audio objects outlive the stream (see README_MACOS §8.3).
struct MacosSystemAudioStream {
    _tap: ca::TapGuard,
    _agg_device: ca::AggregateDevice,
    stream: cpal::Stream,
    shutting_down: Arc<AtomicBool>,
}

impl MacosSystemAudioStream {
    fn start(sender: mpsc::Sender<Vec<u8>>) -> Result<Self, String> {
        let shutting_down = Arc::new(AtomicBool::new(false));
        let shutting_down_cb = Arc::clone(&shutting_down);

        let output_device = ca::System::default_output_device()
            .map_err(|e| format!("default_output_device: {:?}", e))?;
        let output_uid = output_device
            .uid()
            .map_err(|e| format!("device uid: {:?}", e))?;

        let tap_desc = ca::TapDesc::with_mono_global_tap_excluding_processes(&ns::Array::new());
        let tap = tap_desc
            .create_process_tap()
            .map_err(|e| format!("create_process_tap: {:?}", e))?;

        let sub_tap = cf::DictionaryOf::with_keys_values(
            &[ca::sub_device_keys::uid()],
            &[tap.uid().unwrap().as_type_ref()],
        );

        let agg_desc = cf::DictionaryOf::with_keys_values(
            &[
                ca::aggregate_device_keys::is_private(),
                ca::aggregate_device_keys::is_stacked(),
                ca::aggregate_device_keys::tap_auto_start(),
                ca::aggregate_device_keys::name(),
                ca::aggregate_device_keys::main_sub_device(),
                ca::aggregate_device_keys::uid(),
                ca::aggregate_device_keys::tap_list(),
            ],
            &[
                cf::Boolean::value_true().as_type_ref(),
                cf::Boolean::value_false(),
                cf::Boolean::value_true().as_type_ref(),
                cf::str!(c"lexi-audio-tap").as_type_ref(),
                &output_uid,
                &cf::Uuid::new().to_cf_string(),
                &cf::ArrayOf::from_slice(&[sub_tap.as_ref()]),
            ],
        );

        let agg_device = ca::AggregateDevice::with_desc(&agg_desc)
            .map_err(|e| format!("AggregateDevice::with_desc: {:?}", e))?;

        let host = cpal::default_host();
        let mut device_opt = None;
        let mut attempts = 0;
        let max_attempts = 20;

        while attempts < max_attempts {
            thread::sleep(Duration::from_millis(150));
            if let Ok(mut devices) = host.input_devices() {
                if let Some(dev) = devices.find(|d| {
                    d.name()
                        .map(|n| n == SYSTEM_AUDIO_TAP_NAME)
                        .unwrap_or(false)
                }) {
                    device_opt = Some(dev);
                    break;
                }
            }
            attempts += 1;
        }

        let device = device_opt.ok_or_else(|| {
            format!(
                "input device '{}' not found after {} retries",
                SYSTEM_AUDIO_TAP_NAME, max_attempts
            )
        })?;

        let config = device
            .default_input_config()
            .map_err(|e| e.to_string())?
            .into();

        let amplitude = i16::MAX as f32;
        let stream = device
            .build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let mut bytes = Vec::with_capacity(data.len() * 2);
                    for &sample in data {
                        let val =
                            (sample * amplitude).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
                        bytes.extend_from_slice(&val.to_le_bytes());
                    }
                    let _ = sender.send(bytes);
                },
                move |err| {
                    if !shutting_down_cb.load(Ordering::Relaxed) {
                        eprintln!("System audio stream error: {}", err);
                    }
                },
                None,
            )
            .map_err(|e| e.to_string())?;

        stream.play().map_err(|e| e.to_string())?;

        Ok(Self {
            _tap: tap,
            _agg_device: agg_device,
            stream,
            shutting_down,
        })
    }

    fn stop(self) {
        self.shutting_down.store(true, Ordering::Relaxed);
        let _ = self.stream.pause();
        thread::sleep(Duration::from_millis(30));
        drop(self.stream);
        thread::sleep(Duration::from_millis(20));
    }
}

/// Run the **full** meeting system-audio pipeline (tap → aggregate → cpal input) briefly.
/// macOS often attaches the **system audio** consent UI to **starting the input stream**, not to
/// `create_process_tap()` alone, so a tap-only probe may never show a sheet.
pub fn spawn_process_tap_permission_attempt() {
    thread::spawn(|| {
        let (drain_tx, drain_rx) = mpsc::channel::<Vec<u8>>();
        let _drainer = thread::spawn(move || while drain_rx.recv().is_ok() {});

        match MacosSystemAudioStream::start(drain_tx) {
            Ok(session) => {
                thread::sleep(Duration::from_millis(800));
                session.stop();
            }
            Err(e) => eprintln!("System audio permission attempt failed: {}", e),
        }
    });
}

pub(super) fn run_system_audio_capture(sender: mpsc::Sender<Vec<u8>>, stop_rx: mpsc::Receiver<()>) {
    let session = match MacosSystemAudioStream::start(sender) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("System audio: {}", e);
            return;
        }
    };
    let _ = stop_rx.recv();
    session.stop();
}
