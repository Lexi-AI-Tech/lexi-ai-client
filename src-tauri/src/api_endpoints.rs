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
    pub const DEFAULTS_HOTKEYS: &str = "/app-config/defaults-hotkeys";

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

    /// Build default-hotkeys endpoint URL with optional query parameters
    pub fn defaults_hotkeys_url(params: Option<&str>) -> String {
        match params {
            Some(p) => format!(
                "{}{}{}?{}",
                config::api_base_url(),
                super::API_V1_PREFIX,
                DEFAULTS_HOTKEYS,
                p
            ),
            None => format!(
                "{}{}{}",
                config::api_base_url(),
                super::API_V1_PREFIX,
                DEFAULTS_HOTKEYS
            ),
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

/// Docs endpoints (CRUD + structure/rewrite)
pub mod docs {
    use super::*;

    pub const LIST: &str = "/docs";
    pub const STRUCTURE_CONTENT: &str = "/docs/structure-content";
    pub const REWRITE_SECTION: &str = "/docs/rewrite-section";

    pub fn list_url() -> String {
        format!("{}{}{}", config::api_base_url(), super::API_V1_PREFIX, LIST)
    }

    pub fn doc_url(doc_id: &str) -> String {
        format!(
            "{}{}{}/{}",
            config::api_base_url(),
            super::API_V1_PREFIX,
            LIST,
            doc_id
        )
    }

    pub fn structure_content_url() -> String {
        format!(
            "{}{}{}",
            config::api_base_url(),
            super::API_V1_PREFIX,
            STRUCTURE_CONTENT
        )
    }

    pub fn rewrite_section_url() -> String {
        format!(
            "{}{}{}",
            config::api_base_url(),
            super::API_V1_PREFIX,
            REWRITE_SECTION
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
