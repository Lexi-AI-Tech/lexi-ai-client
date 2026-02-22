//! Windows title bar styling.
//!
//! No additional styling beyond clearing the title; the transparent title bar
//! and background colour are macOS-specific.

#![cfg(target_os = "windows")]

use tauri::WebviewWindow;

/// Windows: no extra title bar styling (title is cleared in mod).
pub fn apply_style(_window: &WebviewWindow) {}
