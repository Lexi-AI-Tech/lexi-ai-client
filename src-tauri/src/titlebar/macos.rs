//! macOS title bar styling: match window background to app grey (#f1f3f5).

#![cfg(target_os = "macos")]

use tauri::WebviewWindow;

/// Applies macOS-specific title bar styling so the native title bar
/// uses the same background colour as the app content area.
pub fn apply_style(window: &WebviewWindow) {
    if let Ok(ns_window_ptr) = window.ns_window() {
        unsafe {
            use cocoa::appkit::NSWindow;
            use cocoa::base::id;

            let ns_window = ns_window_ptr as id;
            let r = 241.0 / 255.0;
            let g = 243.0 / 255.0;
            let b = 245.0 / 255.0;
            let bg = cocoa::appkit::NSColor::colorWithDeviceRed_green_blue_alpha_(
                cocoa::base::nil,
                r,
                g,
                b,
                1.0,
            );
            ns_window.setBackgroundColor_(bg);
        }
    }
}
