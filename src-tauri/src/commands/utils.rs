//! Utility Commands
//!
//! This module provides Tauri commands for utility functions that can be called from the frontend.

use crate::utils;

/// Get the current system type as a string
///
/// Returns "mac" for macOS, "windows" for Windows, and "unknown" for other platforms.
/// This uses compile-time platform detection, which is more reliable than user agent parsing.
///
#[tauri::command]
pub fn get_system_type() -> &'static str {
    utils::get_system_type()
}

/// Get the device type as a string
///
#[tauri::command]
pub fn get_device_type() -> &'static str {
    utils::get_device_type()
}
