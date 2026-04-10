//! Cursor Context Retrieval Module
//!
//! This module provides functionality to retrieve text context for the active input source.
//!
//! ## Features
//!
//! - **Focused Application**: Uses the frontmost (active) application via NSWorkspace (same as
//!   reference implementations that use the active window’s app, not the app under the cursor).
//! - **Text Extraction**: Extracts selected text using clipboard copy method (Cmd+C/Ctrl+C)
//!
//! ## Implementation Details
//!
//! - Uses **active-win-pos-rs** `get_active_window()` for app name.
//! - Extracts selected text by simulating copy command via `keyboard_simulator` module
//!   (Cmd+C on macOS, Ctrl+C on Windows/Linux) and reading from clipboard
//!
//! ## Permissions Required
//!
//! - **Accessibility** (macOS): Required for accessing application UI elements
//!   - Users must grant this in System Preferences → Security & Privacy → Privacy → Accessibility
//!   - The app will need to prompt for this permission
//!
//! ## Platform Support
//!
//! - **macOS**: Frontmost app via active-win-pos-rs; selected text via clipboard copy simulation.
//! - **Other Platforms**: Returns `None` (not supported).

use arboard::Clipboard;
use std::thread;
use std::time::Duration;

// ============================================================================
// Public Types
// ============================================================================

/// Result of cursor context query
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct CursorContext {
    pub selected_text: Option<String>,
    pub app_name: Option<String>,
}

// ============================================================================
// Public API
// ============================================================================

/// Get cursor context: active window app name and selected text.
///
/// Same approach as active-win-pos-rs:
/// - **Focused app**: NSWorkspace `frontmostApplication` (the active window’s app).
/// - **Selected text**: Clipboard copy simulation (Cmd+C) then read.
///
/// Returns a CursorContext with selected text and app name, or None if retrieval fails.
#[cfg(target_os = "macos")]
pub fn get_cursor_context() -> Option<CursorContext> {
    let app_name = get_frontmost_application_name()?;
    let selected_text = get_selected_text_via_clipboard();
    Some(CursorContext {
        selected_text,
        app_name: Some(app_name),
    })
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Returns the frontmost (active) application name.
#[cfg(target_os = "macos")]
pub fn get_frontmost_application_name() -> Option<String> {
    let active = active_win_pos_rs::get_active_window().ok()?;
    let name = active.app_name;
    if name.is_empty() {
        Some("Unknown".to_string())
    } else {
        Some(name)
    }
}

/// Get selected text by simulating copy command (Cmd+C on macOS, Ctrl+C elsewhere)
///
/// This function:
/// 1. Saves the current clipboard content
/// 2. Simulates copy command via `keyboard_simulator` module (Cmd+C on macOS, Ctrl+C on Windows/Linux)
/// 3. Waits briefly for the copy operation to complete
/// 4. Retrieves the copied text from clipboard
/// 5. Restores the original clipboard content
/// 6. Returns the selected text
///
/// This approach works across all applications including Chrome, browsers, and text editors.
/// Keyboard simulation is handled by the `keyboard_simulator` module for cross-platform support.
///
/// # Returns
/// * `Some(String)` - The selected text if any was copied
/// * `None` - If no text was selected or an error occurred
pub fn get_selected_text_via_clipboard() -> Option<String> {
    let mut clipboard = match Clipboard::new() {
        Ok(clip) => clip,
        Err(e) => {
            eprintln!("Failed to initialize clipboard: {}", e);
            return None;
        }
    };

    // Step 1: Save current clipboard content
    let original_clipboard = clipboard.get_text().unwrap_or_default();

    // Step 2: Clear clipboard to ensure we get fresh data
    if let Err(e) = clipboard.clear() {
        eprintln!("Failed to clear clipboard: {}", e);
        return None;
    }

    // Step 3: Simulate copy command via keyboard_simulator module
    // Handles platform-specific implementation (Cmd+C on macOS, Ctrl+C on Windows/Linux)
    let copy_result = crate::keyboard_simulator::simulate_copy();

    if let Err(e) = copy_result {
        eprintln!("Failed to simulate copy command: {}", e);
        // Restore clipboard before returning
        let _ = clipboard.set_text(original_clipboard);
        return None;
    }

    // Step 4: Wait for copy operation to complete
    thread::sleep(Duration::from_millis(50));

    // Step 5: Get the copied text from clipboard
    let selected_text = clipboard.get_text().unwrap_or_default();

    // Step 6: Restore original clipboard content
    let _ = clipboard.set_text(original_clipboard);

    // Return the selected text (empty string means no selection)
    if selected_text.is_empty() {
        None
    } else {
        Some(selected_text)
    }
}

/// Stub implementation for non-macOS platforms
#[cfg(not(target_os = "macos"))]
pub fn get_cursor_context() -> Option<CursorContext> {
    None
}
