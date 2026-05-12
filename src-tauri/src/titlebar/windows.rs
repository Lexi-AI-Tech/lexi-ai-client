//! Windows: frameless window with drop shadow so the shell matches the macOS
//! transparent title bar look (no accent-coloured native caption bar).

#![cfg(target_os = "windows")]

use tauri::WebviewWindow;

pub fn apply_style(window: &WebviewWindow) {
    let _ = window.set_decorations(false);
    let _ = window.set_shadow(true);
}
