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
//! 2. **Accessibility Permission**
//!    - Required for: Text injection (AppleScript) and cursor context retrieval (AXUIElement)
//!    - Triggered by: Using System Events or Accessibility API
//!    - System Location: Privacy & Security → Accessibility
//!
//! 3. **System audio permission** (for capturing system audio in meetings)
//!    - **Check** uses **`TCCAccessPreflight`** for **`kTCCServiceAudioCapture` only** — the same TCC
//!      decision **System Settings** uses for **System audio recording** (no Core Audio tap probe:
//!      taps can succeed before the toggle appears and caused false “Allowed”).
//!      Screen Recording / combined “screen and system audio” is **not** part of this check.
//!    - **Request** triggers only the Core Audio **process tap** (same as meetings) so macOS can show
//!      the **system audio** consent sheet — not `CGRequestScreenCaptureAccess`, which pushes the
//!      broader Screen Recording flow. Do **not** open System Settings before the tap attempt.
//!
//! ## Platform Support
//!
//! - **macOS**: Full permission checking and requesting support
//! - **Other Platforms**: Functions return `true` (permissions handled differently or not required)
//!
//! ## Implementation Notes
//!
//! Microphone on macOS uses AVFoundation's AVCaptureDevice.authorizationStatus(for: .audio)
//! so the UI reflects the actual System Settings toggle. Accessibility uses AXIsProcessTrusted.
//! System audio uses `TCCAccessPreflight(kTCCServiceAudioCapture)` — the same policy **System Settings**
//! applies for **System audio recording** (Apple does not expose a separate “read Settings UI” API).

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

/// TCC: `0` = granted (same notion as toggles in System Settings → Privacy).
#[cfg(target_os = "macos")]
const TCC_STATUS_GRANTED: i32 = 0;

#[cfg(target_os = "macos")]
const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

/// `TCCAccessPreflight` for each service; single `dlopen` per call (fine for ~1s UI polling).
#[cfg(target_os = "macos")]
fn tcc_access_preflight_many(services: &[&str]) -> Vec<Option<bool>> {
    use std::ffi::CString;
    const TCC_PATH: &str = "/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC";

    let path_c = match CString::new(TCC_PATH) {
        Ok(p) => p,
        Err(_) => return vec![None; services.len()],
    };
    let handle_raw = unsafe { libc::dlopen(path_c.as_ptr(), libc::RTLD_NOW) };
    let Some(handle) = std::ptr::NonNull::new(handle_raw) else {
        return vec![None; services.len()];
    };

    type PreflightFn =
        unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void) -> i32;
    let preflight_ptr = unsafe {
        libc::dlsym(
            handle.as_ptr(),
            b"TCCAccessPreflight\0".as_ptr() as *const libc::c_char,
        )
    };

    let results = if preflight_ptr.is_null() {
        vec![None; services.len()]
    } else {
        let preflight: PreflightFn = unsafe { std::mem::transmute(preflight_ptr) };
        services
            .iter()
            .map(|svc| {
                let service = CString::new(*svc).ok()?;
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
                let code =
                    unsafe { preflight(cf_str as *mut std::ffi::c_void, std::ptr::null_mut()) };
                unsafe { CFRelease(cf_str) };
                Some(code == TCC_STATUS_GRANTED)
            })
            .collect()
    };

    unsafe { libc::dlclose(handle.as_ptr()) };
    results
}

/// System audio: **`kTCCServiceAudioCapture` via `TCCAccessPreflight` only** — aligns with the
/// **System audio recording** toggle list in System Settings for this process (no tap-based guess).
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn check_system_audio_permission(_app: AppHandle) -> Result<bool, String> {
    let tcc = tcc_access_preflight_many(&["kTCCServiceAudioCapture"]);
    Ok(tcc.first().copied().flatten() == Some(true))
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

/// Request **system audio** capture only: spawns the same `create_process_tap` attempt as meetings
/// (macOS system audio Allow / Don’t allow). No `CGRequestScreenCaptureAccess` — that is for the
/// broader Screen Recording consent path, which we do not ask for here.
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn request_system_audio_permission(_app: AppHandle) -> Result<bool, String> {
    crate::audio::meeting::spawn_process_tap_permission_attempt();
    Ok(true)
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn request_system_audio_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}
