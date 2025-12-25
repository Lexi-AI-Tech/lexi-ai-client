use tauri::{AppHandle, Manager, LogicalPosition, WebviewUrl, WebviewWindowBuilder};

pub fn create_overlay_window(app: &AppHandle) -> Result<(), String> {
    let builder = WebviewWindowBuilder::new(
        app,
        "correction-overlay",
        WebviewUrl::App("overlay.html".into()),
    )
    .title("Correction Overlay")
    .inner_size(320.0, 180.0) // Size for grammar suggestion overlay (taller for better content display)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .visible(false) // Start visible for testing - will be hidden/shown by text monitor
    .focused(false);

    let window = builder
        .build()
        .map_err(|e| format!("Failed to create overlay window: {}", e))?;

    // Ensure always on top and visible on all workspaces are set
    window
        .set_always_on_top(true)
        .map_err(|e| format!("Failed to set always on top: {}", e))?;
    
    window
        .set_visible_on_all_workspaces(true)
        .map_err(|e| format!("Failed to set visible on all workspaces: {}", e))?;

    println!("✅ Grammar overlay window created successfully");
    Ok(())
}

pub fn ensure_overlay_window_exists(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window("correction-overlay").is_some() {
        return Ok(());
    }
    create_overlay_window(app)
}

#[tauri::command]
pub fn show_overlay_window(app: AppHandle, x: Option<f64>, y: Option<f64>) -> Result<(), String> {
    println!("🪟 show_overlay_window called - x: {:?}, y: {:?}", x, y);
    ensure_overlay_window_exists(&app)?;
    
    if let Some(window) = app.get_webview_window("correction-overlay") {
        // Set position if provided, otherwise use default
        if let (Some(x_pos), Some(y_pos)) = (x, y) {
            window.set_position(LogicalPosition::new(x_pos, y_pos)).map_err(|e| e.to_string())?;
        }
        window.show().map_err(|e| e.to_string())?;
        println!("✅ Overlay window shown");
        // window.set_focus().map_err(|e| e.to_string())?; // Maybe avoid steal focus? grammar bubles usually don't steal until clicked.
        Ok(())
    } else {
        Err("Overlay window not found".to_string())
    }
}

#[tauri::command]
pub fn hide_overlay_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("correction-overlay") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
