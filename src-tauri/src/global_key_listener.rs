use rdev::{listen, Event, EventType};
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

/// Starts the global keyboard listener in a background thread.
/// 
/// This function spawns a separate thread to run `rdev::listen`, which is blocking by design.
/// Only keyboard events (KeyPress and KeyRelease) are captured and emitted to the Tauri frontend
/// via the "global-input" event. Mouse events are ignored.
/// 
/// # Arguments
/// 
/// * `app` - The Tauri AppHandle used to emit events to the frontend
pub fn start_listener(app: AppHandle) {
    std::thread::spawn(move || {
        let callback = move |event: Event| {
            // Only process keyboard events
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

