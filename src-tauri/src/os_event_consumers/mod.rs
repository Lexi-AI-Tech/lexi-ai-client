//! OS-level event consumers (e.g. suppressing system shortcuts before the OS handles them).

#[cfg(target_os = "macos")]
mod macos;

/// Register OS-specific event consumers (e.g. Fn key → emoji picker suppression on macOS).
pub fn register(app: &tauri::App) {
    #[cfg(target_os = "macos")]
    macos::register(app);
}
