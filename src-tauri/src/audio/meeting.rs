//! Meeting audio: microphone + system audio (macOS), sent with source tag for transcription.
//!
//! All meeting recording logic lives here: mic capture, system audio capture on macOS
//! (Core Audio process tap + cpal stream). Audio is sent as (source, chunk) so the UI/backend
//! can attribute transcripts to "user" (mic) or "system" (system audio).

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Handles to stop meeting audio (recorder + system audio on macOS).
pub struct MeetingAudioHandles {
    pub recorder_stop_tx: mpsc::Sender<()>,
    /// Signal to stop system audio capture (Some on macOS).
    pub system_stop_tx: Option<mpsc::Sender<()>>,
}

/// Sends (source, chunk) to output; used for mic (source "user") and system (source "system").
fn send_tagged_chunks(
    rx: mpsc::Receiver<Vec<u8>>,
    source: &'static str,
    output_tx: Arc<Mutex<Option<tokio::sync::mpsc::Sender<(String, Vec<u8>)>>>>,
    rt_handle: tokio::runtime::Handle,
) {
    while let Ok(chunk) = rx.recv() {
        let guard = output_tx.lock().unwrap();
        if let Some(ref tx) = *guard {
            let tx_clone = tx.clone();
            drop(guard);
            if rt_handle
                .block_on(tx_clone.send((source.to_string(), chunk)))
                .is_err()
            {
                break;
            }
        } else {
            break;
        }
    }
}

// --- macOS system audio: Core Audio process tap + aggregate, then cpal stream ---

#[cfg(target_os = "macos")]
const SYSTEM_AUDIO_TAP_NAME: &str = "lexi-audio-tap";

#[cfg(target_os = "macos")]
fn run_system_audio_capture(sender: mpsc::Sender<Vec<u8>>, stop_rx: mpsc::Receiver<()>) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use cidre::{cf, core_audio as ca, ns};
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let shutting_down = Arc::new(AtomicBool::new(false));
    let shutting_down_cb = Arc::clone(&shutting_down);

    let output_device = match ca::System::default_output_device() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("System audio: default_output_device failed: {:?}", e);
            return;
        }
    };
    let output_uid = match output_device.uid() {
        Ok(u) => u,
        Err(e) => {
            eprintln!("System audio: device uid failed: {:?}", e);
            return;
        }
    };

    let tap_desc = ca::TapDesc::with_mono_global_tap_excluding_processes(&ns::Array::new());
    let tap = match tap_desc.create_process_tap() {
        Ok(t) => t,
        Err(e) => {
            eprintln!("System audio: create_process_tap failed: {:?}", e);
            return;
        }
    };

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

    let _agg_device = match ca::AggregateDevice::with_desc(&agg_desc) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("System audio: AggregateDevice::with_desc failed: {:?}", e);
            return;
        }
    };

    // Give Core Audio time to register the aggregate; use a longer delay when
    // starting a new meeting after a previous one (avoids stale "lexi-audio-tap" in device list).
    thread::sleep(Duration::from_millis(300));

    let host = cpal::default_host();
    let device = match host.input_devices().ok().and_then(|mut devs| {
        devs.find(|d| d.name().map(|n| n == SYSTEM_AUDIO_TAP_NAME).unwrap_or(false))
    }) {
        Some(d) => d,
        None => {
            eprintln!("System audio: device '{}' not found", SYSTEM_AUDIO_TAP_NAME);
            return;
        }
    };

    let config = match device.default_input_config() {
        Ok(c) => c.into(),
        Err(e) => {
            eprintln!("System audio: default_input_config failed: {}", e);
            return;
        }
    };

    let amplitude = i16::MAX as f32;
    let stream = match device.build_input_stream(
        &config,
        move |data: &[f32], _: &cpal::InputCallbackInfo| {
            let mut bytes = Vec::with_capacity(data.len() * 2);
            for &sample in data {
                let val = (sample * amplitude).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
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
    ) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("System audio: build_input_stream failed: {}", e);
            return;
        }
    };

    if stream.play().is_err() {
        eprintln!("System audio: stream.play() failed");
        return;
    }

    let _ = stop_rx.recv();
    shutting_down.store(true, Ordering::Relaxed);
    let _ = stream.pause();
    drop(stream);
}

/// Starts meeting audio: mic ("user") + system ("system") on macOS; sends (source, chunk) to `output_tx`.
pub fn start_meeting_audio(
    app: AppHandle,
    output_tx: Arc<Mutex<Option<tokio::sync::mpsc::Sender<(String, Vec<u8>)>>>>,
    rt_handle: tokio::runtime::Handle,
) -> Result<MeetingAudioHandles, String> {
    let (mic_tx, mic_rx) = mpsc::channel::<Vec<u8>>();

    #[cfg(target_os = "macos")]
    let (system_tx, system_rx) = mpsc::channel::<Vec<u8>>();
    #[cfg(target_os = "macos")]
    let (system_stop_tx, system_stop_rx) = mpsc::channel::<()>();
    #[cfg(target_os = "macos")]
    {
        let system_tx_c = system_tx.clone();
        thread::spawn(move || run_system_audio_capture(system_tx_c, system_stop_rx));
    }

    let output_mic = output_tx.clone();
    let rt_mic = rt_handle.clone();
    thread::spawn(move || send_tagged_chunks(mic_rx, "user", output_mic, rt_mic));

    #[cfg(target_os = "macos")]
    {
        let output_sys = output_tx.clone();
        let rt_sys = rt_handle.clone();
        thread::spawn(move || send_tagged_chunks(system_rx, "system", output_sys, rt_sys));
    }

    let (recorder_stop_tx, recorder_stop_rx) = mpsc::channel::<()>();
    let app_recorder = app.clone();
    thread::spawn(move || {
        let mut recorder = super::recorder::AudioRecorder::new();
        if let Err(e) = recorder.start_recording(Some(mic_tx)) {
            eprintln!("Meeting mic recording failed: {}", e);
            let _ = app_recorder.emit("meeting-websocket-error", format!("Recording failed: {}", e));
            return;
        }
        let _ = recorder_stop_rx.recv();
        let _ = recorder.stop_recording();
    });

    Ok(MeetingAudioHandles {
        recorder_stop_tx,
        #[cfg(target_os = "macos")]
        system_stop_tx: Some(system_stop_tx),
        #[cfg(not(target_os = "macos"))]
        system_stop_tx: None,
    })
}
