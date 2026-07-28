//! Pill Overlay Window Module
//!
//! This module handles the creation, positioning, and display of the pill overlay window,
//! a small transparent overlay that displays the current recording status.
//!
//! ## Window Properties
//!
//! The pill window is a floating overlay with the following characteristics:
//!
//! - **Size**: 200x50 pixels (fixed, non-resizable)
//! - **Position**: Bottom center of primary monitor, above taskbar/dock
//! - **Always on Top**: Floats above all other windows including fullscreen apps
//! - **Visible on All Workspaces**: Appears across all macOS spaces/desktops
//! - **Transparent**: No window decorations, fully transparent background
//! - **Windows**: Undecorated window shadow is disabled so DWM does not paint a
//!   light border / backdrop behind the transparent WebView (otherwise the pill
//!   appears inside a white “card”).
//! - **Skip Taskbar**: Doesn't appear in Dock or app switcher
//! - **Non-Focusable**: Doesn't steal focus from active application
//!
//! ## NSPanel Implementation (macOS)
//!
//! On macOS, the window is converted to an NSPanel for better fullscreen app support:
//! - **ScreenSaver Level**: Floats above fullscreen apps
//! - **CanJoinAllSpaces**: Appears on all virtual desktops
//! - **FullScreenAuxiliary**: Works alongside fullscreen applications
//! - **IgnoresCycle**: Excluded from Cmd+Tab app cycling
//! - **NonactivatingPanel**: Doesn't activate when shown

use tauri::{
    AppHandle, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder,
};

// Define NSPanel type for overlay on macOS
#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(PillPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

/// Calculate the bottom position of the primary monitor, just above the taskbar/dock
///
/// Returns the (x, y) coordinates for positioning the pill window at the bottom center
/// The window is positioned responsively based on screen size with an offset above the taskbar
fn calculate_bottom_position(app: &AppHandle) -> Result<(f64, f64), String> {
    let monitor = app
        .primary_monitor()
        .map_err(|e| format!("Failed to get primary monitor: {}", e))?
        .ok_or_else(|| "No monitor found".to_string())?;

    let monitor_size = monitor.size();
    let scale_factor = monitor.scale_factor();

    // Convert monitor size to logical pixels (accounting for scale factor)
    let monitor_width = monitor_size.width as f64 / scale_factor;
    let monitor_height = monitor_size.height as f64 / scale_factor;

    // Pill window dimensions (thin rectangular for idle, will resize to circular when recording)
    let pill_width = 40.0;
    let pill_height = 6.6;

    // Estimate taskbar/dock height when visible
    // macOS dock: typically 60-80px, Windows taskbar: typically 40-48px
    // Using a conservative estimate that works for both platforms
    let taskbar_height: f64 = 60.0; // Estimated taskbar/dock height in logical pixels

    // Offset above taskbar
    let offset_above_taskbar: f64 = 12.0;

    // Calculate bottom position: horizontally centered, positioned 5-10px above taskbar/dock
    // Position = screen_height - taskbar_height - pill_height - offset_above_taskbar
    let x = (monitor_width - pill_width) / 2.0; // Horizontally centered
    let y = monitor_height - taskbar_height - pill_height - offset_above_taskbar;

    Ok((x, y))
}

/// Create the pill overlay window dynamically using NSPanel on macOS
///
/// This function creates the pill window with all necessary properties.
/// On macOS, the window is converted to NSPanel for better fullscreen app behavior.
///
/// # Arguments
/// * `app` - The Tauri app handle
///
/// # Returns
/// * `Ok(())` - Successfully created and positioned the window
/// * `Err(String)` - An error message if the operation failed
fn create_pill_window(app: &AppHandle) -> Result<(), String> {
    // Calculate bottom position
    let (position_x, position_y) = calculate_bottom_position(app)?;

    // Pill window dimensions (thin rectangular for idle, will resize to circular when recording)
    let pill_width = 40.0;
    let pill_height = 6.6;

    // Create the window builder
    let pill_window = WebviewWindowBuilder::new(app, "pill", WebviewUrl::App("pill.html".into()))
        .title("Pill")
        .inner_size(pill_width, pill_height)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .decorations(false)
        // Windows: undecorated + default shadow draws a light “plate” (1px border + backdrop)
        // around the HWND; transparent WebView then looks like a white card behind the pill.
        .shadow(false)
        .transparent(true)
        .skip_taskbar(true)
        .position(position_x, position_y)
        .visible(false) // Start hidden, will be shown when needed
        .focused(false)
        .focusable(false)
        .build()
        .map_err(|e| format!("Failed to create pill window: {}", e))?;

    // On macOS, convert to NSPanel for better fullscreen app behavior
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::{CollectionBehavior, PanelLevel, WebviewWindowExt};
        match pill_window.to_panel::<PillPanel>() {
            Ok(panel) => {
                // Configure panel to float above fullscreen apps
                panel.set_level(PanelLevel::ScreenSaver.value());
                panel.set_floating_panel(true);

                // Set collection behavior to appear on all spaces including fullscreen
                // - can_join_all_spaces: appears on all Spaces (virtual desktops)
                // - full_screen_auxiliary: works alongside fullscreen apps
                // - ignores_cycle: excluded from Cmd+Tab app cycling
                let behavior = CollectionBehavior::new()
                    .can_join_all_spaces()
                    .full_screen_auxiliary()
                    .ignores_cycle();
                panel.set_collection_behavior(behavior.value());

                // Set style mask to non-activating panel
                let style = tauri_nspanel::StyleMask::empty().nonactivating_panel();
                panel.set_style_mask(style.value());

                // Force the panel to re-register with the window server after setting behaviors
                // A hide/show cycle is more reliable than order_front_regardless alone
                // This mimics what happens when dragging the window - the window server
                // re-evaluates and properly applies the collection behavior
                panel.hide();
                std::thread::sleep(std::time::Duration::from_millis(50));
                panel.show();
                panel.order_front_regardless();

                println!("✅ Pill window converted to NSPanel with fullscreen support");
            }
            Err(e) => {
                eprintln!("Failed to convert pill window to NSPanel: {:?}", e);
            }
        }
    }

    println!(
        "Pill window created successfully at ({}, {})",
        position_x, position_y
    );

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

/// Initialize and position the pill overlay window at the bottom of the primary monitor
///
/// This function ensures the pill window exists and positions it at the bottom center of the screen,
/// just above the taskbar/dock. The window is created dynamically if it doesn't exist.
/// On macOS, it uses NSPanel for better fullscreen app support.
///
/// # Arguments
/// * `app` - The Tauri app handle
///
/// # Returns
/// * `Ok(())` - Successfully positioned and showed the window
/// * `Err(String)` - An error message if the operation failed
pub fn init_pill_window(app: AppHandle) -> Result<(), String> {
    // 1. Ensure the window exists (creates it with NSPanel on macOS)
    ensure_pill_window_exists(&app)?;

    if let Some(pill_window) = app.get_webview_window("pill") {
        // 2. Position at bottom center
        let (x, y) = calculate_bottom_position(&app)?;
        pill_window
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| format!("Failed to position pill window: {}", e))?;

        // 3. Show the window at startup
        pill_window
            .show()
            .map_err(|e| format!("Failed to show pill window: {}", e))?;

        Ok(())
    } else {
        Err("Pill window not found after creation".to_string())
    }
}

/// After Windows resumes from sleep, WebView2 can leave a transparent pill window fully
/// transparent (animations run but nothing paints). Nudge HWND size and re-show on top.
#[cfg(target_os = "windows")]
pub fn refresh_pill_after_system_resume(app: &AppHandle) {
    use std::time::Duration;

    use tauri::{Emitter, PhysicalSize};

    let Some(pill) = app.get_webview_window("pill") else {
        return;
    };

    let is_visible = pill.is_visible().unwrap_or(true);
    let Ok(size) = pill.inner_size() else {
        let _ = pill.set_always_on_top(true);
        if is_visible {
            let _ = pill.show();
        }
        let _ = app.emit("pill_post_resume_refresh", ());
        return;
    };

    let w = size.width.max(1);
    let h = size.height.max(1);

    let _ = pill.set_size(PhysicalSize::new(w + 1, h));
    let _ = pill.set_always_on_top(true);
    if is_visible {
        let _ = pill.show();
    }

    let app_clone = app.clone();
    let pill_clone = pill.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let _ = pill_clone.set_size(PhysicalSize::new(w, h));
        let _ = pill_clone.set_always_on_top(true);
        if is_visible {
            let _ = pill_clone.show();
        }
        let _ = app_clone.emit("pill_post_resume_refresh", ());
    });
}
