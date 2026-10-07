//! Configuration Module
//!
//! This module provides centralized configuration values for the application.
//! Configuration values are automatically selected based on build mode:
//! - **Development mode**: Uses local server at `http://localhost:3000`
//! - **Production mode** (when `custom-protocol` feature is enabled): Uses production server at `https://server.speaklexi.com`

/// Get the API base URL for the Lexi AI Server
/// Returns localhost URL in development, production URL when custom-protocol feature is enabled
pub fn api_base_url() -> &'static str {
    #[cfg(feature = "custom-protocol")]
    {
        "https://server.speaklexi.com"
    }
    #[cfg(not(feature = "custom-protocol"))]
    {
        "http://localhost:3000"
    }
}

/// Google OAuth client id selection.
///
/// This is intentionally owned by the Tauri backend so we don't have to rely on
/// Vite env files (`.env`, `.env.production`, etc.) for auth correctness.
///
/// - Dev: uses the dev client id (non-`custom-protocol` build).
/// - Prod: uses the prod client id (`custom-protocol` build).
///
pub fn google_oauth_client_id() -> String {
    #[cfg(feature = "custom-protocol")]
    {
        // Production OAuth client id
        "48146086016-hjcvnjvaakuof8iikh0rkc6t820j326p.apps.googleusercontent.com".to_string()
    }

    #[cfg(not(feature = "custom-protocol"))]
    {
        // Development OAuth client id
        "453771286752-paa5rfeb61a72r1r18ttdl0p23vvmqtv.apps.googleusercontent.com".to_string()
    }
}
