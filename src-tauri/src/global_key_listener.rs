// Global keyboard listener module using rdev
// 
// This module provides global keyboard event monitoring that works system-wide,
// even when the application is not in focus. It listens for Function key (fn)
// press/release events to trigger audio recording start/stop. All keyboard events
// are also emitted to the frontend for debugging purposes.

use rdev::{listen, Event, EventType, Key};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use crate::RecordingCommand;

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
/// Supports Function key (fn) for recording
/// On some macOS systems, fn key is reported as Unknown(179) instead of Key::Function
fn is_trigger_key_event(event_type: &EventType) -> Option<RecordingCommand> {
    match event_type {
        // Function key (fn) - primary trigger (standard variant)
        EventType::KeyPress(Key::Function) => Some(RecordingCommand::Start),
        EventType::KeyRelease(Key::Function) => Some(RecordingCommand::Stop),
        // Function key (fn) - alternative variant for some macOS systems
        EventType::KeyPress(Key::Unknown(179)) => Some(RecordingCommand::Start),
        EventType::KeyRelease(Key::Unknown(179)) => Some(RecordingCommand::Stop),
        _ => None, // Not a trigger key we care about
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
pub fn start_listener(app: AppHandle, recording_tx: mpsc::Sender<RecordingCommand>) {
    std::thread::spawn(move || {
        // Debounce mechanism to prevent race conditions on rapid key presses
        // Ignore trigger events that occur within 50ms of the previous trigger
        let debounce_time = Arc::new(Mutex::new(Instant::now()));
        let debounce_duration = Duration::from_millis(50);
        
        let callback = move |event: Event| {
            // Check if this is a trigger key event that should trigger recording
            if let Some(command) = is_trigger_key_event(&event.event_type) {
                // Check debounce: ignore events that are too close together
                let mut last_trigger = debounce_time.lock().unwrap();
                if last_trigger.elapsed() < debounce_duration {
                    // Event too soon after previous trigger, ignore it
                    return;
                }
                *last_trigger = Instant::now();
                drop(last_trigger); // Release lock early
                
                // Log the Fn key trigger
                let trigger_type = match command {
                    RecordingCommand::Start => "PRESSED",
                    RecordingCommand::Stop => "RELEASED",
                };
                println!("=== FN KEY TRIGGER: {} ===", trigger_type);
                
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

