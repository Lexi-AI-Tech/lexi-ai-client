//! Cursor Context Retrieval Module
//!
//! This module provides functionality to retrieve text context at the cursor position
//! using macOS Core Graphics and Accessibility API.
//!
//! ## Features
//!
//! - **Cursor Position Detection**: Gets the current mouse cursor coordinates using Core Graphics
//! - **Element Identification**: Uses Accessibility API to identify the UI element at cursor position
//! - **Hierarchy Traversal**: Traverses up the accessibility tree to find input fields and application details
//! - **Text Extraction**: Extracts selected text and text content from input fields
//!
//! ## Implementation Details
//!
//! - Uses **Core Graphics** (`CGEventGetLocation()`) to get cursor coordinates
//! - Uses **Accessibility API** (`AXUIElementCopyElementAtPosition()`) to get element at cursor
//! - Traverses accessibility hierarchy to find:
//!   - Input fields (AXTextField, AXTextArea, etc.)
//!   - Parent windows
//!   - Parent applications
//! - Extracts text via `AXSelectedText` and `AXValue` attributes
//!
//! ## Permissions Required
//!
//! - **Accessibility** (macOS): Required for accessing application UI elements
//!   - Users must grant this in System Preferences → Security & Privacy → Privacy → Accessibility
//!   - The app will need to prompt for this permission
//!
//! ## Platform Support
//!
//! - **macOS**: Full functionality via Core Graphics and Accessibility API
//! - **Other Platforms**: Returns `None` (not supported)

// Suppress warnings from objc crate's msg_send! macro about unexpected cfg conditions
#![allow(unexpected_cfgs)]

#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};
#[cfg(target_os = "macos")]
use std::ffi::c_void;

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
// Core Graphics Types and Functions
// ============================================================================

#[cfg(target_os = "macos")]
#[repr(C)]
struct CGPoint {
    x: f64,
    y: f64,
}

// ============================================================================
// Accessibility API Types and Functions
// ============================================================================

#[cfg(target_os = "macos")]
type AXUIElementRef = *const c_void;
#[cfg(target_os = "macos")]
type CFStringRef = *const c_void;
#[cfg(target_os = "macos")]
type CFTypeRef = *const c_void;
#[cfg(target_os = "macos")]
type AXError = i32;

#[cfg(target_os = "macos")]
const K_AX_ERROR_SUCCESS: AXError = 0;

#[cfg(target_os = "macos")]
extern "C" {
    fn AXUIElementCopyElementAtPosition(
        application: AXUIElementRef,
        x: f32,
        y: f32,
        element: *mut AXUIElementRef,
    ) -> AXError;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementGetPid(element: AXUIElementRef, pid: *mut i32) -> AXError;
    fn CFRelease(cf: CFTypeRef);
}

// ============================================================================
// Public API
// ============================================================================

/// Get cursor context using macOS Core Graphics and Accessibility API
///
/// This function:
/// 1. Gets the current cursor position using `CGEventGetLocation()`
/// 2. Uses `AXUIElementCopyElementAtPosition()` to get the UI element at that position
/// 3. Traverses up the accessibility hierarchy to find:
///    - Input fields (text fields, text areas, etc.)
///    - Parent windows
///    - Parent applications
/// 4. Extracts selected text and application details
///
/// Returns a CursorContext with selected text, app name, and PID, or None if retrieval fails.
/// Requires Accessibility permission on macOS.
#[cfg(target_os = "macos")]
pub fn get_cursor_context() -> Option<CursorContext> {
    unsafe {
        // Get cursor position using Core Graphics via NSEvent
        objc::rc::autoreleasepool(|| {
            use cocoa::base::id;
            
            let ns_event_class = objc::runtime::Class::get("NSEvent").unwrap();
            let mouse_location: CGPoint = msg_send![ns_event_class, mouseLocation];
            
            // Convert from AppKit coordinate system (bottom-left origin) to Core Graphics (top-left origin)
            // Get screen height to convert Y coordinate
            let screen_class = objc::runtime::Class::get("NSScreen").unwrap();
            let screens: id = msg_send![screen_class, screens];
            let main_screen: id = msg_send![screens, objectAtIndex: 0usize];
            let frame: cocoa::foundation::NSRect = msg_send![main_screen, frame];
            let screen_height = frame.size.height;
            
            // Convert Y coordinate: AppKit (bottom-left) -> Core Graphics (top-left)
            let point = CGPoint {
                x: mouse_location.x,
                y: screen_height - mouse_location.y,
            };

            // Get the system-wide accessibility element (root)
            // We need to get the element at the cursor position
            // First, we'll try to get the element at the position using the system element
            
            // Create a system-wide element (PID 0 is the system)
            let system_element = create_system_element();
            if system_element.is_null() {
                return None;
            }

            // Get element at cursor position
            let mut element_at_cursor: AXUIElementRef = std::ptr::null_mut();
            let ax_error = AXUIElementCopyElementAtPosition(
                system_element,
                point.x as f32,
                point.y as f32,
                &mut element_at_cursor,
            );

        if ax_error != K_AX_ERROR_SUCCESS || element_at_cursor.is_null() {
            CFRelease(system_element);
            return None;
        }

        // Traverse up the hierarchy to find input field and application
        let (input_element, app_pid) = find_input_field_and_app(element_at_cursor);

        // Extract text from the input element
        let selected_text = if !input_element.is_null() {
            extract_text_from_element(input_element)
        } else {
            None
        };

        // Get application name from PID
        let app_name = if let Some(pid) = app_pid {
            get_app_name_from_pid(pid)
        } else {
            None
        };

        // Cleanup
        CFRelease(element_at_cursor);
        if !input_element.is_null() && input_element != element_at_cursor {
            CFRelease(input_element);
        }
        CFRelease(system_element);

            Some(CursorContext {
                selected_text,
                app_name,
                pid: app_pid,
            })
        })
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Create a system-wide accessibility element
#[cfg(target_os = "macos")]
unsafe fn create_system_element() -> AXUIElementRef {
    extern "C" {
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    }
    AXUIElementCreateSystemWide()
}

/// Traverse up the accessibility hierarchy to find input field and application
#[cfg(target_os = "macos")]
unsafe fn find_input_field_and_app(
    element: AXUIElementRef,
) -> (AXUIElementRef, Option<i32>) {
    let mut input_element: AXUIElementRef = std::ptr::null_mut();
    let mut app_pid: Option<i32> = None;
    let mut current_element = element;
    let mut visited_elements = Vec::new();

    // Traverse up the hierarchy (max 20 levels to avoid infinite loops)
    for _ in 0..20 {
        if current_element.is_null() {
            break;
        }

        // Check if this is an input field
        if input_element.is_null() {
            let role = get_element_attribute(current_element, "AXRole");
            if let Some(role) = role {
                if is_input_field_role(&role) {
                    input_element = current_element;
                    // Don't release this element yet, we'll use it
                }
            }
        }

        // Try to get PID (application level)
        if app_pid.is_none() {
            let mut pid: i32 = 0;
            let ax_error = AXUIElementGetPid(current_element, &mut pid);
            if ax_error == K_AX_ERROR_SUCCESS && pid != 0 {
                app_pid = Some(pid);
                // Found the application, we can stop here
                break;
            }
        }

        // Get parent element using AXParent attribute
        let parent_attr = create_cf_string("AXParent");
        let mut parent_value: CFTypeRef = std::ptr::null_mut();
        let ax_error = AXUIElementCopyAttributeValue(
            current_element,
            parent_attr,
            &mut parent_value,
        );
        CFRelease(parent_attr);
        
        let parent = if ax_error == K_AX_ERROR_SUCCESS && !parent_value.is_null() {
            // parent_value is an AXUIElementRef
            parent_value as AXUIElementRef
        } else {
            std::ptr::null_mut()
        };

        // Release previous element if we're moving up (except if it's the input_element)
        if current_element != element && current_element != input_element {
            if !visited_elements.contains(&current_element) {
                CFRelease(current_element);
            }
        }

        if ax_error != K_AX_ERROR_SUCCESS || parent.is_null() {
            break;
        }

        visited_elements.push(current_element);
        current_element = parent;
    }

    // Cleanup any remaining elements we traversed (except input_element)
    for elem in visited_elements {
        if elem != input_element {
            CFRelease(elem);
        }
    }

    (input_element, app_pid)
}

/// Check if a role represents an input field
#[cfg(target_os = "macos")]
fn is_input_field_role(role: &str) -> bool {
    matches!(
        role,
        "AXTextField"
            | "AXTextArea"
            | "AXStaticText"
            | "AXEditableText"
            | "AXSearchField"
            | "AXSecureTextField"
    )
}

/// Extract text from an element (selected text or value)
#[cfg(target_os = "macos")]
unsafe fn extract_text_from_element(element: AXUIElementRef) -> Option<String> {
    // Try to get selected text first
    let selected_text_attr = create_cf_string("AXSelectedText");
    let mut selected_text_value: CFTypeRef = std::ptr::null_mut();

    let ax_error = AXUIElementCopyAttributeValue(
        element,
        selected_text_attr,
        &mut selected_text_value,
    );

    let selected_text = if ax_error == K_AX_ERROR_SUCCESS && !selected_text_value.is_null() {
        let text = cf_string_to_string(selected_text_value);
        CFRelease(selected_text_value);
        if !text.is_empty() {
            Some(text)
        } else {
            None
        }
    } else {
        None
    };

    CFRelease(selected_text_attr);

    // If we have selected text, return it
    if selected_text.is_some() {
        return selected_text;
    }

    // Otherwise, try to get the value attribute
    let value_attr = create_cf_string("AXValue");
    let mut value: CFTypeRef = std::ptr::null_mut();

    let ax_error = AXUIElementCopyAttributeValue(element, value_attr, &mut value);

    let value_text = if ax_error == K_AX_ERROR_SUCCESS && !value.is_null() {
        let text = cf_string_to_string(value);
        CFRelease(value);
        if !text.is_empty() {
            Some(text)
        } else {
            None
        }
    } else {
        None
    };

    CFRelease(value_attr);

    value_text
}

/// Get application name from PID
#[cfg(target_os = "macos")]
fn get_app_name_from_pid(pid: i32) -> Option<String> {
    use objc::{msg_send, sel, sel_impl};
    use std::ffi::c_void;

    unsafe {
        objc::rc::autoreleasepool(|| {
            use cocoa::base::id;

            let workspace_class = objc::runtime::Class::get("NSWorkspace").unwrap();
            let workspace: id = msg_send![workspace_class, sharedWorkspace];
            if workspace.is_null() {
                return None;
            }

            // Get running applications
            let running_apps: id = msg_send![workspace, runningApplications];
            if running_apps.is_null() {
                return None;
            }

            // Iterate through applications to find the one with matching PID
            let count: usize = msg_send![running_apps, count];
            for i in 0..count {
                let app: id = msg_send![running_apps, objectAtIndex: i];
                if app.is_null() {
                    continue;
                }

                let app_pid: i32 = msg_send![app, processIdentifier];
                if app_pid == pid {
                    let app_name: id = msg_send![app, localizedName];
                    if !app_name.is_null() {
                        return Some(cf_string_to_string(app_name as *const c_void));
                    }
                }
            }

            None
        })
    }
}

/// Get an element attribute value
#[cfg(target_os = "macos")]
unsafe fn get_element_attribute(element: AXUIElementRef, attribute: &str) -> Option<String> {
    let attr_cf = create_cf_string(attribute);
    let mut value: CFTypeRef = std::ptr::null_mut();

    let ax_error = AXUIElementCopyAttributeValue(element, attr_cf, &mut value);

    CFRelease(attr_cf);

    if ax_error == K_AX_ERROR_SUCCESS && !value.is_null() {
        let result = cf_string_to_string(value);
        CFRelease(value);
        Some(result)
    } else {
        None
    }
}

// ============================================================================
// Helper Functions for CoreFoundation/NSString Conversion
// ============================================================================

/// Helper function to create a CFString from a Rust string
#[cfg(target_os = "macos")]
unsafe fn create_cf_string(s: &str) -> CFStringRef {
    extern "C" {
        fn CFStringCreateWithCString(
            alloc: *const c_void,
            c_str: *const i8,
            encoding: u32,
        ) -> CFStringRef;
    }
    const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;

    let c_str = std::ffi::CString::new(s).unwrap();
    CFStringCreateWithCString(std::ptr::null(), c_str.as_ptr(), K_CF_STRING_ENCODING_UTF8)
}

/// Helper function to convert CFString to Rust String
#[cfg(target_os = "macos")]
unsafe fn cf_string_to_string(cf_string: *const c_void) -> String {
    extern "C" {
        fn CFStringGetLength(the_string: *const c_void) -> isize;
        fn CFStringGetCString(
            the_string: *const c_void,
            buffer: *mut i8,
            buffer_size: isize,
            encoding: u32,
        ) -> bool;
    }
    const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;

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

/// Stub implementation for non-macOS platforms
#[cfg(not(target_os = "macos"))]
pub fn get_cursor_context() -> Option<CursorContext> {
    None
}
