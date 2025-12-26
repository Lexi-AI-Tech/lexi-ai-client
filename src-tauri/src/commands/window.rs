//! Window Management Commands
//!
//! This module provides Tauri commands for managing application windows.

use tauri::{AppHandle, Manager};

/// Open DevTools for the specified window
///
/// This command allows the frontend to open the web inspector (DevTools) for debugging.
/// It can open DevTools on the main window or any other window by label.
///
/// # Arguments
/// * `window_label` - Optional window label (defaults to "main" if not provided)
///
/// # Returns
/// * `Ok(())` - Successfully opened DevTools
/// * `Err(String)` - An error message if the window was not found
#[tauri::command]
pub fn open_devtools(app: AppHandle, window_label: Option<String>) -> Result<(), String> {
    let label = window_label.as_deref().unwrap_or("main");

    if let Some(window) = app.get_webview_window(label) {
        window.open_devtools();
        println!("🔧 DevTools opened for window: {}", label);
        Ok(())
    } else {
        let available_windows: Vec<String> = app
            .webview_windows()
            .keys()
            .map(|k| k.to_string())
            .collect();
        Err(format!(
            "Window '{}' not found. Available windows: {:?}",
            label, available_windows
        ))
    }
}
