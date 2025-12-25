//! Cursor Context Retrieval Module
//!
//! This module provides functionality to retrieve text context at the cursor position
//! in the currently focused application using the macOS Accessibility API (AXUIElement).
//!
//! ## Features
//!
//! - **Application Detection**: Gets the frontmost application using NSWorkspace (PID and name)
//! - **Accessibility Tree Access**: Creates an AXUIElement to access the application's UI tree
//! - **Enhanced UI Mode**: Enables enhanced UI mode for Chromium/Electron apps to handle lazy tree building
//! - **Focused Element Detection**: Polls for the focused UI element (handles async accessibility tree construction)
//! - **Text Extraction**: Extracts selected text via `AXSelectedText` attribute, falls back to `AXValue` if no selection
//!
//! ## Implementation Details
//!
//! - Uses **NSWorkspace** to get the frontmost application (PID and name)
//! - Creates an **AXUIElement** for the application to access its accessibility tree
//! - Enables **AXEnhancedUserInterface** and **AXManualAccessibility** for Chromium/Electron apps
//! - Polls for focused UI element (up to 5 retries with 10ms delays) to handle lazy tree building
//! - Uses **CoreFoundation (CFString)** for string conversion between C and Rust
//!
//! ## Permissions Required
//!
//! - **Accessibility** (macOS): Required for accessing application UI elements
//!
//! ## Platform Support
//!
//! - **macOS**: Full functionality via Accessibility API
//! - **Other Platforms**: Returns `None` (not supported)

// Suppress warnings from objc crate's msg_send! macro about unexpected cfg conditions
#![allow(unexpected_cfgs)]

#[cfg(target_os = "macos")]
use crate::accessibility_utils::{
    enable_enhanced_ui, extract_text_from_element, get_focused_element_with_polling,
    get_frontmost_app, AXUIElementCreateApplication, CFRelease,
};

// ============================================================================
// Public Types
// ============================================================================

/// Result of cursor context query
#[derive(Debug, Clone)]
pub struct CursorContext {
    pub selected_text: Option<String>,
    pub app_name: Option<String>,
    pub pid: Option<i32>,
}

// ============================================================================
// Public API
// ============================================================================

/// Get cursor context using macOS Accessibility API
/// 
/// This function attempts to retrieve text context from the currently focused application:
/// 1. Gets the frontmost application using NSWorkspace (returns PID and app name)
/// 2. Creates an AXUIElement for the application process
/// 3. Enables enhanced UI mode for Chromium/Electron apps (AXEnhancedUserInterface, AXManualAccessibility)
/// 4. Polls for the focused UI element (handles lazy accessibility tree building with up to 5 retries)
/// 5. Extracts selected text via AXSelectedText attribute if available
/// 6. Falls back to AXValue attribute (text content) if no selection exists
/// 
/// Returns a CursorContext with selected text, app name, and PID, or None if retrieval fails.
/// Requires Accessibility permission on macOS.
#[cfg(target_os = "macos")]
pub fn get_cursor_context() -> Option<CursorContext> {
    let app = get_frontmost_app()?;
    let pid = app.pid;
    let app_name = app.name;
    
    unsafe {
        objc::rc::autoreleasepool(|| {
            // Create AXUIElement for the application
            let app_element = AXUIElementCreateApplication(pid);
            if app_element.is_null() {
                return Some(CursorContext {
                    selected_text: None,
                    app_name,
                    pid: Some(pid),
                });
            }
            
            // Enable enhanced UI for Chromium/Electron apps
            enable_enhanced_ui(app_element);
            
            // Get focused element with polling (handles lazy tree building)
            let focused_element = match get_focused_element_with_polling(app_element) {
                Some(elem) => elem,
                None => {
                    return Some(CursorContext {
                        selected_text: None,
                        app_name,
                        pid: Some(pid),
                    });
                }
            };
            
            // Extract text from the focused element
            let selected_text = extract_text_from_element(focused_element);
            
            // Cleanup focused element
            CFRelease(focused_element);
            
            // Return context with selected text
            Some(CursorContext {
                selected_text,
                app_name,
                pid: Some(pid),
            })
        })
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

/// Log cursor context to console
pub fn log_cursor_context() {
    #[cfg(target_os = "macos")]
    {
        match get_cursor_context() {
            Some(context) => {
                println!("=== CURSOR CONTEXT ===");
                println!("App: {:?}", context.app_name);
                println!("PID: {:?}", context.pid);
                if let Some(selected_text) = &context.selected_text {
                    println!("Selected/Context Text: {}", selected_text);
                } else {
                    println!("Selected/Context Text: (none)");
                }
                println!("======================");
            }
            None => {
                println!("=== CURSOR CONTEXT ===");
                println!("Failed to retrieve cursor context");
                println!("======================");
            }
        }
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        println!("=== CURSOR CONTEXT ===");
        println!("Cursor context is only available on macOS");
        println!("======================");
    }
}

/// Stub implementation for non-macOS platforms
#[cfg(not(target_os = "macos"))]
pub fn get_cursor_context() -> Option<CursorContext> {
    None
}
