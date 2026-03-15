//! Permissions Module
//!
//! This module provides Tauri commands to request and check macOS system permissions
//! required for the application to function properly.
//!
//! ## Required Permissions
//!
//! 1. **Microphone Permission**
//!    - Required for: Audio recording via `AudioRecorder`
//!    - Triggered by: Attempting to access the default input device
//!    - System Location: Privacy & Security → Microphone
//!
//! 2. **Input Monitoring Permission**
//!    - Required for: Global keyboard event listening
//!    - Triggered by: Attempting to create a CGEventTap
//!    - System Location: Privacy & Security → Input Monitoring
//!
//! 3. **Accessibility Permission**
//!    - Required for: Text injection (AppleScript) and cursor context retrieval (AXUIElement)
//!    - Triggered by: Using System Events or Accessibility API
//!    - System Location: Privacy & Security → Accessibility
//!
//! 4. **System audio permission** (for capturing system audio in meetings)
//!    - **macOS 14.4+**: Prefer "Audio Capture" (kTCCServiceAudioCapture) so the user can grant
//!      system audio only without full Screen Recording. Checked via private TCC API; fallback below.
//!    - **Older macOS or if TCC unavailable**: Screen Recording permission is used (same capability).
//!    - Request: open Settings (Screen Recording pane; on 14.4+ user can choose "System Audio Recording Only").
//!    - System Location: Privacy & Security → Screen Recording (or Audio Capture on 14.4+)
//!
//! ## Platform Support
//!
//! - **macOS**: Full permission checking and requesting support
//! - **Other Platforms**: Functions return `true` (permissions handled differently or not required)
//!
//! ## Implementation Notes
//!
//! Microphone on macOS uses AVFoundation's AVCaptureDevice.authorizationStatus(for: .audio)
//! so the UI reflects the actual System Settings toggle. Accessibility uses AXIsProcessTrusted;
//! Input Monitoring uses IOHIDCheckAccess.

#![allow(unexpected_cfgs)]

use tauri::AppHandle;

use crate::audio::recorder::AudioRecorder;
#[cfg(target_os = "macos")]
use objc::runtime::Class;
#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};
#[cfg(target_os = "macos")]
use std::ffi::CString;

/// Check microphone permission on macOS using AVFoundation (matches System Settings).
/// cpal can succeed even when the mic toggle is off; this uses the real authorization status.
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn check_microphone_permission() -> Result<bool, String> {
    // AVAuthorizationStatusAuthorized = 3
    const AV_AUTHORIZATION_STATUS_AUTHORIZED: i64 = 3;

    let av_class =
        Class::get("AVCaptureDevice").ok_or_else(|| "AVCaptureDevice unavailable".to_string())?;
    let ns_string_class =
        Class::get("NSString").ok_or_else(|| "NSString unavailable".to_string())?;
    let c_str = CString::new("soun").map_err(|e| e.to_string())?;
    let media_type: *mut objc::runtime::Object =
        unsafe { msg_send![ns_string_class, stringWithUTF8String: c_str.as_ptr()] };
    let status: i64 = unsafe { msg_send![av_class, authorizationStatusForMediaType: media_type] };

    Ok(status == AV_AUTHORIZATION_STATUS_AUTHORIZED)
}

/// Check microphone permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn check_microphone_permission() -> Result<bool, String> {
    Ok(true)
}

// IOHIDCheckAccess: macOS 10.15+ API to check Input Monitoring permission.
// kIOHIDRequestTypeListenEvent = 1, kIOHIDAccessTypeGranted = 0.
#[cfg(target_os = "macos")]
extern "C" {
    fn IOHIDCheckAccess(request_type: u32) -> u32;
}

/// Check Input Monitoring permission on macOS via IOHIDCheckAccess.
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn check_input_monitoring_permission(_app: AppHandle) -> Result<bool, String> {
    const K_IOHID_REQUEST_TYPE_LISTEN_EVENT: u32 = 1;
    const K_IOHID_ACCESS_TYPE_GRANTED: u32 = 0;
    let access = unsafe { IOHIDCheckAccess(K_IOHID_REQUEST_TYPE_LISTEN_EVENT) };
    Ok(access == K_IOHID_ACCESS_TYPE_GRANTED)
}

/// Check Input Monitoring permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn check_input_monitoring_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}

/// Check Accessibility permission on macOS using the system API for this process.
/// AppleScript checks the osascript process, not Lexi, so we use AXIsProcessTrusted instead.
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn check_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    use macos_accessibility_client::raw::AXIsProcessTrusted;
    // AXIsProcessTrusted returns non-zero (true) only if this process has accessibility permission.
    let granted = unsafe { AXIsProcessTrusted() != 0 };
    Ok(granted)
}

/// Check Accessibility permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn check_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}

// Screen Recording (macOS 10.15+): required for system audio when Audio Capture is not available.
#[cfg(target_os = "macos")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithCString(
        alloc: *mut std::ffi::c_void,
        c_str: *const std::ffi::c_char,
        encoding: u32,
    ) -> *mut std::ffi::c_void;
    fn CFRelease(cf: *mut std::ffi::c_void);
}

/// TCC status: 0 = granted, 1 = denied, 2 = not determined. -1 = error / API unavailable.
#[allow(dead_code)]
const TCC_STATUS_GRANTED: i32 = 0;

/// kCFStringEncodingUTF8
#[allow(dead_code)]
const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

/// Check "Audio Capture" permission via private TCC API (macOS 14.4+).
/// Returns Some(true) if granted, Some(false) if denied/not determined, None if TCC API unavailable.
#[cfg(target_os = "macos")]
#[allow(dead_code)]
fn check_audio_capture_permission_tcc() -> Option<bool> {
    use std::ffi::CString;
    const TCC_PATH: &str = "/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC";

    let path_c = CString::new(TCC_PATH).ok()?;
    let handle = unsafe { libc::dlopen(path_c.as_ptr(), libc::RTLD_NOW) };
    let handle = std::ptr::NonNull::new(handle)?;

    type PreflightFn = unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void) -> i32;
    let sym = b"TCCAccessPreflight\0";
    let preflight_ptr =
        unsafe { libc::dlsym(handle.as_ptr(), sym.as_ptr() as *const libc::c_char) };
    if preflight_ptr.is_null() {
        return None;
    }
    let preflight: PreflightFn = unsafe { std::mem::transmute(preflight_ptr) };

    let service = CString::new("kTCCServiceAudioCapture").ok()?;
    let cf_str = unsafe {
        CFStringCreateWithCString(
            std::ptr::null_mut(),
            service.as_ptr(),
            K_CF_STRING_ENCODING_UTF8,
        )
    };
    if cf_str.is_null() {
        return None;
    }
    let status = unsafe { preflight(cf_str as *mut std::ffi::c_void, std::ptr::null_mut()) };
    unsafe { CFRelease(cf_str) };
    Some(status == TCC_STATUS_GRANTED)
}

/// Check system audio permission: prefer "Audio Capture" only (macOS 14.4+) when available,
/// otherwise fall back to Screen Recording (required for system audio on older macOS).
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn check_system_audio_permission(_app: AppHandle) -> Result<bool, String> {
    let granted = check_audio_capture_permission_tcc()
        .unwrap_or_else(|| unsafe { CGPreflightScreenCaptureAccess() });
    Ok(granted)
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn check_system_audio_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}

/// Internal helper: open macOS System Settings to a specific privacy pane.
#[cfg(target_os = "macos")]
fn open_permission_pane_impl(pane: &str) -> Result<(), String> {
    use std::process::Command;
    let url = match pane {
        "microphone" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        }
        "accessibility" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
        "input_monitoring" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
        }
        "screen_capture" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
        _ => return Err(format!("Unknown pane: {}", pane)),
    };
    Command::new("open")
        .arg(url)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Open macOS System Settings to a specific privacy pane (so user can grant permission if modal didn't show)
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn open_permission_pane(pane: String) -> Result<(), String> {
    open_permission_pane_impl(&pane)
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn open_permission_pane(_pane: String) -> Result<(), String> {
    Ok(())
}

/// Request microphone permission on macOS
/// This will trigger the system permission dialog by attempting to access the microphone
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn request_microphone_permission() -> Result<bool, String> {
    use std::thread;

    // Open System Settings pane so user can enable if the modal doesn't show
    let _ = open_permission_pane_impl("microphone");

    // Spawn a thread to attempt microphone access, which triggers the permission dialog
    thread::spawn(move || {
        // Try to create an audio recorder, which will trigger the permission dialog
        let _ = std::panic::catch_unwind(|| {
            let _recorder = AudioRecorder::new();
            println!("Microphone permission dialog should have appeared");
        });
    });

    Ok(true)
}

/// Request microphone permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn request_microphone_permission() -> Result<bool, String> {
    Ok(true)
}

/// Request Input Monitoring permission on macOS
/// This will trigger the system permission dialog by attempting to create a test CGEventTap
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn request_input_monitoring_permission(_app: AppHandle) -> Result<bool, String> {
    use objc2_core_graphics::{
        CGEvent, CGEventMask, CGEventTapCallBack, CGEventTapLocation, CGEventTapOptions,
        CGEventTapPlacement, CGEventTapProxy, CGEventType,
    };
    use std::os::raw::c_void;
    use std::ptr::{null_mut, NonNull};
    use std::thread;

    // Open System Settings pane so user can enable if the modal doesn't show
    let _ = open_permission_pane_impl("input_monitoring");

    // Spawn a thread to attempt starting a test tap, which triggers the permission dialog
    thread::spawn(move || {
        unsafe extern "C-unwind" fn dummy_callback(
            _proxy: CGEventTapProxy,
            _type: CGEventType,
            cg_event: NonNull<CGEvent>,
            _user_info: *mut c_void,
        ) -> *mut CGEvent {
            cg_event.as_ptr()
        }

        let _ = std::panic::catch_unwind(|| {
            unsafe {
                let callback: CGEventTapCallBack = Some(dummy_callback);
                let _tap = CGEvent::tap_create(
                    CGEventTapLocation::HIDEventTap,
                    CGEventTapPlacement::HeadInsertEventTap,
                    CGEventTapOptions::Default,
                    (1 << 12) as CGEventMask, // 12 is kCGEventFlagsChanged
                    callback,
                    null_mut(),
                );
            }
            println!("Input Monitoring permission dialog should have appeared");
        });
    });

    Ok(true)
}

/// Request Input Monitoring permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn request_input_monitoring_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}

/// Request Accessibility permission on macOS
/// This is required for pasting text via AppleScript/System Events
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn request_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    use std::process::Command;
    use std::thread;

    // Open System Settings pane so user can enable if the modal doesn't show
    let _ = open_permission_pane_impl("accessibility");

    // Spawn a thread to attempt using System Events, which triggers the permission dialog
    thread::spawn(move || {
        let script = r#"
            tell application "System Events"
                get name of every process
            end tell
        "#;
        let _ = std::panic::catch_unwind(|| {
            let _ = Command::new("osascript").arg("-e").arg(script).output();
            println!("Accessibility permission dialog should have appeared");
        });
    });

    Ok(true)
}

/// Request Accessibility permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn request_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}

/// Request screen recording permission (needed for system audio in meetings).
/// Call CGRequestScreenCaptureAccess() (macOS shows the popup at most once), then deep-link to Settings.
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn request_system_audio_permission(_app: AppHandle) -> Result<bool, String> {
    let _ = open_permission_pane_impl("screen_capture");
    let _ = unsafe { CGRequestScreenCaptureAccess() };
    Ok(true)
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn request_system_audio_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}
