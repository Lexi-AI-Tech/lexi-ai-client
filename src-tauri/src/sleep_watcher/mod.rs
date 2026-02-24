//! Sleep/Wake Watcher
//!
//! Detects when the system sleeps or wakes up and re-initializes
//! OS-level resources appropriately.

#[cfg(target_os = "macos")]
pub mod macos;

/// Starts the system sleep/wake watcher.
///
/// On macOS, it registers for `NSWorkspace` notifications and re-enables
/// the global keyboard listener upon waking from sleep.
pub fn start_watcher(app_handle: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    macos::start_sleep_watcher(app_handle);

    #[cfg(not(target_os = "macos"))]
    let _ = app_handle; // No-op for non-macOS platforms
}
