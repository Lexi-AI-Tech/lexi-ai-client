//! Utility Commands
//!
//! This module provides Tauri commands for utility functions that can be called from the frontend.

use crate::utils;
use arboard::Clipboard;

/// Get the current system type as a string
///
/// Returns "mac" for macOS, "windows" for Windows.
/// This uses compile-time platform detection, which is more reliable than user agent parsing.
///
#[tauri::command]
pub fn get_system_type() -> &'static str {
    utils::get_system_type()
}

/// Copy text to the system clipboard
///
/// This function uses the `arboard` crate to access the system clipboard
/// reliably across platforms.
///
/// # Arguments
/// * `text` - The text to copy to the clipboard
///
/// # Returns
/// * `Ok(())` - Successfully copied to clipboard
/// * `Err(String)` - Error message if copy failed
#[tauri::command]
pub fn copy_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard =
        Clipboard::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;
    clipboard
        .set_text(text)
        .map_err(|e| format!("Failed to set clipboard text: {}", e))?;
    Ok(())
}
