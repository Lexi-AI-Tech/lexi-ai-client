//! Windows-specific tray behaviour.
//!
//! Hook for any Windows-only tray setup.

#![cfg(target_os = "windows")]

use tauri::App;

/// Called after the tray icon is created on Windows.
pub fn on_tray_created(_app: &App) {
    // No Windows-specific tray setup currently.
}
