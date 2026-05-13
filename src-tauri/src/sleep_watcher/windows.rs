//! Windows system suspend / resume notifications.
//!
//! After sleep, WebView2 in a transparent layered window can keep running (IPC, timers)
//! while the composited surface stops painting — the pill looks empty even though dictation
//! still works. We listen for resume and nudge the pill window + emit a small frontend refresh.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;
use windows::Win32::Foundation::{ERROR_SUCCESS, HANDLE, WIN32_ERROR};
use windows::Win32::System::Power::{
    PowerRegisterSuspendResumeNotification, DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS,
};
use windows::Win32::UI::WindowsAndMessaging::DEVICE_NOTIFY_CALLBACK;

/// `PBT_APMRESUMESUSPEND` — user session resumed from suspend.
const PBT_APMRESUMESUSPEND: u32 = 0x0007;
/// `PBT_APMRESUMEAUTOMATIC` — OS resumed automatically (e.g. modern standby).
const PBT_APMRESUMEAUTOMATIC: u32 = 0x0012;

static LAST_RESUME_REFRESH_MS: AtomicU64 = AtomicU64::new(0);

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

unsafe extern "system" fn power_callback(
    context: *const std::ffi::c_void,
    event_type: u32,
    _setting: *const std::ffi::c_void,
) -> u32 {
    if context.is_null() {
        return 1;
    }

    if event_type != PBT_APMRESUMESUSPEND && event_type != PBT_APMRESUMEAUTOMATIC {
        return 1;
    }

    let now = epoch_ms();
    let prev = LAST_RESUME_REFRESH_MS.load(Ordering::Relaxed);
    if now.saturating_sub(prev) < 1_500 {
        return 1;
    }
    LAST_RESUME_REFRESH_MS.store(now, Ordering::Relaxed);

    let app = unsafe { &*(context as *const AppHandle) };
    let app = app.clone();
    let _ = app.run_on_main_thread(move || {
        crate::pill::refresh_pill_after_system_resume(&app);
    });

    1
}

/// Registers with the power manager for suspend/resume callbacks (process lifetime).
pub fn start_power_watcher(app: AppHandle) {
    let ctx = Box::into_raw(Box::new(app)) as *mut std::ffi::c_void;
    let params = Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
        Callback: Some(power_callback),
        Context: ctx,
    });
    let params_ptr = Box::into_raw(params);
    let mut _registration_handle: *mut std::ffi::c_void = std::ptr::null_mut();

    let err: WIN32_ERROR = unsafe {
        PowerRegisterSuspendResumeNotification(
            DEVICE_NOTIFY_CALLBACK,
            HANDLE(params_ptr as isize),
            &mut _registration_handle,
        )
    };

    if err != ERROR_SUCCESS {
        eprintln!(
            "⚠️  PowerRegisterSuspendResumeNotification failed ({:?}); pill may not auto-refresh after sleep",
            err
        );
    } else {
        println!("✅ Registered Windows power resume handler for pill compositing refresh");
    }
}
