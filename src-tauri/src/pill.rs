// Pill window management module
// 
// This module handles the creation, positioning, and display of the pill overlay window.
// The pill window is a small transparent overlay that displays the current recording status.
// The window is created dynamically in Rust rather than from the config file for better control.

use tauri::{AppHandle, Manager, LogicalPosition, WebviewUrl, WebviewWindowBuilder};

/// Calculate the center position of the primary monitor
/// 
/// Returns the (x, y) coordinates for centering the pill window
fn calculate_center_position(app: &AppHandle) -> Result<(f64, f64), String> {
    let monitor = app
        .primary_monitor()
        .map_err(|e| format!("Failed to get primary monitor: {}", e))?
        .ok_or_else(|| "No monitor found".to_string())?;
    
    let monitor_size = monitor.size();
    let scale_factor = monitor.scale_factor();
    
    // Convert monitor size to logical pixels (accounting for scale factor)
    let monitor_width = monitor_size.width as f64 / scale_factor;
    let monitor_height = monitor_size.height as f64 / scale_factor;
    
    // Pill window dimensions
    let pill_width = 200.0;
    let pill_height = 50.0;
    
    // Calculate center position
    let x = (monitor_width - pill_width) / 2.0;
    let y = (monitor_height - pill_height) / 2.0;
    
    Ok((x, y))
}

/// Create the pill overlay window dynamically
/// 
/// This function creates the pill window with all necessary properties.
/// The window is created on-demand rather than at app startup.
/// 
/// # Arguments
/// * `app` - The Tauri app handle
/// 
/// # Returns
/// * `Ok(())` - Successfully created and positioned the window
/// * `Err(String)` - An error message if the operation failed
fn create_pill_window(app: &AppHandle) -> Result<(), String> {
    // Calculate center position
    let (position_x, position_y) = calculate_center_position(app)?;
    
    // Pill window dimensions
    let pill_width = 200.0;
    let pill_height = 50.0;
    
    // Create the window builder
    let pill_builder = WebviewWindowBuilder::new(
        app,
        "pill",
        WebviewUrl::App("screens/pill.html".into()),
    )
    .title("Pill")
    .inner_size(pill_width, pill_height)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .position(position_x, position_y)
    .visible(false) // Start hidden, will be shown when needed
    .focused(false); // Don't steal focus
    
    // Build the window
    let pill_window = pill_builder
        .build()
        .map_err(|e| format!("Failed to create pill window: {}", e))?;
    
    // CRITICAL: Set visible on all workspaces immediately after creation
    // This is the most reliable place to set permanent window behavior.
    // Setting it before the window is shown ensures the OS window manager
    // applies the property correctly, especially on macOS.
    pill_window
        .set_visible_on_all_workspaces(true)
        .map_err(|e| format!("Failed to set visible on all workspaces: {}", e))?;

    // Also ensure always on top is set immediately after creation
    // This ensures the property is applied before the window is shown
    pill_window
        .set_always_on_top(true)
        .map_err(|e| format!("Failed to set always on top: {}", e))?;
    
    println!("Pill window created successfully at ({}, {})", position_x, position_y);
    
    Ok(())
}

/// Ensure the pill window exists, creating it if necessary
/// 
/// This function checks if the pill window exists, and creates it if it doesn't.
/// 
/// # Arguments
/// * `app` - The Tauri app handle
/// 
/// # Returns
/// * `Ok(())` - Window exists or was successfully created
/// * `Err(String)` - An error message if the operation failed
fn ensure_pill_window_exists(app: &AppHandle) -> Result<(), String> {
    // Check if window already exists
    if let Some(pill_window) = app.get_webview_window("pill") {
        // Verify the window is still valid
        if pill_window.is_closable().is_ok() {
            return Ok(());
        }
    }
    
    // Window doesn't exist or is invalid, create it
    create_pill_window(app)
}

/// Initialize and position the pill overlay window at the center of the primary monitor
/// 
/// This function ensures the pill window exists and positions it at the center of the screen.
/// The window is created dynamically if it doesn't exist.
/// Permanent window properties (visible_on_all_workspaces, always_on_top) are set
/// during window creation in create_pill_window, so we only need to handle positioning and visibility here.
/// 
/// # Arguments
/// * `app` - The Tauri app handle
/// 
/// # Returns
/// * `Ok(())` - Successfully positioned and showed the window
/// * `Err(String)` - An error message if the operation failed
pub fn init_pill_window(app: AppHandle) -> Result<(), String> {
    // 1. Ensure the window exists (creates it with all floating properties)
    ensure_pill_window_exists(&app)?;
    
    if let Some(pill_window) = app.get_webview_window("pill") {
        // 2. Position at center
        let (x, y) = calculate_center_position(&app)?;
        pill_window
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| format!("Failed to position pill window: {}", e))?;
        
        // 3. Show the window at startup
        // Permanent properties (visible_on_all_workspaces, always_on_top) are already
        // set during window creation in create_pill_window, so no need to set them again
        pill_window
            .show()
            .map_err(|e| format!("Failed to show pill window: {}", e))?;
        
        Ok(())
    } else {
        Err("Pill window not found after creation".to_string())
    }
}

/// Show and position the pill overlay window
/// 
/// This command shows the pill window (creating it if necessary) and positions it at the specified coordinates.
/// Permanent window properties are set during creation, so we only handle positioning and visibility here.
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
    // Ensure the window exists (this sets permanent properties during creation)
    ensure_pill_window_exists(&app)?;
    
    if let Some(pill_window) = app.get_webview_window("pill") {
        // Position first, then show to avoid visible repositioning
        pill_window
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| format!("Failed to position pill window: {}", e))?;
        
        pill_window
            .show()
            .map_err(|e| format!("Failed to show pill window: {}", e))?;
        
        // No need to call set_visible_on_all_workspaces/set_always_on_top here
        // as they are handled in create_pill_window during window creation
        
        Ok(())
    } else {
        Err("Pill window not found after creation".to_string())
    }
}

/// Toggle the pill window (show if hidden, hide if shown)
/// 
/// This command creates the pill window if it doesn't exist, or toggles its visibility.
/// 
/// # Arguments
/// * `app` - The Tauri app handle
/// 
/// # Returns
/// * `Ok(())` - Successfully toggled the window
/// * `Err(String)` - An error message if the operation failed
pub fn toggle_pill_window(app: AppHandle) -> Result<(), String> {
    // Ensure the window exists
    ensure_pill_window_exists(&app)?;
    
    if let Some(pill_window) = app.get_webview_window("pill") {
        // Check if window is visible
        let is_visible = pill_window.is_visible()
            .map_err(|e| format!("Failed to check window visibility: {}", e))?;
        
        if is_visible {
            // Hide the window
            pill_window
                .hide()
                .map_err(|e| format!("Failed to hide pill window: {}", e))?;
        } else {
            // Show the window at center position
            let (x, y) = calculate_center_position(&app)?;
            pill_window
                .set_position(LogicalPosition::new(x, y))
                .map_err(|e| format!("Failed to position pill window: {}", e))?;
            
            pill_window
                .show()
                .map_err(|e| format!("Failed to show pill window: {}", e))?;
            
            // No need to call set_visible_on_all_workspaces/set_always_on_top here
            // as they are handled in create_pill_window during window creation
        }
        
        Ok(())
    } else {
        Err("Pill window not found after creation".to_string())
    }
}

