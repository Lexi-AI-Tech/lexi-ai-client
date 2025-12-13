use tauri::AppHandle;

use crate::audio_recorder::AudioRecorder;

/// Request microphone permission on macOS
/// This will trigger the system permission dialog by attempting to access the microphone
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn request_microphone_permission() -> Result<bool, String> {
    use std::thread;
    use std::time::Duration;
    
    // Spawn a thread to attempt microphone access, which triggers the permission dialog
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(100));
        
        // Try to create an audio recorder, which will trigger the permission dialog
        // We do this in a separate thread to avoid blocking
        // If permission is denied, this will fail, but that's okay - we just want to trigger the dialog
        let _ = std::panic::catch_unwind(|| {
            let _recorder = AudioRecorder::new();
            println!("Microphone permission dialog should have appeared");
        });
    });
    
    // Return immediately - the permission dialog will appear asynchronously
    Ok(true)
}

/// Request microphone permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn request_microphone_permission() -> Result<bool, String> {
    Ok(true)
}

/// Request Input Monitoring permission on macOS
/// This will trigger the system permission dialog by attempting to use rdev::listen
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn request_input_monitoring_permission(_app: AppHandle) -> Result<bool, String> {
    use std::thread;
    use std::time::Duration;
    use rdev::{listen, Event};
    
    // Spawn a thread to attempt starting a test listener, which triggers the permission dialog
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(100));
        
        // Try to start a test listener, which will trigger Input Monitoring permission dialog
        // We do this in a separate thread to avoid blocking
        let _ = std::panic::catch_unwind(|| {
            let _ = listen(move |_event: Event| {
                // Empty callback - we just want to trigger the permission dialog
            });
            println!("Input Monitoring permission dialog should have appeared");
        });
    });
    
    // Return immediately - the permission dialog will appear asynchronously
    Ok(true)
}

/// Request Input Monitoring permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn request_input_monitoring_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}

/// Request Accessibility permission on macOS
/// This is required for pasting text via AppleScript/System Events
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn request_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    use std::process::Command;
    use std::thread;
    use std::time::Duration;
    
    // Spawn a thread to attempt using System Events, which triggers the permission dialog
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(100));
        
        // Try to run a simple AppleScript that uses System Events
        // This will trigger the Accessibility permission dialog
        // We use a harmless command that just checks if we can access System Events
        let script = r#"
            tell application "System Events"
                -- Just check if we can access System Events (triggers permission dialog)
                get name of every process
            end tell
        "#;
        
        let _ = std::panic::catch_unwind(|| {
            let _ = Command::new("osascript")
                .arg("-e")
                .arg(script)
                .output();
            println!("Accessibility permission dialog should have appeared");
        });
    });
    
    // Return immediately - the permission dialog will appear asynchronously
    Ok(true)
}

/// Request Accessibility permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn request_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}

