//! App icon as a PNG data URL for Transcript and Actions lists.
//!
//! **macOS:** `NSWorkspace` / `NSRunningApplication` → PNG data URL.
//! **Windows:** running processes + version resource display name (aligned with `active-win-pos-rs`)
//! → `SHGetFileInfoW` / `DrawIconEx` → PNG data URL.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

/// Tauri command: get app icon as data URL for the given app name.
/// Returns null when the app is not found or the icon cannot be produced.
#[tauri::command]
pub fn get_app_icon(app_name: String) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        macos::get_app_icon_data_url(app_name.trim())
    }

    #[cfg(target_os = "windows")]
    {
        windows::get_app_icon_data_url(app_name.trim())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app_name;
        None
    }
}
