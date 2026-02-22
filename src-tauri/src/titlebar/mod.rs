//! Title bar customization for the main window.
//!
//! Removes the window title and, on macOS, sets the title bar to use the same
//! background colour as the app so it blends with the content area.

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
