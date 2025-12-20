// Configuration module for managing application configuration
// 
// This module provides centralized configuration values for the application.
// All values are hardcoded here for the built application. The API base URL
// points to the local Lexi AI Server, and the OAuth redirect URI points to
// the server's Google OAuth callback endpoint.

/// Get the API base URL for the Lexi AI Server
pub fn api_base_url() -> &'static str {
    "http://localhost:1230"
}

/// Get the OAuth redirect URI for the callback server
/// This points to the backend callback endpoint
pub fn oauth_redirect_uri() -> &'static str {
    "http://localhost:1230/api/auth/google/callback"
}

