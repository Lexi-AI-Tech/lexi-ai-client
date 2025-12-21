//! Global Keyboard Listener Module
//!
//! This module provides system-wide keyboard event monitoring using the `rdev` crate.
//! It listens for configurable hotkey press/release events to trigger audio recording
//! start/stop, even when the application is not in focus.
//!
//! ## Features
//!
//! - **Configurable Hotkeys**: Supports any key or key combination (e.g., "Fn", "Ctrl+Shift+P", "Cmd+K")
//! - **Dynamic Configuration**: Hotkey can be changed at runtime without restarting the listener
//! - **Modifier Support**: Handles Command, Control, Option/Alt, and Shift modifiers
//! - **Hotkey Recording Mode**: Emits key events to frontend for interactive hotkey selection
//! - **Debouncing**: Prevents rapid trigger events from causing multiple recordings
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
/// Stores hotkey as a human-readable string (e.g., "Ctrl+Shift+P", "Cmd+K", "Option")
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HotkeyConfig {
    /// Human-readable hotkey string (e.g., "Ctrl+Shift+P", "Cmd+K", "Option")
    pub hotkey: String,
}

impl HotkeyConfig {
    /// Parse a hotkey string (e.g., "Ctrl+Shift+P") and extract structured key and modifiers for internal use
    pub fn get_key_and_modifiers(&self) -> (String, Option<u32>, ModifierFlags) {
        let parts: Vec<&str> = self.hotkey.split('+').map(|s| s.trim()).collect();
        
        let mut modifiers = ModifierFlags::default();
        let mut key = None;
        let mut alt_code = None;
        
        for part in parts {
            let part_lower = part.to_lowercase();
            match part_lower.as_str() {
                "cmd" | "command" | "meta" => modifiers.cmd = true,
                "ctrl" | "control" => modifiers.ctrl = true,
                "alt" | "option" => modifiers.alt = true,
                "shift" => modifiers.shift = true,
                "fn" | "function" => {
                    key = Some("Function".to_string());
                    alt_code = Some(179);
                }
                _ => {
                    // This should be the main key
                    if key.is_none() {
                        // Map common key names
                        key = Some(match part {
                            "Space" => "Space".to_string(),
                            "Enter" | "Return" => "Return".to_string(),
                            "Escape" | "Esc" => "Escape".to_string(),
                            "Tab" => "Tab".to_string(),
                            "Backspace" => "Backspace".to_string(),
                            "Up" | "UpArrow" => "UpArrow".to_string(),
                            "Down" | "DownArrow" => "DownArrow".to_string(),
                            "Left" | "LeftArrow" => "LeftArrow".to_string(),
                            "Right" | "RightArrow" => "RightArrow".to_string(),
                            _ => {
                                // Handle function keys
                                if part.starts_with('F') && part.len() > 1 {
                                    part.to_string()
                                } else if part.len() == 1 {
                                    // Single character key
                                    format!("Key{}", part.to_uppercase())
                                } else if part.starts_with("Num") {
                                    part.to_string()
                                } else {
                                    part.to_string()
                                }
                            }
                        });
                    }
                }
            }
        }
        
        // If no key was found but we have modifiers, the modifier itself is the key
        if key.is_none() {
            if modifiers.cmd {
                key = Some("MetaLeft".to_string());
            } else if modifiers.ctrl {
                key = Some("ControlLeft".to_string());
            } else if modifiers.alt {
                key = Some("Alt".to_string());
            } else if modifiers.shift {
                key = Some("ShiftLeft".to_string());
            }
        }
        
        (
            key.unwrap_or_else(|| "Function".to_string()),
            alt_code,
            modifiers,
        )
    }
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
        // Handle normalized modifier names from key_to_string
        "Command" | "Cmd" => Some(Key::MetaLeft), // Use MetaLeft as default
        "Control" | "Ctrl" => Some(Key::ControlLeft), // Use ControlLeft as default
        "Option" | "Alt" => Some(Key::Alt),
        "Shift" => Some(Key::ShiftLeft), // Use ShiftLeft as default
        // Handle rdev Key enum variant names directly (from frontend)
        "MetaLeft" | "MetaRight" => Some(Key::MetaLeft), // Both map to MetaLeft for matching
        "ControlLeft" | "ControlRight" => Some(Key::ControlLeft), // Both map to ControlLeft for matching
        "ShiftLeft" | "ShiftRight" => Some(Key::ShiftLeft), // Both map to ShiftLeft for matching
        _ => {
            // Try to parse as Key enum variant name (e.g., "KeyA", "Space", "Return")
            // This handles all other keys like letters, numbers, etc.
            // rdev uses format like "KeyA", "KeyB", "Num1", "Space", etc.
            // We'll try to match the string directly
            None // Will be handled by string comparison
        }
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
/// Supports any key or key combination, including modifier-only hotkeys
fn is_trigger_key_event(
    event_type: &EventType,
    config: &HotkeyConfig,
    pressed_keys: &HashSet<Key>,
) -> Option<RecordingCommand> {
    // Get structured key and modifiers from config
    let (config_key_str, alt_code, config_modifiers) = config.get_key_and_modifiers();
    
    match event_type {
        EventType::KeyPress(ref key) => {
            // Parse the config key
            let config_key = parse_key(&config_key_str);
            let key_matches = match config_key {
                Some(k) => {
                    // For modifier keys, match both left and right variants
                    match k {
                        Key::MetaLeft => matches!(key, Key::MetaLeft | Key::MetaRight),
                        Key::MetaRight => matches!(key, Key::MetaLeft | Key::MetaRight),
                        Key::ControlLeft => matches!(key, Key::ControlLeft | Key::ControlRight),
                        Key::ControlRight => matches!(key, Key::ControlLeft | Key::ControlRight),
                        Key::ShiftLeft => matches!(key, Key::ShiftLeft | Key::ShiftRight),
                        Key::ShiftRight => matches!(key, Key::ShiftLeft | Key::ShiftRight),
                        _ => *key == k,
                    }
                },
                None => {
                    // Try string comparison for keys like "KeyA", "Space", etc.
                    key_to_string(key) == config_key_str || 
                    matches!(alt_code, Some(code) if *key == Key::Unknown(code))
                }
            };

            if key_matches {
                // Get current modifier state
                let current_modifiers = get_modifier_state(pressed_keys);
                
                // Determine what the primary key is (for modifier exclusion)
                let is_primary_key_modifier = is_modifier_key(key);
                
                // Build expected modifier state, excluding the primary key if it's a modifier
                let mut expected_modifiers = config_modifiers.clone();
                
                // If the primary key is a modifier, exclude it from the expected modifiers
                // (e.g., if Option is the primary key, don't also require it in modifiers)
                if is_primary_key_modifier {
                    match key {
                        Key::MetaLeft | Key::MetaRight => expected_modifiers.cmd = false,
                        Key::ShiftLeft | Key::ShiftRight => expected_modifiers.shift = false,
                        Key::Alt => expected_modifiers.alt = false,
                        Key::ControlLeft | Key::ControlRight => expected_modifiers.ctrl = false,
                        _ => {}
                    }
                }
                
                // Check if modifiers match
                if current_modifiers.cmd == expected_modifiers.cmd &&
                   current_modifiers.shift == expected_modifiers.shift &&
                   current_modifiers.alt == expected_modifiers.alt &&
                   current_modifiers.ctrl == expected_modifiers.ctrl {
                    return Some(RecordingCommand::Start);
                }
            }
            None
        }
        EventType::KeyRelease(ref key) => {
            // For release, we check if the main key is released
            let config_key = parse_key(&config_key_str);
            let key_matches = match config_key {
                Some(k) => {
                    // For modifier keys, match both left and right variants
                    match k {
                        Key::MetaLeft => matches!(key, Key::MetaLeft | Key::MetaRight),
                        Key::MetaRight => matches!(key, Key::MetaLeft | Key::MetaRight),
                        Key::ControlLeft => matches!(key, Key::ControlLeft | Key::ControlRight),
                        Key::ControlRight => matches!(key, Key::ControlLeft | Key::ControlRight),
                        Key::ShiftLeft => matches!(key, Key::ShiftLeft | Key::ShiftRight),
                        Key::ShiftRight => matches!(key, Key::ShiftLeft | Key::ShiftRight),
                        _ => *key == k,
                    }
                },
                None => {
                    key_to_string(key) == config_key_str || 
                    matches!(alt_code, Some(code) if *key == Key::Unknown(code))
                }
            };

            if key_matches {
                // On release, check if modifiers still match (they might be released after)
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
                                // Only add modifiers if they're pressed AND the current key is not that modifier
                                if modifier_state.shift && !matches!(key, Key::ShiftLeft | Key::ShiftRight) {
                                    modifiers.push("Shift".to_string());
                                }
                                if modifier_state.ctrl && !matches!(key, Key::ControlLeft | Key::ControlRight) {
                                    modifiers.push("Control".to_string());
                                }
                                if modifier_state.alt && !matches!(key, Key::Alt) {
                                    modifiers.push("Option".to_string());
                                }
                                if modifier_state.cmd && !matches!(key, Key::MetaLeft | Key::MetaRight) {
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

