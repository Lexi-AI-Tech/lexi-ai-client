//! Keyboard Simulator Module
//!
//! This module provides cross-platform keyboard simulation functionality for common
//! keyboard shortcuts like copy (Cmd+C/Ctrl+C) and paste (Cmd+V/Ctrl+V).
//!
//! ## Implementation
//!
//! - **macOS**: Uses AppleScript via `osascript` to simulate keyboard events
//! - **Windows/Linux**: Uses `enigo` library for cross-platform keyboard event simulation
//!
//! ## Permissions Required
//!
//! - **Accessibility** (macOS): Required for AppleScript keyboard simulation
//! - **Windows**: Usually works without extra permissions
//! - **Linux**: Needs X11 (enigo's Wayland support is experimental)

use std::error::Error;
use std::process::Command;

#[cfg(not(target_os = "macos"))]
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
#[cfg(not(target_os = "macos"))]
use std::thread;
#[cfg(not(target_os = "macos"))]
use std::time::Duration;

/// Simulate copy command (Cmd+C on macOS, Ctrl+C on Windows/Linux)
///
/// This function simulates the copy keyboard shortcut to copy selected text
/// to the clipboard. It works across all applications.
///
/// # Returns
/// * `Ok(())` - Successfully simulated the copy command
/// * `Err(Box<dyn Error>)` - An error if the simulation fails
///
/// # Platform-specific behavior
/// * **macOS**: Uses AppleScript to simulate Cmd+C
/// * **Windows/Linux**: Uses enigo to simulate Ctrl+C
pub fn simulate_copy() -> Result<(), Box<dyn Error + Send + Sync>> {
    #[cfg(target_os = "macos")]
    {
        copy_with_applescript()
    }
    #[cfg(not(target_os = "macos"))]
    {
        copy_with_enigo()
    }
}

/// Simulate paste command (Cmd+V on macOS, Ctrl+V on Windows/Linux)
///
/// This function simulates the paste keyboard shortcut to paste text from
/// the clipboard. It works across all applications.
///
/// # Returns
/// * `Ok(())` - Successfully simulated the paste command
/// * `Err(Box<dyn Error>)` - An error if the simulation fails
///
/// # Platform-specific behavior
/// * **macOS**: Uses AppleScript to simulate Cmd+V
/// * **Windows/Linux**: Uses enigo to simulate Ctrl+V
pub fn simulate_paste() -> Result<(), Box<dyn Error + Send + Sync>> {
    #[cfg(target_os = "macos")]
    {
        paste_with_applescript()
    }
    #[cfg(not(target_os = "macos"))]
    {
        paste_with_enigo()
    }
}

/// Simulate Cmd+C using AppleScript on macOS
#[cfg(target_os = "macos")]
fn copy_with_applescript() -> Result<(), Box<dyn Error + Send + Sync>> {
    let applescript = r#"
        tell application "System Events"
            keystroke "c" using {command down}
        end tell
    "#;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(applescript)
        .output()
        .map_err(|e| format!("Failed to run AppleScript: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let error = String::from_utf8_lossy(&output.stderr);
        Err(format!("AppleScript failed: {}", error).into())
    }
}

/// Simulate Ctrl+C using enigo on Windows/Linux
#[cfg(not(target_os = "macos"))]
fn copy_with_enigo() -> Result<(), Box<dyn Error + Send + Sync>> {
    let settings = Settings::default();
    let mut enigo =
        Enigo::new(&settings).map_err(|e| format!("Failed to initialize enigo: {:?}", e))?;

    // Press Control key
    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| format!("Failed to press Control key: {:?}", e))?;
    thread::sleep(Duration::from_millis(20));

    // Press C key
    enigo
        .key(Key::Unicode('c'), Direction::Click)
        .map_err(|e| format!("Failed to click C key: {:?}", e))?;
    thread::sleep(Duration::from_millis(20));

    // Release Control key
    enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| format!("Failed to release Control key: {:?}", e))?;

    Ok(())
}

/// Simulate Cmd+V using AppleScript on macOS
#[cfg(target_os = "macos")]
fn paste_with_applescript() -> Result<(), Box<dyn Error + Send + Sync>> {
    let applescript = r#"
        tell application "System Events"
            keystroke "v" using {command down}
        end tell
    "#;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(applescript)
        .output()
        .map_err(|e| format!("Failed to run AppleScript: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let error = String::from_utf8_lossy(&output.stderr);
        Err(format!("AppleScript failed: {}", error).into())
    }
}

/// Simulate Ctrl+V using enigo on Windows/Linux
#[cfg(not(target_os = "macos"))]
fn paste_with_enigo() -> Result<(), Box<dyn Error + Send + Sync>> {
    let settings = Settings::default();
    let mut enigo =
        Enigo::new(&settings).map_err(|e| format!("Failed to initialize enigo: {:?}", e))?;

    // Press Control key
    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| format!("Failed to press Control key: {:?}", e))?;
    thread::sleep(Duration::from_millis(20));

    // Press V key
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| format!("Failed to click V key: {:?}", e))?;
    thread::sleep(Duration::from_millis(20));

    // Release Control key
    enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| format!("Failed to release Control key: {:?}", e))?;

    Ok(())
}

