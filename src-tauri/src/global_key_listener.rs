//! Global Keyboard Listener Module
//!
//! This module provides system-wide keyboard event monitoring using the `rdev` crate.
//! It listens for configurable hotkey press/release events to trigger audio recording
//! start/stop, even when the application is not in focus.
//!
//! ## Features
//!
//! - **Function Key Hotkey**: Supports Function (Fn) key only for triggering recording
//! - **Dynamic Configuration**: Hotkey config can be changed at runtime (currently always Function key)
//! - **Hotkey Recording Mode**: Emits key events to frontend for interactive hotkey selection
//!
//! ## Architecture
//!
//! The listener runs in a manager thread that watches for configuration changes.
//! When the hotkey config changes, it shuts down the old `rdev::listen` thread and
//! spawns a new one with the updated configuration. This allows hotkey changes without
//! restarting the entire application.
//!
//! ## Permissions Required
//!
//! - **Input Monitoring** (macOS): Required for `rdev::listen` to work system-wide

use crate::RecordingCommand;
use rdev::{listen, Event, EventType, Key};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

/// Tracks the actual state of the Function key to prevent spurious events
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KeyState {
    Released,
    Pressed,
}

/// Key state tracker to prevent duplicate/spurious events
struct KeyStateTracker {
    state: KeyState,
    last_state_change: Instant,
}

impl KeyStateTracker {
    fn new() -> Self {
        Self {
            state: KeyState::Released,
            last_state_change: Instant::now(),
        }
    }

    /// Returns Some(command) only if this is a valid state transition
    /// Filters out duplicate events and ensures proper Start→Stop ordering
    fn process_event(&mut self, event_type: &EventType) -> Option<RecordingCommand> {
        const MIN_STATE_DURATION: Duration = Duration::from_millis(50);
        
        match event_type {
            EventType::KeyPress(Key::Function) => {
                // Only transition to Pressed if currently Released
                if self.state == KeyState::Released {
                    let elapsed = self.last_state_change.elapsed();
                    if elapsed >= MIN_STATE_DURATION {
                        self.state = KeyState::Pressed;
                        self.last_state_change = Instant::now();
                        println!("🔑 Key state: Released → Pressed (after {:?})", elapsed);
                        return Some(RecordingCommand::Start);
                    } else {
                        println!("⚠️  Ignoring rapid KeyPress (only {:?} since last change)", elapsed);
                    }
                } else {
                    // Already pressed - ignore duplicate KeyPress
                    println!("⚠️  Ignoring duplicate KeyPress (key already pressed)");
                }
            }
            EventType::KeyRelease(Key::Function) => {
                // Only transition to Released if currently Pressed
                if self.state == KeyState::Pressed {
                    let elapsed = self.last_state_change.elapsed();
                    if elapsed >= MIN_STATE_DURATION {
                        self.state = KeyState::Released;
                        self.last_state_change = Instant::now();
                        println!("🔑 Key state: Pressed → Released (held for {:?})", elapsed);
                        return Some(RecordingCommand::Stop);
                    } else {
                        println!("⚠️  Ignoring rapid KeyRelease (only {:?} since press)", elapsed);
                    }
                } else {
                    // Already released - ignore duplicate KeyRelease
                    println!("⚠️  Ignoring duplicate KeyRelease (key already released)");
                }
            }
            _ => {}
        }
        None
    }
    
    /// Reset state (e.g., when listener restarts)
    fn reset(&mut self) {
        self.state = KeyState::Released;
        self.last_state_change = Instant::now();
        println!("🔑 Key state tracker reset to Released");
    }
}

/// Hotkey configuration (simplified to Function key only)
/// Kept for compatibility with existing config system
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HotkeyConfig {
    /// Human-readable hotkey string (currently only "Fn" is supported)
    pub hotkey: String,
}

impl HotkeyConfig {
    // Simplified - we only support Function key now
    // This method is kept for compatibility but always returns Function key
    #[allow(dead_code)]
    pub fn get_key_and_modifiers(&self) -> (String, Option<u32>, ()) {
        // Always return Function key regardless of config
        ("Function".to_string(), Some(179), ())
    }
}

/// Helper to convert keyboard EventType to a string for frontend emission
/// Only handles keyboard events (KeyPress and KeyRelease)
fn event_type_to_string(event_type: &EventType) -> Option<String> {
    match event_type {
        EventType::KeyPress(key) => Some(format!("key_press: {:?}", key)),
        EventType::KeyRelease(key) => Some(format!("key_release: {:?}", key)),
        _ => None, // Ignore mouse events
    }
}

/// Convert rdev Key to string representation for frontend
/// Normalizes key names to match frontend expectations
fn key_to_string(key: &Key) -> String {
    match key {
        Key::MetaLeft | Key::MetaRight => "Command".to_string(),
        Key::ControlLeft | Key::ControlRight => "Control".to_string(),
        Key::Alt => "Option".to_string(),
        Key::ShiftLeft | Key::ShiftRight => "Shift".to_string(),
        _ => format!("{:?}", key),
    }
}

/// Checks if the event is a Function key event (press or release)
/// Returns true if it's a Function key event that should be processed by the state tracker
fn is_function_key_event(event_type: &EventType) -> bool {
    matches!(
        event_type,
        EventType::KeyPress(Key::Function) | EventType::KeyRelease(Key::Function)
    )
}

/// Starts the global keyboard listener in a background thread with dynamic config support.
///
/// This spawns a manager thread that watches for config changes via `config_rx`.
/// On change, it shuts down the old rdev listener and spawns a new one with the updated config.
///
/// # Arguments
/// * `app` - The Tauri AppHandle used to emit events to the frontend
/// * `recording_tx` - Channel sender to signal start/stop recording
/// * `config_rx` - Watch receiver for hotkey config changes
/// * `recording_state` - Shared state to check if we're in hotkey recording mode
pub fn start_listener(
    app: AppHandle,
    recording_tx: mpsc::Sender<RecordingCommand>,
    mut config_rx: watch::Receiver<HotkeyConfig>,
    recording_state: Arc<Mutex<bool>>,
) {
    // Manager thread: Watches config, restarts listener on change
    std::thread::spawn(move || {
        let app_clone = app.clone();
        let recording_tx_clone = recording_tx.clone();
        let recording_state_clone = recording_state.clone();

        loop {
            // Get current config
            let current_config = config_rx.borrow().clone();
            println!("🔑 Starting rdev listener for hotkey: {:?}", current_config);

            // Shutdown flag for this listener instance
            let shutdown = Arc::new(AtomicBool::new(false));
            let shutdown_for_callback = shutdown.clone();
            let app_for_callback = app_clone.clone();
            let recording_tx_for_callback = recording_tx_clone.clone();
            let recording_state_for_callback = recording_state_clone.clone();

            // Key state tracker to prevent spurious/duplicate events
            let key_state_tracker = Arc::new(Mutex::new(KeyStateTracker::new()));
            let key_state_tracker_for_callback = key_state_tracker.clone();

            // Spawn the actual rdev listener thread
            let listener_thread = std::thread::spawn(move || {
                let callback = move |event: Event| {
                    if shutdown_for_callback.load(Ordering::Relaxed) {
                        return; // Early exit if shutdown signaled
                    }

                    // Check if we're in hotkey recording mode (for UI hotkey selection)
                    let is_recording = recording_state_for_callback
                        .lock()
                        .map(|guard| *guard)
                        .unwrap_or(false);

                    // If in recording mode, emit key events to frontend for hotkey selection
                    if is_recording {
                        match &event.event_type {
                            EventType::KeyPress(ref key) => {
                                let key_str = key_to_string(key);
                                let _ = app_for_callback.emit(
                                    "hotkey-recorded",
                                    serde_json::json!({
                                        "key": key_str,
                                        "modifiers": []
                                    }),
                                );
                            }
                            _ => {}
                        }
                    }

                    // Check if this is a Function key event and process through state tracker
                    if is_function_key_event(&event.event_type) {
                        // Use state tracker to filter spurious/duplicate events
                        let command = {
                            if let Ok(mut tracker) = key_state_tracker_for_callback.lock() {
                                tracker.process_event(&event.event_type)
                            } else {
                                eprintln!("❌ Failed to lock key state tracker");
                                None
                            }
                        };

                        // Only process if state tracker approved the transition
                        if let Some(command) = command {
                            // Log the trigger
                            let trigger_type = match command {
                                RecordingCommand::Start => "PRESSED",
                                RecordingCommand::Stop => "RELEASED",
                            };
                            println!(
                                "=== HOTKEY TRIGGER: {} ({:?}) ===",
                                trigger_type, current_config
                            );

                            // Query cursor context
                            if let Some(context) = crate::cursor_context::get_cursor_context() {
                                println!(
                                    "Cursor context - App: {:?}, PID: {:?}, Text: {:?}",
                                    context.app_name, context.pid, context.selected_text
                                );
                            }

                            println!(
                                "Hotkey {} - {} recording",
                                match command {
                                    RecordingCommand::Start => "pressed",
                                    RecordingCommand::Stop => "released",
                                },
                                match command {
                                    RecordingCommand::Start => "Starting",
                                    RecordingCommand::Stop => "Stopping",
                                }
                            );

                            // Send to recording
                            if let Err(e) = recording_tx_for_callback.send(command) {
                                eprintln!("Failed to send recording signal: {:?}", e);
                            }

                            // Emit to frontend
                            let event_name = match command {
                                RecordingCommand::Start => "recording_started",
                                RecordingCommand::Stop => "recording_stopped",
                            };
                            if let Err(e) = app_for_callback.emit(event_name, ()) {
                                eprintln!("Failed to emit {} event: {:?}", event_name, e);
                            }
                        }
                    }

                    // Emit all keyboard events for debug
                    if let Some(event_string) = event_type_to_string(&event.event_type) {
                        // println!("Keyboard event: {:?}", event);
                        if let Err(e) = app_for_callback.emit("global-input", &event_string) {
                            eprintln!("Failed to emit event: {:?}", e);
                        }
                    }
                };

                if let Err(error) = listen(callback) {
                    eprintln!("rdev listen error: {:?}", error);
                }
            });

            // Wait for config change or channel close
            // Since we're in a blocking std thread, create a small runtime to await the future
            let shutdown_for_wait = shutdown.clone();
            let changed_result = if let Ok(handle) = tokio::runtime::Handle::try_current() {
                handle.block_on(config_rx.changed())
            } else {
                // If no runtime available, create a small one just for this operation
                match tokio::runtime::Runtime::new() {
                    Ok(rt) => rt.block_on(config_rx.changed()),
                    Err(_) => {
                        // Can't create runtime, exit
                        shutdown_for_wait.store(true, Ordering::Relaxed);
                        let _ = listener_thread.join();
                        break;
                    }
                }
            };

            if changed_result.is_err() {
                // Channel closed, shutdown and exit
                shutdown_for_wait.store(true, Ordering::Relaxed);
                let _ = listener_thread.join();
                break;
            }

            // New config available: Shutdown old and loop to restart
            println!("🔄 Hotkey config changed, restarting listener...");
            shutdown.store(true, Ordering::Relaxed);
            
            // Reset the key state tracker to ensure clean state on restart
            if let Ok(mut tracker) = key_state_tracker.lock() {
                tracker.reset();
            }
            
            // Unpark the listener thread if blocked (rdev::listen is blocking, but AtomicBool check is polled)
            // Note: rdev doesn't have built-in shutdown; the flag + next event will exit loop implicitly
            let _ = listener_thread.join(); // Wait for clean shutdown
        }
    });
}
