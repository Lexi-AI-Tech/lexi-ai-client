//! Meeting audio: microphone + system audio, sent with source tag for transcription.
//!
//! Mic capture always runs. System audio: **macOS** — Core Audio process tap + cpal;
//! **Windows** — WASAPI loopback on the default render device. Audio is sent as `(source, chunk)`
//! so the UI/backend can attribute transcripts to `"user"` (mic) or `"system"`.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod win;

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Mic ("user") sends are staggered behind system-audio sends by this much so that, for
/// the same real-world utterance, the system_audio copy reliably reaches the server (and
/// is saved) before the user_audio echo of it arrives — letting the server's duplicate
/// check compare against an already-saved segment instead of racing it. See the
/// deduplication note in the server's meeting service.
const USER_AUDIO_SEND_DELAY: Duration = Duration::from_millis(500);

/// Handles to stop meeting audio (recorder + optional system-audio capture).
pub struct MeetingAudioHandles {
    pub recorder_stop_tx: mpsc::Sender<()>,
    /// Signal to stop system audio capture (`Some` on macOS and Windows when loopback/tap runs).
    pub system_stop_tx: Option<mpsc::Sender<()>>,
}

/// Sends (source, chunk) to output; used for mic (source "user") and system (source "system").
/// `initial_delay`, if set, is slept once before the first chunk is sent — a fixed
/// time-shift applied to the whole stream (not a per-chunk sleep, which would keep
/// compounding since chunks arrive faster than the delay).
fn send_tagged_chunks(
    rx: mpsc::Receiver<Vec<u8>>,
    source: &'static str,
    output_tx: Arc<Mutex<Option<tokio::sync::mpsc::Sender<(String, Vec<u8>)>>>>,
    rt_handle: tokio::runtime::Handle,
    initial_delay: Option<Duration>,
) {
    if let Some(delay) = initial_delay {
        thread::sleep(delay);
    }
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

#[cfg(target_os = "macos")]
pub fn spawn_process_tap_permission_attempt() {
    macos::spawn_process_tap_permission_attempt();
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)] // Only meaningful on macOS; keep stub to avoid cfg noise at call sites.
pub fn spawn_process_tap_permission_attempt() {}

#[cfg(target_os = "macos")]
fn run_system_audio_capture(sender: mpsc::Sender<Vec<u8>>, stop_rx: mpsc::Receiver<()>) {
    macos::run_system_audio_capture(sender, stop_rx);
}

#[cfg(target_os = "windows")]
fn run_system_audio_capture(sender: mpsc::Sender<Vec<u8>>, stop_rx: mpsc::Receiver<()>) {
    win::run_system_audio_capture(sender, stop_rx);
}

/// Starts meeting audio: mic (`"user"`) + system (`"system"`) on macOS/Windows; sends `(source, chunk)` to `output_tx`.
pub fn start_meeting_audio(
    app: AppHandle,
    output_tx: Arc<Mutex<Option<tokio::sync::mpsc::Sender<(String, Vec<u8>)>>>>,
    rt_handle: tokio::runtime::Handle,
) -> Result<MeetingAudioHandles, String> {
    let (mic_tx, mic_rx) = mpsc::channel::<Vec<u8>>();

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let (system_tx, system_rx) = mpsc::channel::<Vec<u8>>();
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let (system_stop_tx, system_stop_rx) = mpsc::channel::<()>();
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let system_tx_c = system_tx.clone();
        thread::spawn(move || run_system_audio_capture(system_tx_c, system_stop_rx));
    }

    let output_mic = output_tx.clone();
    let rt_mic = rt_handle.clone();
    thread::spawn(move || {
        send_tagged_chunks(mic_rx, "user", output_mic, rt_mic, Some(USER_AUDIO_SEND_DELAY))
    });

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let output_sys = output_tx.clone();
        let rt_sys = rt_handle.clone();
        thread::spawn(move || send_tagged_chunks(system_rx, "system", output_sys, rt_sys, None));
    }

    let (recorder_stop_tx, recorder_stop_rx) = mpsc::channel::<()>();
    let app_recorder = app.clone();
    thread::spawn(move || {
        let mut recorder = super::recorder::AudioRecorder::new();
        if let Err(e) = recorder.start_recording(Some(mic_tx)) {
            eprintln!("Meeting mic recording failed: {}", e);
            let _ = app_recorder.emit(
                "meeting-websocket-error",
                format!("Recording failed: {}", e),
            );
            return;
        }
        let _ = recorder_stop_rx.recv();
        let _ = recorder.stop_recording();
    });

    Ok(MeetingAudioHandles {
        recorder_stop_tx,
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        system_stop_tx: Some(system_stop_tx),
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        system_stop_tx: None,
    })
}
