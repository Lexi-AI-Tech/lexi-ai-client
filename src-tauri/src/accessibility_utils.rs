//! macOS Accessibility Utilities Module
//!
//! This module provides shared utilities for working with the macOS Accessibility API (AXUIElement).
//! It contains common functions for CoreFoundation string conversion, application detection,
//! and accessibility element manipulation that are used across multiple modules.
//!
//! ## Features
//!
//! - **CFString Conversion**: Convert between Rust strings and CoreFoundation CFString types
//! - **Application Detection**: Get frontmost application information (PID and name)
//! - **Type Definitions**: Shared type aliases for CoreFoundation types
//! - **Constants**: Common accessibility API constants
//!
//! ## Usage
//!
//! This module is intended to be used internally by other modules that interact with
//! the macOS Accessibility API, such as `cursor_context` and `text_monitor`.

// Suppress warnings from objc crate's msg_send! macro about unexpected cfg conditions
#![allow(unexpected_cfgs)]

#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};
use std::ffi::c_void;

// ============================================================================
// Type Definitions
// ============================================================================

/// CoreFoundation type reference
pub type CFTypeRef = *const c_void;

/// Accessibility UI Element reference
pub type AXUIElementRef = CFTypeRef;

/// CoreFoundation string reference
pub type CFStringRef = CFTypeRef;

/// Accessibility API error code
pub type AXError = i32;

// ============================================================================
// Constants
// ============================================================================

#[cfg(target_os = "macos")]
const K_AX_ERROR_SUCCESS: AXError = 0;

#[cfg(target_os = "macos")]
const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;

// Polling configuration for lazy accessibility tree building
pub const FOCUSED_ELEMENT_POLL_RETRIES: usize = 5;
pub const FOCUSED_ELEMENT_POLL_DELAY_MS: u64 = 10;

// ============================================================================
// CoreFoundation String Utilities
// ============================================================================

/// Create a CFString from a Rust string
///
/// # Safety
/// The returned pointer must be released using `CFRelease` when no longer needed.
#[cfg(target_os = "macos")]
pub unsafe fn create_cf_string(s: &str) -> *const c_void {
    extern "C" {
        fn CFStringCreateWithCString(
            alloc: *const c_void,
            c_str: *const i8,
            encoding: u32,
        ) -> *const c_void;
    }
    
    let c_str = std::ffi::CString::new(s).unwrap();
    CFStringCreateWithCString(std::ptr::null(), c_str.as_ptr(), K_CF_STRING_ENCODING_UTF8)
}

/// Convert a CFString to a Rust String
///
/// # Safety
/// The `cf_string` parameter must be a valid CFString pointer.
#[cfg(target_os = "macos")]
pub unsafe fn cf_string_to_string(cf_string: *const c_void) -> String {
    extern "C" {
        fn CFStringGetLength(the_string: *const c_void) -> isize;
        fn CFStringGetCString(
            the_string: *const c_void,
            buffer: *mut i8,
            buffer_size: isize,
            encoding: u32,
        ) -> bool;
    }
    
    let length = CFStringGetLength(cf_string);
    if length <= 0 {
        return String::new();
    }
    
    // Allocate buffer (CFString uses UTF-16, so we need more space)
    let buffer_size = (length * 4 + 1) as usize;
    let mut buffer = vec![0u8; buffer_size];
    
    if CFStringGetCString(
        cf_string,
        buffer.as_mut_ptr() as *mut i8,
        buffer_size as isize,
        K_CF_STRING_ENCODING_UTF8,
    ) {
        // Convert to string, removing null terminator
        String::from_utf8_lossy(&buffer[..buffer.len() - 1])
            .trim_end_matches('\0')
            .to_string()
    } else {
        String::new()
    }
}

// ============================================================================
// Application Detection
// ============================================================================

/// Information about the frontmost application
#[derive(Debug, Clone)]
pub struct FrontmostApp {
    pub pid: i32,
    pub name: Option<String>,
}

/// Get the frontmost application information
///
/// Returns the PID and optionally the application name, or None if unavailable.
#[cfg(target_os = "macos")]
pub fn get_frontmost_app() -> Option<FrontmostApp> {
    unsafe {
        objc::rc::autoreleasepool(|| {
            use cocoa::base::id;
            
            let workspace_class = objc::runtime::Class::get("NSWorkspace").unwrap();
            let workspace: id = msg_send![workspace_class, sharedWorkspace];
            if workspace.is_null() {
                return None;
            }
            
            let front_app: id = msg_send![workspace, frontmostApplication];
            if front_app.is_null() {
                return None;
            }
            
            let pid: i32 = msg_send![front_app, processIdentifier];
            
            // Try to get app name (optional, don't fail if unavailable)
            let app_name: id = msg_send![front_app, localizedName];
            let app_name_str = if !app_name.is_null() {
                Some(cf_string_to_string(app_name as *const c_void))
            } else {
                None
            };
            
            Some(FrontmostApp {
                pid,
                name: app_name_str,
            })
        })
    }
}

/// Get only the PID of the frontmost application
#[cfg(target_os = "macos")]
pub fn get_frontmost_app_pid() -> Option<i32> {
    get_frontmost_app().map(|app| app.pid)
}

// ============================================================================
// Accessibility API Helpers
// ============================================================================

// CoreFoundation function declarations for Accessibility API
#[cfg(target_os = "macos")]
extern "C" {
    pub fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    pub fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    pub fn CFRelease(cf: CFTypeRef);
}

/// Enable enhanced UI mode for Chromium/Electron apps
///
/// This helps with lazy accessibility tree building in modern web applications.
///
/// # Safety
/// The `app_element` must be a valid AXUIElementRef.
#[cfg(target_os = "macos")]
pub unsafe fn enable_enhanced_ui(app_element: AXUIElementRef) {
    use std::ptr;
    
    let enhanced_ui_attr = create_cf_string("AXEnhancedUserInterface");
    let manual_accessibility_attr = create_cf_string("AXManualAccessibility");
    
    let _ = AXUIElementCopyAttributeValue(app_element, enhanced_ui_attr, ptr::null_mut());
    let _ = AXUIElementCopyAttributeValue(app_element, manual_accessibility_attr, ptr::null_mut());
    
    CFRelease(enhanced_ui_attr);
    CFRelease(manual_accessibility_attr);
}

/// Poll for the focused UI element with retries
///
/// This handles lazy accessibility tree building by polling multiple times.
///
/// # Safety
/// The `app_element` must be a valid AXUIElementRef.
///
/// # Returns
/// Returns the focused element if found, or None if unavailable after retries.
#[cfg(target_os = "macos")]
pub unsafe fn get_focused_element_with_polling(
    app_element: AXUIElementRef,
) -> Option<CFTypeRef> {
    use std::ptr;
    use std::thread;
    use std::time::Duration;
    
    let focused_attr = create_cf_string("AXFocusedUIElement");
    let mut focused_element: CFTypeRef = ptr::null_mut();
    
    let mut ax_error = AXUIElementCopyAttributeValue(app_element, focused_attr, &mut focused_element);
    
    for _ in 0..FOCUSED_ELEMENT_POLL_RETRIES {
        if ax_error == K_AX_ERROR_SUCCESS && !focused_element.is_null() {
            CFRelease(focused_attr);
            return Some(focused_element);
        }
        thread::sleep(Duration::from_millis(FOCUSED_ELEMENT_POLL_DELAY_MS));
        ax_error = AXUIElementCopyAttributeValue(app_element, focused_attr, &mut focused_element);
    }
    
    CFRelease(focused_attr);
    None
}

/// Extract text from an accessibility element
///
/// Tries to get selected text first, then falls back to the value attribute.
///
/// # Safety
/// The `element` must be a valid AXUIElementRef.
#[cfg(target_os = "macos")]
pub unsafe fn extract_text_from_element(element: CFTypeRef) -> Option<String> {
    use std::ptr;
    
    // Try to get selected text first
    let selected_text_attr = create_cf_string("AXSelectedText");
    let mut selected_text_value: CFTypeRef = ptr::null_mut();
    
    let mut ax_error = AXUIElementCopyAttributeValue(
        element,
        selected_text_attr,
        &mut selected_text_value,
    );
    
    let selected_text = if ax_error == K_AX_ERROR_SUCCESS && !selected_text_value.is_null() {
        let text = cf_string_to_string(selected_text_value);
        if !text.is_empty() {
            Some(text)
        } else {
            None
        }
    } else {
        None
    };
    
    // Fall back to value attribute (text content)
    let value_attr = create_cf_string("AXValue");
    let mut value: CFTypeRef = ptr::null_mut();
    
    ax_error = AXUIElementCopyAttributeValue(element, value_attr, &mut value);
    
    let value_text = if ax_error == K_AX_ERROR_SUCCESS && !value.is_null() {
        cf_string_to_string(value)
    } else {
        String::new()
    };
    
    // Cleanup
    CFRelease(selected_text_attr);
    CFRelease(value_attr);
    if !selected_text_value.is_null() {
        CFRelease(selected_text_value);
    }
    if !value.is_null() {
        CFRelease(value);
    }
    
    // Return selected text or value text
    selected_text.or_else(|| {
        if !value_text.is_empty() {
            Some(value_text)
        } else {
            None
        }
    })
}

// ============================================================================
// Stub Implementations for Non-macOS Platforms
// ============================================================================

#[cfg(not(target_os = "macos"))]
pub fn get_frontmost_app() -> Option<FrontmostApp> {
    None
}

#[cfg(not(target_os = "macos"))]
pub fn get_frontmost_app_pid() -> Option<i32> {
    None
}

