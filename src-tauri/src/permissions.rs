use tauri::AppHandle;

use crate::audio_recorder::AudioRecorder;

/// Check microphone permission on macOS
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn check_microphone_permission() -> Result<bool, String> {
    // On macOS, we can check microphone permission by trying to access it
    // This is a simplified check - in production you might want to use
    // AVFoundation APIs for a more accurate check
    
    // Try to check using system_profiler or just return true if we can create a recorder
    // For now, we'll attempt to create a recorder as a check
    match std::panic::catch_unwind(|| {
        let _recorder = AudioRecorder::new();
        true
    }) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Check microphone permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn check_microphone_permission() -> Result<bool, String> {
    Ok(true)
}

/// Check Input Monitoring permission on macOS
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn check_input_monitoring_permission(_app: AppHandle) -> Result<bool, String> {
    // Input Monitoring permission is tricky to check directly
    // We'll try to start a test listener and see if it works
    // In practice, if the permission is granted, rdev::listen will work
    // This is a simplified check
    Ok(true) // For now, assume it's granted if the app is running
}

/// Check Input Monitoring permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn check_input_monitoring_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}

/// Check Accessibility permission on macOS
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn check_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    use std::process::Command;
    
    // Check if we can access System Events (which requires Accessibility permission)
    let script = r#"
        tell application "System Events"
            try
                get name of every process
                return true
            on error
                return false
            end try
        end tell
    "#;
    
    match Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
    {
        Ok(output) => {
            let result = String::from_utf8_lossy(&output.stdout);
            let trimmed = result.trim();
            Ok(trimmed == "true")
        }
        Err(_) => Ok(false),
    }
}

/// Check Accessibility permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn check_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}

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

