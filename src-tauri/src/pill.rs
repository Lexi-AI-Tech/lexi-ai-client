// Pill window management module
// 
// This module handles the creation, positioning, and display of the pill overlay window.
// The pill window is a small transparent overlay that displays the current recording status.

use tauri::{AppHandle, Manager, LogicalPosition};

/// Show and position the pill overlay window
/// 
/// This command shows the pill window (if it exists) and positions it at the specified coordinates.
/// The pill window is pre-configured in tauri.conf.json.
/// 
/// # Arguments
/// * `app` - The Tauri app handle
/// * `x` - The x coordinate for the window position
/// * `y` - The y coordinate for the window position
/// 
/// # Returns
/// * `Ok(())` - Successfully showed and positioned the window
/// * `Err(String)` - An error message if the operation failed
pub fn show_pill_window(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    if let Some(pill_window) = app.get_webview_window("pill") {
        pill_window
            .show()
            .map_err(|e| format!("Failed to show pill window: {}", e))?;
        
        pill_window
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| format!("Failed to position pill window: {}", e))?;
        
        // Note: In Tauri v2, we can't prevent focus directly, but the window
        // is configured with focus: false in the config, so it shouldn't steal focus
        Ok(())
    } else {
        Err("Pill window not found".to_string())
    }
}

