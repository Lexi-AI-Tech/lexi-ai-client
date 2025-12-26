//! Configuration Module
//!
//! This module provides centralized configuration values for the application.
//! All configuration values are hardcoded here for simplicity.
//!
//! ## Configuration Values
//!
//! - **API Base URL**: Points to the local Lexi AI Server (default: `http://localhost:1230`)
//! - **OAuth Redirect URI**: Points to the server's Google OAuth callback endpoint
//!   (default: `http://localhost:1230/api/auth/google/callback`)
//!
//! ## Future Enhancements
//!
//! In the future, these values could be:
//! - Loaded from environment variables
//! - Stored in a configuration file
//! - Made configurable via the UI

/// Get the API base URL for the Lexi AI Server
pub fn api_base_url() -> &'static str {
    "http://localhost:1230"
}

/// Get the OAuth redirect URI for the callback server
/// This points to the backend callback endpoint
pub fn oauth_redirect_uri() -> &'static str {
    "http://localhost:1230/api/auth/google/callback"
}
