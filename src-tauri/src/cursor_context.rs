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

// Suppress warnings from objc crate's msg_send! macro about unexpected cfg conditions
#![allow(unexpected_cfgs)]

#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};
#[cfg(target_os = "macos")]
use std::ffi::c_void;

use arboard::Clipboard;
use std::thread;
use std::time::Duration;

// Core Graphics types (used by capture_current_screen)
#[cfg(target_os = "macos")]
#[repr(C)]
struct CGPoint {
    x: f64,
    y: f64,
}
#[cfg(target_os = "macos")]
#[repr(C)]
struct CGSize {
    width: f64,
    height: f64,
}
#[cfg(target_os = "macos")]
#[repr(C)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

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
fn get_frontmost_application_name() -> Option<String> {
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

/// Capture the entire screen and return it as a base64-encoded PNG string
///
/// This function:
/// 1. Captures the entire screen using `CGWindowListCreateImage()`
/// 2. Converts the CGImage to PNG format using NSImage
/// 3. Encodes the PNG data as base64 and logs it
///
/// Returns the base64-encoded PNG string if successful, or None if capture fails.
///
/// NOTE: This function is currently disabled. Screen capturing feature has been removed.
/// The function is kept for potential future use but is not called anywhere in the codebase.
#[cfg(target_os = "macos")]
#[allow(dead_code)]
pub fn capture_current_screen() -> Option<String> {
    unsafe {
        objc::rc::autoreleasepool(|| {
            use base64::{engine::general_purpose::STANDARD, Engine as _};
            use cocoa::base::id;

            // Get the main display bounds
            let screen_class = objc::runtime::Class::get("NSScreen").unwrap();
            let screens: id = msg_send![screen_class, screens];
            let main_screen: id = msg_send![screens, objectAtIndex: 0usize];
            let frame: cocoa::foundation::NSRect = msg_send![main_screen, frame];

            // Capture the screen using Core Graphics
            extern "C" {
                fn CGWindowListCreateImage(
                    screen_bounds: CGRect,
                    window_list_option: u32,
                    window_id: u32,
                    image_option: u32,
                ) -> *const c_void; // CGImageRef
                fn CGImageRelease(image: *const c_void);
            }

            const K_CGWINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1;
            const K_CGWINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS: u32 = 16;
            const K_CG_WINDOW_IMAGE_DEFAULT: u32 = 0;

            // Convert NSRect to CGRect (they have the same memory layout)
            let cg_rect = CGRect {
                origin: CGPoint {
                    x: frame.origin.x,
                    y: frame.origin.y,
                },
                size: CGSize {
                    width: frame.size.width,
                    height: frame.size.height,
                },
            };

            let cg_image = CGWindowListCreateImage(
                cg_rect,
                K_CGWINDOW_LIST_OPTION_ON_SCREEN_ONLY | K_CGWINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS,
                0, // kCGNullWindowID
                K_CG_WINDOW_IMAGE_DEFAULT,
            );

            if cg_image.is_null() {
                eprintln!("Failed to capture screen: CGWindowListCreateImage returned null");
                return None;
            }

            // Convert CGImage to NSImage for easier PNG export
            let ns_image_class = objc::runtime::Class::get("NSImage").unwrap();
            let ns_image: id = msg_send![ns_image_class, alloc];
            let ns_image: id = msg_send![ns_image, initWithCGImage: cg_image size: frame.size];

            // Release CGImage as we now have NSImage
            CGImageRelease(cg_image);

            // Convert NSImage to PNG data
            let tiff_data: id = msg_send![ns_image, TIFFRepresentation];
            if tiff_data.is_null() {
                eprintln!("Failed to get TIFF representation");
                return None;
            }

            let bitmap_image_rep_class = objc::runtime::Class::get("NSBitmapImageRep").unwrap();
            let bitmap_rep: id = msg_send![bitmap_image_rep_class, imageRepWithData: tiff_data];
            if bitmap_rep.is_null() {
                eprintln!("Failed to create bitmap representation");
                return None;
            }

            // Convert to PNG (NSBitmapImageFileTypePNG = 4)
            // Create empty dictionary for PNG properties
            let ns_dict_class = objc::runtime::Class::get("NSDictionary").unwrap();
            let png_props: id = msg_send![ns_dict_class, dictionary];
            let png_data: id =
                msg_send![bitmap_rep, representationUsingType: 4 properties: png_props];

            if png_data.is_null() {
                eprintln!("Failed to convert to PNG");
                return None;
            }

            // Get PNG data bytes
            let ns_data_len: usize = msg_send![png_data, length];
            let ns_data_bytes: *const u8 = msg_send![png_data, bytes];

            if ns_data_bytes.is_null() || ns_data_len == 0 {
                eprintln!("Failed to get PNG data bytes");
                return None;
            }

            let png_slice = std::slice::from_raw_parts(ns_data_bytes, ns_data_len);

            // Encode to base64
            let base64_string = STANDARD.encode(png_slice);

            // Log the base64 string (function is disabled but kept for potential future use)
            println!(
                "✅ Screen captured - Base64 encoded PNG (length: {}) [DISABLED]",
                base64_string.len()
            );

            Some(base64_string)
        })
    }
}

/// Stub implementation for non-macOS platforms
#[cfg(not(target_os = "macos"))]
pub fn get_cursor_context() -> Option<CursorContext> {
    None
}

/// Stub implementation for non-macOS platforms
#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub fn capture_current_screen() -> Option<String> {
    None
}
