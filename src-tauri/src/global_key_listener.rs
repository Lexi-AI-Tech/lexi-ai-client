// Global keyboard listener module using rdev
// 
// This module provides global keyboard event monitoring that works system-wide,
// even when the application is not in focus. It listens for Function key (fn)
// press/release events to trigger audio recording start/stop. All keyboard events
// are also emitted to the frontend for debugging purposes.

use rdev::{listen, Event, EventType, Key};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use crate::{RecordingCommand, config_store::{ConfigStore, HotkeyConfig}};

#[derive(Debug, Default)]
struct ModifierState {
    shift: bool,
    control: bool,
    alt: bool,
    meta: bool, // Command on macOS, Windows on Windows
    function: bool,
}

impl ModifierState {
    fn update(&mut self, key: Key, pressed: bool) {
        match key {
            Key::ShiftLeft | Key::ShiftRight => self.shift = pressed,
            Key::ControlLeft | Key::ControlRight => self.control = pressed,
            Key::Alt | Key::AltGr => self.alt = pressed,
            Key::MetaLeft | Key::MetaRight => self.meta = pressed,
            Key::Function => self.function = pressed,
            // Handle undetermined/unknown keys that might be Fn on some macs
            Key::Unknown(179) => self.function = pressed,
            _ => {}
        }
    }
}

fn key_from_string(s: &str) -> Option<Key> {
    match s {
        "Function" => Some(Key::Function),
        "Space" => Some(Key::Space),
        "Enter" => Some(Key::Return),
        // F-keys
        "F1" => Some(Key::F1), "F2" => Some(Key::F2), "F3" => Some(Key::F3),
        "F4" => Some(Key::F4), "F5" => Some(Key::F5), "F6" => Some(Key::F6),
        "F7" => Some(Key::F7), "F8" => Some(Key::F8), "F9" => Some(Key::F9),
        "F10" => Some(Key::F10), "F11" => Some(Key::F11), "F12" => Some(Key::F12),
        // Digits
        "0" => Some(Key::Num0), "1" => Some(Key::Num1), "2" => Some(Key::Num2),
        "3" => Some(Key::Num3), "4" => Some(Key::Num4), "5" => Some(Key::Num5),
        "6" => Some(Key::Num6), "7" => Some(Key::Num7), "8" => Some(Key::Num8), "9" => Some(Key::Num9),
        // Letters (Approximate. rdev Key::KeyA etc)
        "A" => Some(Key::KeyA), "B" => Some(Key::KeyB), "C" => Some(Key::KeyC),
        "D" => Some(Key::KeyD), "E" => Some(Key::KeyE), "F" => Some(Key::KeyF),
        "G" => Some(Key::KeyG), "H" => Some(Key::KeyH), "I" => Some(Key::KeyI),
        "J" => Some(Key::KeyJ), "K" => Some(Key::KeyK), "L" => Some(Key::KeyL),
        "M" => Some(Key::KeyM), "N" => Some(Key::KeyN), "O" => Some(Key::KeyO),
        "P" => Some(Key::KeyP), "Q" => Some(Key::KeyQ), "R" => Some(Key::KeyR),
        "S" => Some(Key::KeyS), "T" => Some(Key::KeyT), "U" => Some(Key::KeyU),
        "V" => Some(Key::KeyV), "W" => Some(Key::KeyW), "X" => Some(Key::KeyX),
        "Y" => Some(Key::KeyY), "Z" => Some(Key::KeyZ),
        // Special
        "Escape" => Some(Key::Escape),
        "Tab" => Some(Key::Tab),
        "Backspace" => Some(Key::Backspace),
        _ => None,
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

/// Checks if the event matches the configured hotkey
fn is_trigger(
    event_type: &EventType, 
    modifiers: &ModifierState, 
    config: &HotkeyConfig
) -> Option<RecordingCommand> {
    let (key, pressed) = match event_type {
        EventType::KeyPress(k) => (k, true),
        EventType::KeyRelease(k) => (k, false),
        _ => return None,
    };

    // Parse config key
    // For "Function", we special case it to match either Key::Function or Unknown(179)
    let config_key_is_fn = config.key == "Function";

    // Check if the current key matches the config key
    let key_matches = if config_key_is_fn {
        match key {
            Key::Function | Key::Unknown(179) => true,
            _ => false,
        }
    } else {
        key_from_string(&config.key).map_or(false, |k| k == *key)
    };

    if !key_matches {
        return None;
    }

    // Check modifiers
    // Note: If the trigger key is ITSELF a modifier (like Fn), we don't check other modifiers strictly unless requested?
    // Actually, normally "Fn" doesn't have modifiers.
    // But if hotkey is "Cmd+Shift+P", we check modifiers.
    
    // Check if all required modifiers are pressed
    let mut modifiers_match = true;
    for req_mod in &config.modifiers {
        match req_mod.as_str() {
            "Command" | "Cmd" => if !modifiers.meta { modifiers_match = false; },
            "Control" | "Ctrl" => if !modifiers.control { modifiers_match = false; },
            "Alt" | "Option" => if !modifiers.alt { modifiers_match = false; },
            "Shift" => if !modifiers.shift { modifiers_match = false; },
            "Function" | "Fn" => if !modifiers.function { modifiers_match = false; }, // Rare to use Fn as modifier for other keys in Config, but possible
            _ => {}
        }
    }

    if modifiers_match {
        if pressed {
            Some(RecordingCommand::Start)
        } else {
            Some(RecordingCommand::Stop)
        }
    } else {
        None
    }
}

/// Starts the global keyboard listener in a background thread.
/// 
/// This function spawns a separate thread to run `rdev::listen`, which is blocking by design.
/// Only keyboard events (KeyPress and KeyRelease) are captured and emitted to the Tauri frontend
/// via the "global-input" event. Mouse events are ignored.
/// 
/// When the Function key (fn) is pressed, it sends `RecordingCommand::Start` through the recording channel to start recording.
/// When the Function key (fn) is released, it sends `RecordingCommand::Stop` through the recording channel to stop recording.
/// 
/// Additionally, on every Fn key press/release, it queries cursor context and logs it.
/// 
/// # Arguments
/// 
/// * `app` - The Tauri AppHandle used to emit events to the frontend
/// * `recording_tx` - Channel sender to signal start/stop recording
pub fn start_listener(
    app: AppHandle, 
    recording_tx: mpsc::Sender<RecordingCommand>
) {
    let app_handle = app.clone();
    
    std::thread::spawn(move || {
        // Debounce mechanism to prevent race conditions on rapid key presses
        // Ignore trigger events that occur within 50ms of the previous trigger
        let debounce_time = Arc::new(Mutex::new(Instant::now()));
        let debounce_duration = Duration::from_millis(50);
        
        // Track modifier state
        let mut modifier_state = ModifierState::default();

        let callback = move |event: Event| {
            // Update modifier state
            if let EventType::KeyPress(key) = event.event_type {
                modifier_state.update(key, true);
            } else if let EventType::KeyRelease(key) = event.event_type {
                modifier_state.update(key, false);
            }

            // Get current hotkey config
            // We access the state every time. Since it's a Mutex, this is thread-safe.
            // In a high-perf scenario we might want to cache this, but for typing speed it's negligible.
            let config_store = app_handle.state::<ConfigStore>();
            let hotkey_config = config_store.get_hotkey();

            // Check if this is a trigger key event that should trigger recording
            if let Some(command) = is_trigger(&event.event_type, &modifier_state, &hotkey_config) {
                // Check debounce: ignore events that are too close together
                let mut last_trigger = debounce_time.lock().unwrap();
                if last_trigger.elapsed() < debounce_duration {
                    // Event too soon after previous trigger, ignore it
                    return;
                }
                *last_trigger = Instant::now();
                drop(last_trigger); // Release lock early
                
                // Log the trigger
                let trigger_type = match command {
                    RecordingCommand::Start => "PRESSED",
                    RecordingCommand::Stop => "RELEASED",
                };
                println!("=== HOTKEY TRIGGER: {} ({:?} + {}) ===", 
                    trigger_type, 
                    hotkey_config.modifiers, 
                    hotkey_config.key
                );
                
                // Query and log cursor context on every Fn key event
                crate::cursor_context::log_cursor_context();
                
                println!("Trigger key {} - {} recording", 
                    match command {
                        RecordingCommand::Start => "pressed",
                        RecordingCommand::Stop => "released",
                    },
                    match command {
                        RecordingCommand::Start => "Starting",
                        RecordingCommand::Stop => "Stopping",
                    });
                
                // Send signal to recording thread
                if let Err(e) = recording_tx.send(command) {
                    eprintln!("Failed to send recording signal: {:?}", e);
                }
                
                // Emit event to frontend
                let event_name = match command {
                    RecordingCommand::Start => "recording_started",
                    RecordingCommand::Stop => "recording_stopped",
                };
                if let Err(e) = app.emit(event_name, ()) {
                    eprintln!("Failed to emit {} event: {:?}", event_name, e);
                }
            }
            
            // Emit all keyboard events to react frontend
            if let Some(event_string) = event_type_to_string(&event.event_type) {
                // Log the keyboard event for debugging
                println!("Keyboard event: {:?}", event);

                // Emit to frontend (listen for "global-input" in JS)
                if let Err(e) = app.emit("global-input", &event_string) {
                    eprintln!("Failed to emit event: {:?}", e);
                }
            }
        };

        if let Err(error) = listen(callback) {
            eprintln!("rdev listen error: {:?}", error);
        }
    });
}

