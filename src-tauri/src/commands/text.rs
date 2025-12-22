//! Text Injection Commands
//!
//! This module provides Tauri commands for injecting text into active applications.

use crate::text_injector::TextInjector;

/// Inject text into the currently active application
/// 
/// This command allows the frontend to directly inject text into any active application.
/// It uses the cross-platform TextInjector implementation which:
/// 1. Copies text to the clipboard
/// 2. Simulates a paste keystroke (Cmd+V on macOS, Ctrl+V elsewhere)
/// 
/// # Arguments
/// * `text` - The text to inject
/// 
/// # Returns
/// * `Ok(())` - Successfully injected the text
/// * `Err(String)` - An error message if injection failed
#[tauri::command]
pub fn inject_text(text: String) -> Result<(), String> {
    let injector = TextInjector::new();
    injector
        .inject_text(&text)
        .map_err(|e| format!("Injection failed: {}", e))
}

