// Global keyboard listener module using rdev
// 
// This module provides global keyboard event monitoring that works system-wide,
// even when the application is not in focus. It listens for configurable hotkey
// press/release events to trigger audio recording start/stop. All keyboard events
// are also emitted to the frontend for debugging purposes.

use rdev::{listen, Event, EventType, Key};
use std::sync::{mpsc, Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use std::collections::HashSet;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;
use serde::{Deserialize, Serialize};
use crate::RecordingCommand;

/// Configurable hotkey definition with modifier support
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HotkeyConfig {
    /// Primary key (e.g., Key::F1, Key::KeyA)
    pub key: String,
    /// Alternative code for special keys (e.g., 179 for Fn on some macOS)
    pub alt_code: Option<u32>,
    /// Modifier keys that must be pressed
    pub modifiers: ModifierFlags,
}

/// Modifier key flags
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct ModifierFlags {
    pub cmd: bool,
    pub shift: bool,
    pub alt: bool,
    pub ctrl: bool,
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

/// Parse a key string to rdev Key enum
fn parse_key(key_str: &str) -> Option<Key> {
    // Try to match common key names
    match key_str {
        "Function" | "Fn" => Some(Key::Function),
        "F1" => Some(Key::F1),
        "F2" => Some(Key::F2),
        "F3" => Some(Key::F3),
        "F4" => Some(Key::F4),
        "F5" => Some(Key::F5),
        "F6" => Some(Key::F6),
        "F7" => Some(Key::F7),
        "F8" => Some(Key::F8),
        "F9" => Some(Key::F9),
        "F10" => Some(Key::F10),
        "F11" => Some(Key::F11),
        "F12" => Some(Key::F12),
        _ => {
            // Try to parse as Key enum variant name (e.g., "KeyA", "Space", "Return")
            // This handles all other keys like letters, numbers, etc.
            // rdev uses format like "KeyA", "KeyB", "Num1", "Space", etc.
            // We'll try to match the string directly
            None // Will be handled by string comparison
        }
    }
}

/// Convert rdev Key to string representation
fn key_to_string(key: &Key) -> String {
    format!("{:?}", key)
}

/// Check if a key is a modifier key
fn is_modifier_key(key: &Key) -> bool {
    matches!(key, 
        Key::MetaLeft | Key::MetaRight |
        Key::ShiftLeft | Key::ShiftRight |
        Key::Alt |
        Key::ControlLeft | Key::ControlRight
    )
}

/// Get modifier state from currently pressed keys
fn get_modifier_state(pressed_keys: &HashSet<Key>) -> ModifierFlags {
    ModifierFlags {
        cmd: pressed_keys.contains(&Key::MetaLeft) || pressed_keys.contains(&Key::MetaRight),
        shift: pressed_keys.contains(&Key::ShiftLeft) || pressed_keys.contains(&Key::ShiftRight),
        alt: pressed_keys.contains(&Key::Alt),
        ctrl: pressed_keys.contains(&Key::ControlLeft) || pressed_keys.contains(&Key::ControlRight),
    }
}

/// Checks if the event is a trigger key press/release using the current config
/// This now checks for modifier combinations
fn is_trigger_key_event(
    event_type: &EventType,
    config: &HotkeyConfig,
    pressed_keys: &HashSet<Key>,
) -> Option<RecordingCommand> {
    match event_type {
        EventType::KeyPress(ref key) => {
            // Parse the config key
            let config_key = parse_key(&config.key);
            let key_matches = match config_key {
                Some(k) => *key == k,
                None => {
                    // Try string comparison for keys like "KeyA", "Space", etc.
                    key_to_string(key) == config.key || 
                    matches!(config.alt_code, Some(code) if *key == Key::Unknown(code))
                }
            };

            if key_matches && !is_modifier_key(key) {
                // Check if modifiers match
                let current_modifiers = get_modifier_state(pressed_keys);
                if current_modifiers.cmd == config.modifiers.cmd &&
                   current_modifiers.shift == config.modifiers.shift &&
                   current_modifiers.alt == config.modifiers.alt &&
                   current_modifiers.ctrl == config.modifiers.ctrl {
                    return Some(RecordingCommand::Start);
                }
            }
            None
        }
        EventType::KeyRelease(ref key) => {
            // For release, we check if the main key is released
            let config_key = parse_key(&config.key);
            let key_matches = match config_key {
                Some(k) => *key == k,
                None => {
                    key_to_string(key) == config.key || 
                    matches!(config.alt_code, Some(code) if *key == Key::Unknown(code))
                }
            };

            if key_matches && !is_modifier_key(key) {
                // On release, check if modifiers still match (they might be released after)
                let _current_modifiers = get_modifier_state(pressed_keys);
                // For release, we're more lenient - if the main key is released, trigger stop
                // even if modifiers are already released
                return Some(RecordingCommand::Stop);
            }
            None
        }
        _ => None,
    }
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
    recording_state: Arc<Mutex<bool>>
) {
    // Manager thread: Watches config, restarts listener on change
    std::thread::spawn(move || {
        let debounce_time = Arc::new(Mutex::new(Instant::now()));
        let debounce_duration = Duration::from_millis(50);
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
            let debounce_clone = debounce_time.clone();
            let app_for_callback = app_clone.clone();
            let recording_tx_for_callback = recording_tx_clone.clone();
            let recording_state_for_callback = recording_state_clone.clone();

            // Spawn the actual rdev listener thread
            let listener_thread = std::thread::spawn(move || {
                // Track currently pressed keys (including modifiers)
                let pressed_keys: Arc<Mutex<HashSet<Key>>> = Arc::new(Mutex::new(HashSet::new()));
                let pressed_keys_clone = pressed_keys.clone();
                
                let callback = move |event: Event| {
                    if shutdown_for_callback.load(Ordering::Relaxed) {
                        return;  // Early exit if shutdown signaled
                    }

                    // Check if we're in hotkey recording mode
                    let is_recording = recording_state_for_callback.lock().map(|guard| *guard).unwrap_or(false);
                    
                    // Update pressed keys set
                    match event.event_type {
                        EventType::KeyPress(ref key) => {
                            pressed_keys_clone.lock().unwrap().insert(key.clone());
                            
                            // If in recording mode, emit key events to frontend
                            if is_recording {
                                let key_str = key_to_string(key);
                                let modifier_state = get_modifier_state(&pressed_keys_clone.lock().unwrap());
                                
                                // Build modifiers list, excluding the current key if it's a modifier
                                let mut modifiers = Vec::new();
                                if modifier_state.shift && key_str != "Shift" {
                                    modifiers.push("Shift".to_string());
                                }
                                if modifier_state.ctrl && key_str != "Control" {
                                    modifiers.push("Control".to_string());
                                }
                                if modifier_state.alt && key_str != "Option" {
                                    modifiers.push("Option".to_string());
                                }
                                if modifier_state.cmd && key_str != "Command" {
                                    modifiers.push("Command".to_string());
                                }
                                
                                // Emit hotkey recording event
                                let _ = app_for_callback.emit("hotkey-recorded", serde_json::json!({
                                    "key": key_str,
                                    "modifiers": modifiers
                                }));
                            }
                        }
                        EventType::KeyRelease(ref key) => {
                            pressed_keys_clone.lock().unwrap().remove(key);
                        }
                        _ => {}
                    }

                    // Get current pressed keys for checking
                    let keys = pressed_keys_clone.lock().unwrap().clone();
                    
                    // Check if this is a trigger key event
                    if let Some(command) = is_trigger_key_event(&event.event_type, &current_config, &keys) {
                        // Debounce check
                        let mut last_trigger = debounce_clone.lock().unwrap();
                        if last_trigger.elapsed() < debounce_duration {
                            return;
                        }
                        *last_trigger = Instant::now();
                        drop(last_trigger);

                        // Log the trigger
                        let trigger_type = match command {
                            RecordingCommand::Start => "PRESSED",
                            RecordingCommand::Stop => "RELEASED",
                        };
                        println!("=== HOTKEY TRIGGER: {} ({:?}) ===", trigger_type, current_config);

                        // Query cursor context
                        crate::cursor_context::log_cursor_context();

                        println!("Hotkey {} - {} recording", 
                            match command {
                                RecordingCommand::Start => "pressed",
                                RecordingCommand::Stop => "released",
                            },
                            match command {
                                RecordingCommand::Start => "Starting",
                                RecordingCommand::Stop => "Stopping",
                            });

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

                    // Emit all keyboard events for debug
                    if let Some(event_string) = event_type_to_string(&event.event_type) {
                        println!("Keyboard event: {:?}", event);
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
            // Unpark the listener thread if blocked (rdev::listen is blocking, but AtomicBool check is polled)
            // Note: rdev doesn't have built-in shutdown; the flag + next event will exit loop implicitly
            let _ = listener_thread.join();  // Wait for clean shutdown
        }
    });
}

