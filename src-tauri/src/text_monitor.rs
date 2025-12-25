//! Text Monitor Module
//!
//! This module provides functionality to monitor text changes in the currently focused
//! application using the macOS Accessibility API (AXUIElement).
//!
//! ## Features
//!
//! - **Text Monitoring**: Continuously monitors text changes in focused text fields
//! - **Cursor Position Text**: Retrieves text at the current cursor position
//! - **Change Detection**: Detects and reports when text content changes
//!
//! ## Implementation Details
//!
//! - Uses **NSWorkspace** to get the frontmost application
//! - Creates an **AXUIElement** for the application to access its accessibility tree
//! - Enables **AXEnhancedUserInterface** and **AXManualAccessibility** for Chromium/Electron apps
//! - Polls for focused UI element (handles lazy accessibility tree building)
//! - Extracts text via `AXSelectedText` attribute, falls back to `AXValue` if no selection
//!
//! ## Permissions Required
//!
//! - **Accessibility** (macOS): Required for accessing application UI elements
//!
//! ## Platform Support
//!
//! - **macOS**: Full functionality via Accessibility API
//! - **Other Platforms**: Returns `None` or no-op (not supported)

// Suppress warnings from objc crate's msg_send! macro about unexpected cfg conditions
#![allow(unexpected_cfgs)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::{thread, time::Duration};
use tauri::AppHandle;

#[cfg(target_os = "macos")]
use crate::accessibility_utils::{
    enable_enhanced_ui, extract_text_from_element, get_focused_element_with_polling,
    get_frontmost_app_pid, AXUIElementCreateApplication, CFRelease,
};

// ============================================================================
// Configuration Constants
// ============================================================================

/// Polling interval for text monitoring (milliseconds)
const MONITORING_POLL_INTERVAL_MS: u64 = 300;

/// Flag to track if monitoring is already running
static IS_MONITORING: AtomicBool = AtomicBool::new(false);

// ============================================================================
// Public API
// ============================================================================

/// Start monitoring text changes in the focused application
///
/// This function spawns a background thread that continuously polls the focused
/// text field for changes. Only one monitoring thread can run at a time.
///
/// # Note
/// Currently uses a simple polling approach. For production, consider using
/// accessibility notifications for better performance.
#[tauri::command]
pub fn start_monitoring(_app_handle: AppHandle) -> Result<(), String> {
    // Check if monitoring is already running
    if IS_MONITORING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    thread::spawn(move || {
        let mut last_text = String::new();

        loop {
            #[cfg(target_os = "macos")]
            {
                if let Some(text) = get_text_at_cursor() {
                    println!("📝 Text : {}", text);
                    if text != last_text {
                        last_text = text;
                    }
                }
            }

            #[cfg(not(target_os = "macos"))]
            {
                // No-op on non-macOS platforms
            }

            thread::sleep(Duration::from_millis(MONITORING_POLL_INTERVAL_MS));
        }
    });

    Ok(())
}

/// Get text at the current cursor position (focused text field)
///
/// This function retrieves text from the currently focused UI element in the
/// frontmost application. It follows the same logic as `cursor_context.rs`:
///
/// 1. Gets the frontmost application using NSWorkspace
/// 2. Creates an AXUIElement for the application using raw C API
/// 3. Enables enhanced UI mode for Chromium/Electron apps
/// 4. Gets the focused UI element (with polling for lazy tree building)
/// 5. Extracts selected text via AXSelectedText if available
/// 6. Falls back to AXValue (text content) if no selection
///
/// # Returns
/// Returns the text at cursor position, or None if unavailable.
#[cfg(target_os = "macos")]
#[allow(dead_code)] // Public API function, may be used by external callers
pub fn get_text_at_mouse_cursor() -> Option<String> {
    get_text_at_cursor()
}

/// Internal function to get text at cursor position
#[cfg(target_os = "macos")]
fn get_text_at_cursor() -> Option<String> {
    // Get frontmost application PID
    let pid = get_frontmost_app_pid()?;

    unsafe {
        objc::rc::autoreleasepool(|| {
            // Create AXUIElement for the application
            let app_element = AXUIElementCreateApplication(pid);
            if app_element.is_null() {
                return None;
            }

            // Enable enhanced UI for Chromium/Electron apps
            enable_enhanced_ui(app_element);

            // Get focused element with polling (handles lazy tree building)
            let focused_element = match get_focused_element_with_polling(app_element) {
                Some(elem) => elem,
                None => return None,
            };

            // Extract text from the focused element
            let text = extract_text_from_element(focused_element);

            // Cleanup focused element
            CFRelease(focused_element);

            text
        })
    }
}

/// Stub implementation for non-macOS platforms
#[cfg(not(target_os = "macos"))]
#[allow(dead_code)] // Public API function, may be used by external callers
pub fn get_text_at_mouse_cursor() -> Option<String> {
    None
}
