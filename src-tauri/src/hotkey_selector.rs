// Hotkey selector module
//
// This module handles hotkey selection/recording for the settings UI.
// It listens for keyboard events when in recording mode and emits them
// to the frontend so users can select hotkeys including special keys like Fn.

use rdev::{listen, Event, EventType, Key};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

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

/// Converts a Key to a string representation for the frontend
fn key_to_string(key: &Key) -> String {
    match key {
        Key::Function => "Function".to_string(),
        Key::Space => "Space".to_string(),
        Key::Return => "Enter".to_string(),
        Key::Escape => "Escape".to_string(),
        Key::Tab => "Tab".to_string(),
        Key::Backspace => "Backspace".to_string(),
        Key::F1 => "F1".to_string(),
        Key::F2 => "F2".to_string(),
        Key::F3 => "F3".to_string(),
        Key::F4 => "F4".to_string(),
        Key::F5 => "F5".to_string(),
        Key::F6 => "F6".to_string(),
        Key::F7 => "F7".to_string(),
        Key::F8 => "F8".to_string(),
        Key::F9 => "F9".to_string(),
        Key::F10 => "F10".to_string(),
        Key::F11 => "F11".to_string(),
        Key::F12 => "F12".to_string(),
        Key::Num0 => "0".to_string(),
        Key::Num1 => "1".to_string(),
        Key::Num2 => "2".to_string(),
        Key::Num3 => "3".to_string(),
        Key::Num4 => "4".to_string(),
        Key::Num5 => "5".to_string(),
        Key::Num6 => "6".to_string(),
        Key::Num7 => "7".to_string(),
        Key::Num8 => "8".to_string(),
        Key::Num9 => "9".to_string(),
        Key::KeyA => "A".to_string(),
        Key::KeyB => "B".to_string(),
        Key::KeyC => "C".to_string(),
        Key::KeyD => "D".to_string(),
        Key::KeyE => "E".to_string(),
        Key::KeyF => "F".to_string(),
        Key::KeyG => "G".to_string(),
        Key::KeyH => "H".to_string(),
        Key::KeyI => "I".to_string(),
        Key::KeyJ => "J".to_string(),
        Key::KeyK => "K".to_string(),
        Key::KeyL => "L".to_string(),
        Key::KeyM => "M".to_string(),
        Key::KeyN => "N".to_string(),
        Key::KeyO => "O".to_string(),
        Key::KeyP => "P".to_string(),
        Key::KeyQ => "Q".to_string(),
        Key::KeyR => "R".to_string(),
        Key::KeyS => "S".to_string(),
        Key::KeyT => "T".to_string(),
        Key::KeyU => "U".to_string(),
        Key::KeyV => "V".to_string(),
        Key::KeyW => "W".to_string(),
        Key::KeyX => "X".to_string(),
        Key::KeyY => "Y".to_string(),
        Key::KeyZ => "Z".to_string(),
        Key::MetaLeft | Key::MetaRight => "Command".to_string(),
        Key::ControlLeft | Key::ControlRight => "Control".to_string(),
        Key::Alt | Key::AltGr => "Option".to_string(),
        Key::ShiftLeft | Key::ShiftRight => "Shift".to_string(),
        Key::Unknown(179) => "Function".to_string(), // Fn key on some Macs
        _ => format!("{:?}", key),
    }
}

/// Starts the hotkey selector listener in a background thread.
/// 
/// This function spawns a separate thread to run `rdev::listen`, which is blocking by design.
/// When in recording mode (controlled by `recording_state`), it captures keyboard events
/// and emits them to the frontend via the "hotkey-recorded" event.
/// 
/// This allows the UI to detect special keys like Fn that aren't accessible via browser APIs.
/// 
/// Note: The thread will continue running even when not in recording mode, but it only
/// processes and emits events when `recording_state` is true. This is because `rdev::listen`
/// is a blocking call that cannot be easily stopped.
/// 
/// # Arguments
/// 
/// * `app` - The Tauri AppHandle used to emit events to the frontend
/// * `recording_state` - Shared state to check if we're in hotkey recording mode
/// 
/// # Returns
/// 
/// * `JoinHandle<()>` - Handle to the spawned thread
pub fn start_selector_listener(
    app: AppHandle,
    recording_state: Arc<Mutex<bool>>
) -> std::thread::JoinHandle<()> {
    let app_handle = app.clone();
    
    std::thread::spawn(move || {
        // Track modifier state
        let mut modifier_state = ModifierState::default();

        let callback = move |event: Event| {
            // Update modifier state first
            if let EventType::KeyPress(key) = event.event_type {
                modifier_state.update(key, true);
            } else if let EventType::KeyRelease(key) = event.event_type {
                modifier_state.update(key, false);
            }
            
            // Check if we're in hotkey recording mode
            let is_recording = recording_state.lock().map(|guard| *guard).unwrap_or_else(|_| {
                eprintln!("Failed to lock recording state");
                false
            });
            
            // If in recording mode, emit key events to frontend
            if is_recording {
                if let EventType::KeyPress(key) = event.event_type {
                    let key_str = key_to_string(&key);
                    
                    // Build modifiers list, excluding the current key if it's a modifier
                    let mut modifiers = Vec::new();
                    if modifier_state.shift && key_str != "Shift" {
                        modifiers.push("Shift".to_string());
                    }
                    if modifier_state.control && key_str != "Control" {
                        modifiers.push("Control".to_string());
                    }
                    if modifier_state.alt && key_str != "Option" {
                        modifiers.push("Option".to_string());
                    }
                    if modifier_state.meta && key_str != "Command" {
                        modifiers.push("Command".to_string());
                    }
                    if modifier_state.function && key_str != "Function" {
                        modifiers.push("Function".to_string());
                    }
                    
                    // Emit hotkey recording event
                    let _ = app_handle.emit("hotkey-recorded", serde_json::json!({
                        "key": key_str,
                        "modifiers": modifiers
                    }));
                }
            }
        };

        if let Err(error) = listen(callback) {
            eprintln!("rdev listen error in hotkey selector: {:?}", error);
        }
    })
}

