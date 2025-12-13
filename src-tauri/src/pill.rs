// Pill window management module
// 
// This module handles the creation, positioning, and display of the pill overlay window.
// The pill window is a small transparent overlay that displays the current recording status.

use tauri::{AppHandle, Manager, LogicalPosition};

/// Initialize and position the pill overlay window at the center of the primary monitor
/// 
/// This function positions the pill window at the center of the screen before showing it,
/// preventing any visible repositioning. The window is pre-configured in tauri.conf.json.
/// 
/// # Arguments
/// * `app` - The Tauri app handle
/// 
/// # Returns
/// * `Ok(())` - Successfully positioned and showed the window
/// * `Err(String)` - An error message if the operation failed
pub fn init_pill_window(app: AppHandle) -> Result<(), String> {
    if let Some(pill_window) = app.get_webview_window("pill") {
        // Get the monitor to calculate center position
        // Try window's monitor first, fallback to primary monitor
        let monitor = match pill_window.current_monitor() {
            Ok(Some(monitor)) => monitor,
            Ok(None) | Err(_) => {
                // Fallback to primary monitor
                app.primary_monitor()
                    .map_err(|e| format!("Failed to get primary monitor: {}", e))?
                    .ok_or_else(|| "No monitor found".to_string())?
            }
        };
        
        let monitor_size = monitor.size();
        let scale_factor = monitor.scale_factor();
        
        // Convert monitor size to logical pixels (accounting for scale factor)
        let monitor_width = monitor_size.width as f64 / scale_factor;
        let monitor_height = monitor_size.height as f64 / scale_factor;
        
        // Pill window dimensions (from config: 200x50)
        let pill_width = 200.0;
        let pill_height = 50.0;
        
        // Calculate center position
        let x = (monitor_width - pill_width) / 2.0;
        let y = (monitor_height - pill_height) / 2.0;
        
        // Position the window first (while it's still hidden)
        pill_window
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| format!("Failed to position pill window: {}", e))?;
        
        // Then show it (now it appears in the correct position)
        pill_window
            .show()
            .map_err(|e| format!("Failed to show pill window: {}", e))?;
        
        Ok(())
    } else {
        Err("Pill window not found".to_string())
    }
}

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
        // Position first, then show to avoid visible repositioning
        pill_window
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| format!("Failed to position pill window: {}", e))?;
        
        pill_window
            .show()
            .map_err(|e| format!("Failed to show pill window: {}", e))?;
        
        // Note: In Tauri v2, we can't prevent focus directly, but the window
        // is configured with focus: false in the config, so it shouldn't steal focus
        Ok(())
    } else {
        Err("Pill window not found".to_string())
    }
}

