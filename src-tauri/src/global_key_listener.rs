// Global keyboard listener module using rdev
// 
// This module provides global keyboard event monitoring that works system-wide,
// even when the application is not in focus. It listens for Function key (fn)
// press/release events to trigger audio recording start/stop. All keyboard events
// are also emitted to the frontend for debugging purposes.

use rdev::{listen, Event, EventType, Key};
use std::sync::mpsc;
use tauri::{AppHandle, Emitter};

/// Helper to convert keyboard EventType to a string for frontend emission
/// Only handles keyboard events (KeyPress and KeyRelease)
fn event_type_to_string(event_type: &EventType) -> Option<String> {
    match event_type {
        EventType::KeyPress(key) => Some(format!("key_press: {:?}", key)),
        EventType::KeyRelease(key) => Some(format!("key_release: {:?}", key)),
        _ => None, // Ignore mouse events
    }
}

/// Checks if the event is a trigger key press/release
/// Supports both Function key (fn) and Option key (Alt) for recording
/// On some macOS systems, fn key is reported as Unknown(179) instead of Key::Function
fn is_trigger_key_event(event_type: &EventType) -> Option<bool> {
    match event_type {
        // Function key (fn) - primary trigger
        EventType::KeyPress(Key::Function) => Some(true),
        EventType::KeyRelease(Key::Function) => Some(false),
        _ => None, // Not a trigger key we care about
    }
}

/// Starts the global keyboard listener in a background thread.
/// 
/// This function spawns a separate thread to run `rdev::listen`, which is blocking by design.
/// Only keyboard events (KeyPress and KeyRelease) are captured and emitted to the Tauri frontend
/// via the "global-input" event. Mouse events are ignored.
/// 
/// When the Function key (fn) is pressed, it sends `true` through the recording channel to start recording.
/// When the Function key (fn) is released, it sends `false` through the recording channel to stop recording.
/// 
/// Additionally, on every Fn key press/release, it queries cursor context and logs it.
/// 
/// # Arguments
/// 
/// * `app` - The Tauri AppHandle used to emit events to the frontend
/// * `recording_tx` - Channel sender to signal start/stop recording (true = start, false = stop)
pub fn start_listener(app: AppHandle, recording_tx: mpsc::Sender<bool>) {
    std::thread::spawn(move || {
        let callback = move |event: Event| {
            // Check if this is a trigger key event that should trigger recording
            if let Some(should_start) = is_trigger_key_event(&event.event_type) {
                // Log the Fn key trigger
                let trigger_type = if should_start { "PRESSED" } else { "RELEASED" };
                println!("=== FN KEY TRIGGER: {} ===", trigger_type);
                
                // Query and log cursor context on every Fn key event
                crate::cursor_context::log_cursor_context();
                
                println!("Trigger key {} - {} recording", 
                    if should_start { "pressed" } else { "released" },
                    if should_start { "Starting" } else { "Stopping" });
                
                // Send signal to recording thread
                if let Err(e) = recording_tx.send(should_start) {
                    eprintln!("Failed to send recording signal: {:?}", e);
                }
                
                // Emit event to frontend
                let event_name = if should_start { "recording_started" } else { "recording_stopped" };
                if let Err(e) = app.emit(event_name, ()) {
                    eprintln!("Failed to emit {} event: {:?}", event_name, e);
                }
            }
            
            // Also emit all keyboard events to frontend for debugging
            if let Some(event_string) = event_type_to_string(&event.event_type) {
                // Log the keyboard event for debugging
                println!("Keyboard event: {:?}", event);

                // Emit to frontend (listen for "global-input" in JS)
                if let Err(e) = app.emit("global-input", &event_string) {
                    eprintln!("Failed to emit event: {:?}", e);
                }
            }
            // Mouse events are silently ignored
        };

        if let Err(error) = listen(callback) {
            eprintln!("rdev listen error: {:?}", error);
        }
    });
}

