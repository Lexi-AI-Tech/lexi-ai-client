//! Recording Thread Module
//!
//! This module manages the dedicated thread that handles audio recording.
//! It receives start/stop commands from the global key listener and manages
//! the AudioRecorder lifecycle using an explicit state machine.
//! Now optimized to handle both Assistant (Speech-to-Text) and Action modes.

use super::recorder::AudioRecorder;
use crate::actions::processor::process_action_audio;
use crate::assistant::processor::process_audio;
use crate::RecordingCommand;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Recording phase states
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecordingPhase {
    Idle,
    Starting,  // Just received Start, initializing stream
    Recording, // Actively capturing audio
    Stopping,  // Received Stop, still flushing/processing final buffers
    Error(RecordingError),
}

/// Recording error types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecordingError {
    AudioStreamFailed,
    StopFailed,
}

/// Mode of recording
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecordingMode {
    Assistant,
    Action,
}

/// Recording context with state machine
struct RecordingContext {
    phase: RecordingPhase,
    mode: RecordingMode,
    recorder: Option<AudioRecorder>,
    started_at: Option<Instant>,
    last_command_at: Instant,
}

impl RecordingContext {
    fn new() -> Self {
        Self {
            phase: RecordingPhase::Idle,
            mode: RecordingMode::Assistant,
            recorder: None,
            started_at: None,
            last_command_at: Instant::now(),
        }
    }

    fn transition_to(&mut self, new_phase: RecordingPhase) {
        println!(
            "🔄 Recording phase transition: {:?} → {:?} (Mode: {:?})",
            self.phase, new_phase, self.mode
        );
        self.phase = new_phase;
        self.last_command_at = Instant::now();
    }
}

/// Spawns a dedicated thread to manage the audio recorder.
///
/// This thread handles creating, starting, and stopping the recorder.
/// It receives signals from the global key listener via the channel.
/// Uses an explicit state machine to track recording lifecycle.
///
/// # Arguments
/// * `app_handle` - The Tauri AppHandle for emitting events
/// * `recording_rx` - Receiver for recording commands (Start/Stop/ActionStart/ActionStop)
pub fn spawn_recording_thread(
    app_handle: AppHandle,
    recording_rx: mpsc::Receiver<RecordingCommand>,
) {
    thread::spawn(move || {
        let mut ctx = RecordingContext::new();
        // Reduced from 200ms to 50ms for faster response to key presses
        // This is the maximum latency for receiving a recording command
        const TIMEOUT_CHECK_INTERVAL: Duration = Duration::from_millis(10); // Ultra fast check
        const STUCK_THRESHOLD: Duration = Duration::from_secs(8);
        /// Recordings shorter than this are not sent to the API
        const MIN_RECORDING_DURATION: Duration = Duration::from_millis(300); // 0.3 seconds

        loop {
            let command = match recording_rx.recv_timeout(TIMEOUT_CHECK_INTERVAL) {
                Ok(cmd) => cmd,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // Check for stuck states (timeout detection)
                    if matches!(
                        ctx.phase,
                        RecordingPhase::Starting | RecordingPhase::Stopping
                    ) && ctx.last_command_at.elapsed() > STUCK_THRESHOLD
                    {
                        eprintln!(
                            "⚠️  Recording appears stuck in {:?} for {:?}s",
                            ctx.phase,
                            ctx.last_command_at.elapsed().as_secs()
                        );
                        ctx.transition_to(RecordingPhase::Error(RecordingError::AudioStreamFailed));
                        // Try to recover by cleaning up
                        ctx.recorder = None;
                        ctx.started_at = None;
                        ctx.transition_to(RecordingPhase::Idle);
                        app_handle
                            .emit("recording_error", "Recording operation timed out")
                            .unwrap_or_default();
                    }
                    continue;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    println!("📡 Recording command channel disconnected, exiting thread");
                    break;
                }
            };

            // Map command to simple start/stop logic and mode
            // We unify Start/ActionStart and Stop/ActionStop logic here
            match (command, ctx.phase) {
                // ── START RECORDING ─────────────────────────────────
                (RecordingCommand::Start, RecordingPhase::Idle | RecordingPhase::Error(_))
                | (
                    RecordingCommand::ActionStart,
                    RecordingPhase::Idle | RecordingPhase::Error(_),
                ) => {
                    // distinct mode setup
                    ctx.mode = match command {
                        RecordingCommand::ActionStart => RecordingMode::Action,
                        _ => RecordingMode::Assistant,
                    };

                    ctx.transition_to(RecordingPhase::Starting);
                    println!("🎙️  Starting recording... Mode: {:?}", ctx.mode);

                    // Show the pill window when recording starts
                    if let Some(pill_window) = app_handle.get_webview_window("pill") {
                        if let Err(e) = pill_window.show() {
                            eprintln!("⚠️  Failed to show pill window: {}", e);
                        }
                    }

                    // Create channel for real-time volume updates
                    let (volume_tx, volume_rx) = mpsc::channel::<f32>();

                    // Spawn thread to forward volume updates to frontend
                    let app_handle_for_volume = app_handle.clone();
                    thread::spawn(move || {
                        while let Ok(volume) = volume_rx.recv() {
                            // Emit volume update to frontend for waveform visualization
                            let _ = app_handle_for_volume.emit("volume-update", volume);
                        }
                    });

                    let mut new_recorder = AudioRecorder::new();
                    new_recorder.set_volume_sender(volume_tx);

                    match new_recorder.start_recording(None) {
                        Ok(_) => {
                            ctx.recorder = Some(new_recorder);
                            ctx.started_at = Some(Instant::now());
                            ctx.transition_to(RecordingPhase::Recording);
                            println!("✅ Recording started successfully");

                            // Emit events based on mode
                            match ctx.mode {
                                RecordingMode::Assistant => {
                                    app_handle.emit("recording_started", ()).unwrap_or_default();
                                }
                                RecordingMode::Action => {
                                    app_handle
                                        .emit("action_recording_started", ())
                                        .unwrap_or_default();
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("❌ Failed to start recording: {}", e);
                            ctx.transition_to(RecordingPhase::Error(
                                RecordingError::AudioStreamFailed,
                            ));
                            let event_name = match ctx.mode {
                                RecordingMode::Action => "action_recording_error",
                                _ => "recording_error",
                            };
                            app_handle
                                .emit(event_name, e.to_string())
                                .unwrap_or_default();
                        }
                    }
                }

                // ── STOP RECORDING ──────────────────────────────────
                (RecordingCommand::Stop, RecordingPhase::Recording | RecordingPhase::Starting)
                | (
                    RecordingCommand::ActionStop,
                    RecordingPhase::Recording | RecordingPhase::Starting,
                ) => {
                    // Verify command matches mode?
                    // Ideally yes, but for unified thread, simply stopping whatever is running is safer
                    // to prevent "stuck in recording" if key release event type mismatch happened.

                    ctx.transition_to(RecordingPhase::Stopping);
                    println!("🛑 Stopping recording...");

                    if let Some(mut rec) = ctx.recorder.take() {
                        match rec.stop_recording() {
                            Ok(audio_data) => {
                                let duration =
                                    ctx.started_at.map(|t| t.elapsed()).unwrap_or_default();
                                println!(
                                    "✅ Recording stopped successfully (duration: {:.2}s, audio size: {} bytes)",
                                    duration.as_secs_f64(),
                                    audio_data.len()
                                );

                                // Emit events based on mode
                                match ctx.mode {
                                    RecordingMode::Assistant => {
                                        app_handle
                                            .emit("recording_stopped", ())
                                            .unwrap_or_default();
                                    }
                                    RecordingMode::Action => {
                                        app_handle
                                            .emit("action_recording_stopped", ())
                                            .unwrap_or_default();
                                    }
                                }

                                if duration < MIN_RECORDING_DURATION {
                                    println!(
                                        "⏭️  Recording too short ({:.2}s < {:.2}s), skipping processing",
                                        duration.as_secs_f64(),
                                        MIN_RECORDING_DURATION.as_secs_f64()
                                    );
                                    // Tell pill/frontend to go back to idle
                                    app_handle.emit("recording_skipped", ()).unwrap_or_default();
                                } else {
                                    // Process the audio based on mode
                                    match ctx.mode {
                                        RecordingMode::Assistant => {
                                            process_audio(audio_data, app_handle.clone());
                                        }
                                        RecordingMode::Action => {
                                            // Process action asynchronously embedded or in processor
                                            let app_handle_clone = app_handle.clone();
                                            tauri::async_runtime::spawn(async move {
                                                process_action_audio(audio_data, app_handle_clone)
                                                    .await;
                                            });
                                        }
                                    }
                                }
                                ctx.transition_to(RecordingPhase::Idle);
                            }
                            Err(e) => {
                                eprintln!("❌ Failed to stop recording: {}", e);
                                ctx.transition_to(RecordingPhase::Error(
                                    RecordingError::StopFailed,
                                ));
                                let event_name = match ctx.mode {
                                    RecordingMode::Action => "action_recording_error",
                                    _ => "recording_error",
                                };
                                app_handle
                                    .emit(event_name, e.to_string())
                                    .unwrap_or_default();
                                // Transition back to idle to allow recovery
                                ctx.transition_to(RecordingPhase::Idle);
                            }
                        }
                    } else {
                        // Rare but possible race condition
                        eprintln!(
                            "⚠️  Stop command received but no recorder found (race condition?)"
                        );
                        ctx.transition_to(RecordingPhase::Idle);
                    }
                }

                // ── ERROR HANDLING / IGNORED STATES ─────────────────

                // Ignoring duplicates
                (RecordingCommand::Start, _) | (RecordingCommand::ActionStart, _) => {
                    // Already recording/starting/stopping
                }

                (RecordingCommand::Stop, _) | (RecordingCommand::ActionStop, _) => {
                    // Not recording, nothing to stop
                }
            }
        }
    });
}
