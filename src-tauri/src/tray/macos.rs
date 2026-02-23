//! macOS-specific tray behaviour.
//!
//! Hook for any macOS-only tray setup (e.g. dock menu, badge).
use tauri::App;

/// Called after the tray icon is created on macOS.
pub fn on_tray_created(_app: &App) {
    // No macOS-specific tray setup currently.
}
