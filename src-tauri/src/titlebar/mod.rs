//! Title bar customization for the main window.
//!
//! Clears the window title. On macOS, the native transparent title bar uses the
//! app surface colour. On Windows, native decorations are disabled so the web UI
//! can provide a matching strip (see `WindowsTitleBar` in the frontend).

use tauri::WebviewWindow;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

/// Applies title bar styling to the given window: empty title and, on supported
/// platforms, window background colour matching the app grey (#f1f3f5).
pub fn apply_to_window(window: &WebviewWindow) {
    let _ = window.set_title("");

    #[cfg(target_os = "macos")]
    macos::apply_style(window);

    #[cfg(target_os = "windows")]
    windows::apply_style(window);
}
