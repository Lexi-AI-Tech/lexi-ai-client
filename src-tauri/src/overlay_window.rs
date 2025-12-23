use tauri::{AppHandle, Manager, LogicalPosition, WebviewUrl, WebviewWindowBuilder};

pub fn create_overlay_window(app: &AppHandle) -> Result<(), String> {
    let builder = WebviewWindowBuilder::new(
        app,
        "correction-overlay",
        WebviewUrl::App("overlay.html".into()),
    )
    .title("Correction Overlay")
    .inner_size(200.0, 100.0) // Initial size, can be adjusted by frontend content
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .always_on_top(true)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false);

    builder
        .build()
        .map_err(|e| format!("Failed to create overlay window: {}", e))?;

    Ok(())
}

pub fn ensure_overlay_window_exists(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window("correction-overlay").is_some() {
        return Ok(());
    }
    create_overlay_window(app)
}

#[tauri::command]
pub fn show_overlay_window(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    ensure_overlay_window_exists(&app)?;
    
    if let Some(window) = app.get_webview_window("correction-overlay") {
        window.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
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
