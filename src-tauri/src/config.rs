//! Configuration Module
//!
//! This module provides centralized configuration values for the application.
//! Configuration values are automatically selected based on build mode:
//! - **Development mode**: Uses local server at `http://localhost:3000`
//! - **Production mode** (when `custom-protocol` feature is enabled): Uses production server at `https://lexi-ai-server.onrender.com`

/// Get the API base URL for the Lexi AI Server
/// Returns localhost URL in development, production URL when custom-protocol feature is enabled
pub fn api_base_url() -> &'static str {
    #[cfg(feature = "custom-protocol")]
    {
        "https://dev-server.speaklexi.com"
    }
    #[cfg(not(feature = "custom-protocol"))]
    {
        "https://dev-server.speaklexi.com"
        // "http://localhost:3000"
    }
}
