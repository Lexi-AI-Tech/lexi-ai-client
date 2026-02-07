//! API Endpoints Module
//!
//! Centralized definition of all API endpoints used in the application.
//! This ensures consistency and makes it easy to update endpoints in one place.

use crate::config;

/// API version prefix
const API_V1_PREFIX: &str = "/api/v1";

/// Authentication endpoints
pub mod auth {
    use super::*;

    pub const REFRESH: &str = "/auth/refresh";
    pub const OAUTH_GOOGLE_CALLBACK: &str = "/auth/google/callback";

    /// Get OAuth callback URL (full URL with base)
    pub fn oauth_callback_url() -> String {
        format!(
            "{}{}{}",
            config::api_base_url(),
            super::API_V1_PREFIX,
            OAUTH_GOOGLE_CALLBACK
        )
    }

    /// Build refresh token endpoint URL
    pub fn refresh_url() -> String {
        format!(
            "{}{}{}",
            config::api_base_url(),
            super::API_V1_PREFIX,
            REFRESH
        )
    }
}

/// Assistant endpoints
pub mod assistant {
    use super::*;

    pub const TRANSCRIBE: &str = "/assistant";

    /// Build transcribe endpoint URL (no query parameters, all data in form body)
    pub fn transcribe_url() -> String {
        format!(
            "{}{}{}",
            config::api_base_url(),
            super::API_V1_PREFIX,
            TRANSCRIBE
        )
    }
}

/// App Config endpoints
pub mod app_config {
    use super::*;

    pub const GET: &str = "/app-config";
    pub const UPDATE: &str = "/app-config";

    /// Build config endpoint URL with optional query parameters
    pub fn get_url(params: Option<&str>) -> String {
        match params {
            Some(p) => format!(
                "{}{}{}?{}",
                config::api_base_url(),
                super::API_V1_PREFIX,
                GET,
                p
            ),
            None => format!("{}{}{}", config::api_base_url(), super::API_V1_PREFIX, GET),
        }
    }

    /// Build config update endpoint URL
    pub fn update_url() -> String {
        format!(
            "{}{}{}",
            config::api_base_url(),
            super::API_V1_PREFIX,
            UPDATE
        )
    }
}

/// Action endpoints
pub mod action {
    use super::*;

    pub const PERFORM: &str = "/actions/perform";

    /// Build perform action endpoint URL
    pub fn perform_url() -> String {
        format!(
            "{}{}{}",
            config::api_base_url(),
            super::API_V1_PREFIX,
            PERFORM
        )
    }
}
