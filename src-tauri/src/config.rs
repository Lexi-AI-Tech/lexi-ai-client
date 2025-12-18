// Configuration module for managing application configuration
// All values are hardcoded here for the built application.

/// Get the API base URL for the Lexi AI Server
pub fn api_base_url() -> &'static str {
    "http://localhost:1230"
}

/// Get the OAuth redirect URI for the callback server
pub fn oauth_redirect_uri() -> &'static str {
    "http://localhost:5173/auth/google/callback"
}

/// Get the OAuth callback server port (first port to try)
pub fn oauth_callback_port() -> u16 {
    5173
}

