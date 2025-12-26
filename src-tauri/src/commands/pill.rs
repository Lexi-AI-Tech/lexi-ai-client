//! Pill Window Commands
//!
//! This module provides Tauri commands for managing the pill overlay window.

use crate::pill;
use tauri::AppHandle;

/// Show the pill window at the specified coordinates
#[tauri::command]
pub fn show_pill_window(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    pill::show_pill_window(app, x, y)
}

/// Toggle the pill window visibility
#[tauri::command]
pub fn toggle_pill_window(app: AppHandle) -> Result<(), String> {
    pill::toggle_pill_window(app)
}
