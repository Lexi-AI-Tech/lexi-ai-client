//! Utility functions for common operations across the application.

/// Get the current system type as a string
/// Returns "mac" for macOS, "windows" for Windows
/// Panics on unsupported platforms
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
        panic!("Unsupported platform: Only macOS and Windows are supported")
    }
}

/// Get the device type as a string
pub fn get_device_type() -> &'static str {
    "desktop"
}

/// Log an API request with its purpose, method, and URL
/// This helps track all API calls made to the server
pub fn log_api_request(_purpose: &str, _method: &str, _url: &str) {
    // println!("🌐 API Request: {} {} | Purpose: {}", _method, _url, _purpose);
}

/// Creates a reqwest client with a strict timeout to prevent indefinite hangs
/// when the network drops or the server is unresponsive.
pub fn create_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}
