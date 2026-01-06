//! Utility functions for common operations across the application.

/// Get the current system type as a string
/// Returns "mac" for macOS, "windows" for Windows, and "unknown" for other platforms
pub fn get_system_type() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "mac"
    }
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "unknown"
    }
}
