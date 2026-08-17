//! Utility functions for common operations across the application.

use reqwest::RequestBuilder;
use tauri::AppHandle;

pub const FEATURE_USAGE_HEADER: &str = "X-Feature-Usage";

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

/// Turns a raw error's Display text into a short, user-facing message.
/// Structured "Server Error (status): body" text is passed through as-is —
/// the frontend's formatUserFacingApiError parses that shape. Everything
/// else (transport/timeout/OS-level errors) is replaced with generic copy.
pub fn user_facing_error(raw: &str, fallback: &str) -> String {
    if raw.starts_with("Server Error (") {
        return raw.to_string();
    }
    let lower = raw.to_lowercase();
    if lower.contains("timed out") {
        return "Request timed out. Please try again.".to_string();
    }
    if lower.contains("error sending request")
        || lower.contains("connection")
        || lower.contains("dns")
        || lower.contains("tls")
    {
        return "Couldn't reach the server. Check your connection and try again.".to_string();
    }
    fallback.to_string()
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

/// Attach feature usage JWT when present (metered API calls).
pub fn apply_feature_usage_header(app: &AppHandle, builder: RequestBuilder) -> RequestBuilder {
    if let Some(jwt) = crate::commands::feature_usage_store::get_feature_usage(app) {
        builder.header(FEATURE_USAGE_HEADER, jwt)
    } else {
        builder
    }
}

/// Persist refreshed feature usage JWT from a metered API response header.
pub fn capture_feature_usage_header(app: &AppHandle, response: &reqwest::Response) {
    if let Some(jwt) = response
        .headers()
        .get(FEATURE_USAGE_HEADER)
        .and_then(|v| v.to_str().ok())
    {
        if !jwt.is_empty() {
            if let Err(e) = crate::commands::feature_usage_store::save_feature_usage(app, jwt)
            {
                eprintln!("⚠️  Failed to save feature usage JWT: {}", e);
            }
        }
    }
}
