//! Sleep/Wake Watcher
//!
//! Detects when the system sleeps or wakes up and re-initializes
//! OS-level resources appropriately.

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

/// Starts the system sleep/wake watcher.
///
/// On macOS, it registers for `NSWorkspace` notifications and re-enables
/// the global keyboard listener upon waking from sleep.
pub fn start_watcher(app_handle: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    macos::start_sleep_watcher(app_handle);

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let _ = app_handle;
}

/// Windows: refresh the pill overlay after system resume (WebView2 + layered transparency).
#[cfg(target_os = "windows")]
pub fn start_windows_power_watcher(app_handle: tauri::AppHandle) {
    windows::start_power_watcher(app_handle);
}
