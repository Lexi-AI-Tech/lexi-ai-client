//! Utility Commands
//!
//! This module provides Tauri commands for utility functions that can be called from the frontend.

use crate::utils;

/// Get the current system type as a string
///
/// Returns "mac" for macOS, "windows" for Windows, and "unknown" for other platforms.
/// This uses compile-time platform detection, which is more reliable than user agent parsing.
///
/// # Returns
/// * `"mac"` - If running on macOS
/// * `"windows"` - If running on Windows
/// * `"unknown"` - If running on other platforms (Linux, etc.)
#[tauri::command]
pub fn get_system_type() -> &'static str {
    utils::get_system_type()
}

