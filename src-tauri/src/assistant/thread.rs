//! Recording Thread Module
//!
//! This module manages the dedicated thread that handles audio recording.
//! It receives start/stop commands from the global key listener and manages
//! the AudioRecorder lifecycle using an explicit state machine.

use super::processor::process_audio;
use crate::audio_recorder::AudioRecorder;
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

/// Recording context with state machine
struct RecordingContext {
    phase: RecordingPhase,
    recorder: Option<AudioRecorder>,
    started_at: Option<Instant>,
    last_command_at: Instant,
}

impl RecordingContext {
    fn new() -> Self {
        Self {
            phase: RecordingPhase::Idle,
            recorder: None,
            started_at: None,
            last_command_at: Instant::now(),
        }
    }

    fn transition_to(&mut self, new_phase: RecordingPhase) {
        println!(
            "🔄 Recording phase transition: {:?} → {:?}",
            self.phase, new_phase
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
/// * `recording_rx` - Receiver for recording commands (Start/Stop)
pub fn spawn_recording_thread(
    app_handle: AppHandle,
    recording_rx: mpsc::Receiver<RecordingCommand>,
) {
    thread::spawn(move || {
        let mut ctx = RecordingContext::new();
        // Reduced from 200ms to 50ms for faster response to key presses
        // This is the maximum latency for receiving a recording command
        const TIMEOUT_CHECK_INTERVAL: Duration = Duration::from_millis(50);
        const STUCK_THRESHOLD: Duration = Duration::from_secs(8);
        /// Recordings shorter than this are not sent to the Assistant API; we just complete the lifecycle and go idle.
        const MIN_RECORDING_DURATION: Duration = Duration::from_millis(700); // 0.7 seconds

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

            match (command, ctx.phase) {
                // Ignore Action commands in this thread (handled by action_recording_thread)
                (RecordingCommand::ActionStart, _) | (RecordingCommand::ActionStop, _) => {}

                // ── Valid transitions ───────────────────────────────
                (RecordingCommand::Start, RecordingPhase::Idle | RecordingPhase::Error(_)) => {
                    ctx.transition_to(RecordingPhase::Starting);
                    println!("🎙️  Starting recording...");

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
                            app_handle.emit("recording_started", ()).unwrap_or_default();
                        }
                        Err(e) => {
                            eprintln!("❌ Failed to start recording: {}", e);
                            ctx.transition_to(RecordingPhase::Error(
                                RecordingError::AudioStreamFailed,
                            ));
                            app_handle
                                .emit("recording_error", e.to_string())
                                .unwrap_or_default();
                        }
                    }
                }

                (RecordingCommand::Stop, RecordingPhase::Recording | RecordingPhase::Starting) => {
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

                                app_handle.emit("recording_stopped", ()).unwrap_or_default();

                                if duration < MIN_RECORDING_DURATION {
                                    println!(
                                        "⏭️  Recording too short ({:.2}s < {:.2}s), skipping Assistant API",
                                        duration.as_secs_f64(),
                                        MIN_RECORDING_DURATION.as_secs_f64()
                                    );
                                    // Tell pill/frontend to go back to idle (no transcription_success will be emitted)
                                    app_handle.emit("recording_skipped", ()).unwrap_or_default();
                                } else {
                                    // Process the audio (transcription / Assistant API)
                                    process_audio(audio_data, app_handle.clone());
                                }
                                ctx.transition_to(RecordingPhase::Idle);
                            }
                            Err(e) => {
                                eprintln!("❌ Failed to stop recording: {}", e);
                                ctx.transition_to(RecordingPhase::Error(
                                    RecordingError::StopFailed,
                                ));
                                app_handle
                                    .emit("recording_error", e.to_string())
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

                // ── Ignored / invalid transitions (with logging!) ──
                (RecordingCommand::Start, RecordingPhase::Starting | RecordingPhase::Recording) => {
                    println!(
                        "⚠️  Ignoring Start command - already in {:?} phase",
                        ctx.phase
                    );
                    // Optional: notify frontend about duplicate start attempts
                }

                (RecordingCommand::Stop, RecordingPhase::Idle | RecordingPhase::Stopping) => {
                    println!(
                        "⚠️  Ignoring Stop command - not recording (current phase: {:?})",
                        ctx.phase
                    );
                }

                (RecordingCommand::Stop, RecordingPhase::Error(_)) => {
                    println!(
                        "⚠️  Ignoring Stop command - already in error state: {:?}",
                        ctx.phase
                    );
                    // Allow recovery by transitioning to Idle
                    ctx.transition_to(RecordingPhase::Idle);
                }

                (RecordingCommand::Start, RecordingPhase::Stopping) => {
                    println!(
                        "⚠️  Ignoring Start command - currently stopping (phase: {:?})",
                        ctx.phase
                    );
                }
            }
        }
    });
}
