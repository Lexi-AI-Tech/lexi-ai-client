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
#[cfg(target_os = "macos")]
pub fn start_watcher(app_handle: tauri::AppHandle) {
    macos::start_sleep_watcher(app_handle);
}

/// Windows: refresh the pill overlay after system resume (WebView2 + layered transparency).
#[cfg(target_os = "windows")]
pub fn start_windows_power_watcher(app_handle: tauri::AppHandle) {
    windows::start_power_watcher(app_handle);
}
