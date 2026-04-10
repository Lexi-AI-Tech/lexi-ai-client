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

/// Log an API request method and URL.
pub fn log_api_request(method: &str, url: &str) {
    println!("🌐 API Request: {} {}", method, url);
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

/// Creates a reqwest client with a long timeout for endpoints that call the LLM
/// (e.g. meeting Q&A), which can take 30–120+ seconds.
pub fn create_http_client_long_timeout() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}
