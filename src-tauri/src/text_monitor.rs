// Suppress warnings from objc crate's msg_send! macro about unexpected cfg conditions
#![allow(unexpected_cfgs)]

use accessibility::{AXUIElement, AXAttribute};
use std::{thread, time::Duration};
use tauri::AppHandle;

#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};
use std::ffi::c_void;

#[tauri::command]
pub fn start_monitoring(_app_handle: AppHandle) -> Result<(), String> {
    println!("🚀 start_monitoring called");

    thread::spawn(move || {
        println!("📡 Text monitoring thread started");

        let mut last_text = String::new();

        loop {
            // System-wide root
            let system = AXUIElement::system_wide();

            // Get focused UI element using attribute with CFString
            use core_foundation::string::CFString;
            let focused_attr = AXAttribute::new(&CFString::from_static_string("AXFocusedUIElement"));
            let focused_element = match system.attribute(&focused_attr) {
                Ok(el) => {
                    // Downcast CFType to AXUIElement
                    if let Some(ax_elem) = el.downcast::<AXUIElement>() {
                        ax_elem
                    } else {
                        thread::sleep(Duration::from_millis(300));
                        continue;
                    }
                }
                Err(_) => {
                    thread::sleep(Duration::from_millis(300));
                    continue;
                }
            };

            // Try to read its value
            let value_attr = AXAttribute::new(&CFString::from_static_string("AXValue"));
            match focused_element.attribute(&value_attr) {
                Ok(val) => {
                    if let Some(cf_string) = val.downcast::<CFString>() {
                        let text = cf_string.to_string();
                        if text != last_text {
                            println!("📝 Text changed: {}", text);
                            last_text = text;
                        }
                    }
                }
                Err(_) => {
                    // Not a text field or no value
                }
            }

            thread::sleep(Duration::from_millis(300));
        }
    });

    Ok(())
}

/// Get text at mouse cursor position (focused text field)
/// 
/// This function follows the same logic as `cursor_context.rs`:
/// 1. Gets the frontmost application using NSWorkspace
/// 2. Creates an AXUIElement for the application using raw C API
/// 3. Gets the focused UI element (with polling for lazy tree building)
/// 4. Extracts selected text via AXSelectedText if available
/// 5. Falls back to AXValue (text content) if no selection
/// 
/// Returns the text at cursor position, or None if unavailable.
#[cfg(target_os = "macos")]
pub fn get_text_at_mouse_cursor() -> Option<String> {
    // Get frontmost application PID
    let pid = get_frontmost_app_pid()?;
    
    unsafe {
        objc::rc::autoreleasepool(|| {
            use std::ptr;
            
            // Import CoreFoundation types
            type CFTypeRef = *const c_void;
            type AXUIElementRef = CFTypeRef;
            type CFStringRef = CFTypeRef;
            type AXError = i32;
            
            // CoreFoundation function declarations
            extern "C" {
                fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
                fn AXUIElementCopyAttributeValue(
                    element: AXUIElementRef,
                    attribute: CFStringRef,
                    value: *mut CFTypeRef,
                ) -> AXError;
                fn CFRelease(cf: CFTypeRef);
            }
            
            // Constants
            const K_AX_ERROR_SUCCESS: AXError = 0;
            
            // Create AXUIElement for the application
            let app_element = AXUIElementCreateApplication(pid);
            if app_element.is_null() {
                return None;
            }
            
            // Enable enhanced UI for Chromium/Electron apps
            let enhanced_ui_attr = create_cf_string("AXEnhancedUserInterface");
            let manual_accessibility_attr = create_cf_string("AXManualAccessibility");
            let _ = AXUIElementCopyAttributeValue(app_element, enhanced_ui_attr, ptr::null_mut());
            let _ = AXUIElementCopyAttributeValue(app_element, manual_accessibility_attr, ptr::null_mut());
            
            // Get focused element with polling (handles lazy tree building)
            let focused_attr = create_cf_string("AXFocusedUIElement");
            let mut focused_element: CFTypeRef = ptr::null_mut();
            
            let mut ax_error = AXUIElementCopyAttributeValue(app_element, focused_attr, &mut focused_element);
            for _ in 0..5 {
                if ax_error == K_AX_ERROR_SUCCESS && !focused_element.is_null() {
                    break;
                }
                thread::sleep(Duration::from_millis(10));
                ax_error = AXUIElementCopyAttributeValue(app_element, focused_attr, &mut focused_element);
            }
            
            if ax_error != K_AX_ERROR_SUCCESS || focused_element.is_null() {
                CFRelease(focused_attr);
                CFRelease(enhanced_ui_attr);
                CFRelease(manual_accessibility_attr);
                return None;
            }
            
            // Try to get selected text first
            let selected_text_attr = create_cf_string("AXSelectedText");
            let mut selected_text_value: CFTypeRef = ptr::null_mut();
            
            ax_error = AXUIElementCopyAttributeValue(
                focused_element,
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
            
            ax_error = AXUIElementCopyAttributeValue(focused_element, value_attr, &mut value);
            
            let value_text = if ax_error == K_AX_ERROR_SUCCESS && !value.is_null() {
                cf_string_to_string(value)
            } else {
                String::new()
            };
            
            // Cleanup
            CFRelease(focused_attr);
            CFRelease(selected_text_attr);
            CFRelease(value_attr);
            CFRelease(enhanced_ui_attr);
            CFRelease(manual_accessibility_attr);
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
        })
    }
}

/// Helper to get the frontmost application PID
#[cfg(target_os = "macos")]
fn get_frontmost_app_pid() -> Option<i32> {
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
            Some(pid)
        })
    }
}

/// Helper function to create a CFString from a Rust string
#[cfg(target_os = "macos")]
unsafe fn create_cf_string(s: &str) -> *const c_void {
    extern "C" {
        fn CFStringCreateWithCString(
            alloc: *const c_void,
            c_str: *const i8,
            encoding: u32,
        ) -> *const c_void;
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
        String::from_utf8_lossy(&buffer[..buffer.len() - 1]).trim_end_matches('\0').to_string()
    } else {
        String::new()
    }
}

/// Stub implementation for non-macOS platforms
#[cfg(not(target_os = "macos"))]
pub fn get_text_at_mouse_cursor() -> Option<String> {
    None
}
