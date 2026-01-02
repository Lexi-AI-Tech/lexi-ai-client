//! Cursor Context Retrieval Module
//!
//! This module provides functionality to retrieve text context at the cursor position
//! using macOS Core Graphics and Accessibility API.
//!
//! ## Features
//!
//! - **Cursor Position Detection**: Gets the current mouse cursor coordinates using Core Graphics
//! - **Element Identification**: Uses Accessibility API to identify the UI element at cursor position
//! - **Application Identification**: Traverses up the accessibility tree to find the application at cursor position
//! - **Text Extraction**: Extracts selected text using clipboard copy method (Cmd+C/Ctrl+C)
//! - **Screen Capture**: Captures the entire screen and returns it as a base64-encoded PNG string
//!
//! ## Implementation Details
//!
//! - Uses **Core Graphics** (`CGEventGetLocation()`) to get cursor coordinates
//! - Uses **Accessibility API** (`AXUIElementCopyElementAtPosition()`) to get element at cursor
//! - Traverses accessibility hierarchy to find the application PID
//! - Extracts selected text by simulating copy command via `keyboard_simulator` module
//!   (Cmd+C on macOS, Ctrl+C on Windows/Linux) and reading from clipboard
//! - Uses **Core Graphics** (`CGWindowListCreateImage()`) to capture screen
//! - Encodes screenshots as base64-encoded PNG strings
//!
//! ## Permissions Required
//!
//! - **Accessibility** (macOS): Required for accessing application UI elements
//!   - Users must grant this in System Preferences → Security & Privacy → Privacy → Accessibility
//!   - The app will need to prompt for this permission
//! - **Screen Recording** (macOS): Required for capturing screen content
//!   - Users must grant this in System Preferences → Security & Privacy → Privacy → Screen Recording
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
/// 3. Traverses up the accessibility hierarchy to find the application PID
/// 4. Extracts selected text using clipboard copy method
/// 5. Gets application name from PID
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

            // Create a system-wide accessibility element
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

            // Traverse up the hierarchy to find application PID
            let app_pid = find_app_pid(element_at_cursor);

            // Extract selected text using clipboard copy method
            let selected_text = get_selected_text_via_clipboard();

            // Get application name from PID
            let app_name = if let Some(pid) = app_pid {
                get_app_name_from_pid(pid)
            } else {
                None
            };

            // Cleanup
            CFRelease(element_at_cursor);
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

/// Traverse up the accessibility hierarchy to find application PID
#[cfg(target_os = "macos")]
unsafe fn find_app_pid(element: AXUIElementRef) -> Option<i32> {
    let mut current_element = element;

    // Traverse up the hierarchy (max 20 levels to avoid infinite loops)
    for _ in 0..20 {
        if current_element.is_null() {
            break;
        }

        // Try to get PID (application level)
        let mut pid: i32 = 0;
        let ax_error = AXUIElementGetPid(current_element, &mut pid);
        if ax_error == K_AX_ERROR_SUCCESS && pid != 0 {
            // Found the application PID
            return Some(pid);
        }

        // Get parent element using AXParent attribute
        let parent_attr = create_cf_string("AXParent");
        let mut parent_value: CFTypeRef = std::ptr::null_mut();
        let ax_error =
            AXUIElementCopyAttributeValue(current_element, parent_attr, &mut parent_value);
        CFRelease(parent_attr);

        if ax_error != K_AX_ERROR_SUCCESS || parent_value.is_null() {
            break;
        }

        // Release current element if it's not the original element
        if current_element != element {
            CFRelease(current_element);
        }

        // Move to parent
        current_element = parent_value as AXUIElementRef;
    }

    None
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

/// Capture the entire screen and return it as a base64-encoded PNG string
///
/// This function:
/// 1. Captures the entire screen using `CGWindowListCreateImage()`
/// 2. Converts the CGImage to PNG format using NSImage
/// 3. Encodes the PNG data as base64 and logs it
///
/// Returns the base64-encoded PNG string if successful, or None if capture fails.
/// Requires Screen Recording permission on macOS.
#[cfg(target_os = "macos")]
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

            // Log the base64 string
            println!(
                "✅ Screen captured - Base64 encoded PNG (length: {}):",
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
pub fn capture_current_screen() -> Option<String> {
    None
}
