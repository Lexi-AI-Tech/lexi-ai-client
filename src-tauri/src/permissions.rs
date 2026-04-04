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
//! Microphone on macOS uses AVFoundation (`cidre`): `authorizationStatusForMediaType` and
//! `requestAccessForMediaType:completionHandler:` (same approach as tauri-plugin-macos-permissions).
//! Accessibility uses `macos_accessibility_client::application_is_trusted` / `_with_prompt`.

#![allow(unexpected_cfgs)]

use tauri::AppHandle;

#[cfg(target_os = "macos")]
use cidre::av;
#[cfg(target_os = "macos")]
use cidre::av::capture::device::{AuthorizationStatus, Device};
#[cfg(target_os = "macos")]
use cidre::blocks::SendBlock;

/// Check microphone permission on macOS using AVFoundation (matches System Settings).
/// cpal can succeed even when the mic toggle is off; this uses the real authorization status.
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn check_microphone_permission() -> Result<bool, String> {
    let media_type = av::MediaType::audio();
    let status = Device::authorization_status_for_media_type(media_type)
        .map_err(|e| format!("authorizationStatusForMediaType failed: {e}"))?;
    Ok(status == AuthorizationStatus::Authorized)
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
    use macos_accessibility_client::accessibility::application_is_trusted;
    Ok(application_is_trusted())
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

/// Request microphone permission on macOS.
///
/// Matches [tauri-plugin-macos-permissions](https://github.com/ayangweb/tauri-plugin-macos-permissions):
/// uses `+[AVCaptureDevice requestAccessForMediaType:completionHandler:]` so the system shows
/// the native prompt when appropriate, without spinning up `cpal` / `AudioRecorder` (which could
/// feel like duplicate work or extra side effects).
///
/// Returns whether access is already granted (`true`) after this call completes, or `false` if
/// the user still needs to allow (dialog shown) or must use System Settings (denied/restricted).
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn request_microphone_permission() -> Result<bool, String> {
    let media_type = av::MediaType::audio();
    let status = Device::authorization_status_for_media_type(media_type)
        .map_err(|e| format!("authorizationStatusForMediaType failed: {e}"))?;

    if status == AuthorizationStatus::Authorized {
        println!("🎤 Microphone already authorized");
        return Ok(true);
    }

    if matches!(
        status,
        AuthorizationStatus::Denied | AuthorizationStatus::Restricted
    ) {
        // macOS will not show the prompt again; same as plugin — send user to Settings.
        println!("🎤 Microphone denied or restricted — opening System Settings");
        open_permission_pane_impl("microphone")?;
        return Ok(false);
    }

    println!("🎤 Requesting microphone via AVFoundation requestAccessForMediaType");
    let (tx, rx) = std::sync::mpsc::channel();
    let mut block = SendBlock::new1(move |granted: bool| {
        let _ = tx.send(granted);
    });
    Device::request_access_for_media_type_ch(media_type, block.as_mut())
        .map_err(|e| format!("requestAccessForMediaType failed: {e}"))?;

    let granted = rx
        .recv()
        .map_err(|_| "microphone permission completion handler did not run".to_string())?;

    Ok(granted)
}

/// Request microphone permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn request_microphone_permission() -> Result<bool, String> {
    Ok(true)
}

/// Request Accessibility permission on macOS.
///
/// Strategy: Use `AXIsProcessTrustedWithOptions(kAXTrustedCheckOptionPrompt: true)` via the
/// `macos_accessibility_client` crate. This shows a native system dialog that:
/// - Tells the user "Lexi AI would like to control this computer"
/// - Has an "Open System Preferences" button that opens Settings with the app highlighted
///
/// This replaces the old osascript approach which was broken (it requested accessibility
/// for the `osascript` process, not for Lexi AI).
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn request_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    use macos_accessibility_client::accessibility::application_is_trusted_with_prompt;

    // This shows the native prompt if not already trusted.
    // If already trusted: returns true immediately, no popup.
    // If not trusted: shows system dialog with "Open System Preferences" that highlights the app.
    let trusted = application_is_trusted_with_prompt();
    println!(
        "♿ Accessibility permission: {}",
        if trusted { "granted" } else { "prompt shown" }
    );
    Ok(trusted)
}

/// Request Accessibility permission (non-macOS platforms)
#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn request_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}

/// Request screen recording / system audio permission (needed for system audio in meetings).
///
/// Aligns with [tauri-plugin-macos-permissions](https://github.com/ayangweb/tauri-plugin-macos-permissions)
/// screen recording API: only `CGRequestScreenCaptureAccess()`. We do **not** immediately open
/// System Settings when it returns `false`, so the user is not hit with a Settings window right
/// after dismissing or denying the system dialog (use `open_permission_pane` from the UI if needed).
#[tauri::command]
#[cfg(target_os = "macos")]
pub fn request_system_audio_permission(_app: AppHandle) -> Result<bool, String> {
    let audio_capture_granted = check_audio_capture_permission_tcc() == Some(true);
    let screen_granted = unsafe { CGPreflightScreenCaptureAccess() };
    if audio_capture_granted || screen_granted {
        println!("🖥️  System audio / screen capture already granted");
        return Ok(true);
    }

    println!("🖥️  Requesting Screen Recording via CGRequestScreenCaptureAccess");
    let granted = unsafe { CGRequestScreenCaptureAccess() };
    Ok(granted)
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub fn request_system_audio_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}
