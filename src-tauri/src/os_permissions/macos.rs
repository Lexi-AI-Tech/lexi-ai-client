//! macOS: AVFoundation mic check, AX accessibility check, TCC system audio, Settings deep links,
//! mic stream probe, Core Audio tap for system audio request.

use tauri::{AppHandle, Manager};

use crate::{RecordingCommand, RecordingCommandTx};
use objc::runtime::Class;
use objc::{msg_send, sel, sel_impl};
use std::ffi::CString;

/// Check microphone permission using AVFoundation (matches System Settings).
#[tauri::command]
pub fn check_microphone_permission() -> Result<bool, String> {
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

#[tauri::command]
pub fn check_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    use macos_accessibility_client::raw::AXIsProcessTrusted;
    Ok(unsafe { AXIsProcessTrusted() != 0 })
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithCString(
        alloc: *mut std::ffi::c_void,
        c_str: *const std::ffi::c_char,
        encoding: u32,
    ) -> *mut std::ffi::c_void;
    fn CFRelease(cf: *mut std::ffi::c_void);
}

const TCC_STATUS_GRANTED: i32 = 0;
const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

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

    type PreflightFn = unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void) -> i32;
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

/// `kTCCServiceAudioCapture` via `TCCAccessPreflight` (System Settings system audio list).
#[tauri::command]
pub fn check_system_audio_permission(_app: AppHandle) -> Result<bool, String> {
    let tcc = tcc_access_preflight_many(&["kTCCServiceAudioCapture"]);
    Ok(tcc.first().copied().flatten() == Some(true))
}

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

#[tauri::command]
pub fn open_permission_pane(pane: String) -> Result<(), String> {
    open_permission_pane_impl(&pane)
}

#[tauri::command]
pub fn request_microphone_permission(app: AppHandle) -> Result<bool, String> {
    let _ = open_permission_pane_impl("microphone");

    // Run mic open/close on the recording thread (serialized CoreAudio access).
    if let Some(rec) = app.try_state::<RecordingCommandTx>() {
        let _ = rec.0.send(RecordingCommand::WarmupMic);
    }

    Ok(true)
}

#[tauri::command]
pub fn request_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    open_permission_pane_impl("accessibility")?;
    Ok(true)
}

#[tauri::command]
pub fn request_system_audio_permission(_app: AppHandle) -> Result<bool, String> {
    crate::audio::meeting::spawn_process_tap_permission_attempt();
    Ok(true)
}
