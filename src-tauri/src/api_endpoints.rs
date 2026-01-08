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
    pub const GOOGLE_URL: &str = "/auth/google/url";
    pub const GOOGLE_CALLBACK: &str = "/auth/google/callback";
    pub const GOOGLE: &str = "/auth/google";
    pub const ME: &str = "/auth/me";
    pub const LOGOUT: &str = "/auth/logout";
    pub const OAUTH_VERIFIER: &str = "/auth/oauth/verifier";

    /// Get OAuth callback URL (full URL with base)
    /// Returns localhost URL in development, production URL when custom-protocol feature is enabled
    pub fn oauth_callback_url() -> &'static str {
        #[cfg(feature = "custom-protocol")]
        {
            "https://lexi-ai-server.onrender.com/api/v1/auth/google/callback"
        }
        #[cfg(not(feature = "custom-protocol"))]
        {
            "http://localhost:1230/api/v1/auth/google/callback"
        }
    }

    /// Build OAuth verifier endpoint URL
    pub fn oauth_verifier_url(state: &str) -> String {
        format!(
            "{}{}{}/{}",
            config::api_base_url(),
            super::API_V1_PREFIX,
            OAUTH_VERIFIER,
            state
        )
    }
}

/// Speech-to-Text (STT) endpoints
pub mod stt {
    use super::*;

    pub const TRANSCRIBE: &str = "/stt/";

    /// Build transcribe endpoint URL with query parameters
    pub fn transcribe_url(
        language: &str,
        enhance_stt_output: bool,
        focused_app: &str,
    ) -> String {
        format!(
            "{}{}{}?language={}&enhance_stt_output={}&focused_app={}",
            config::api_base_url(),
            super::API_V1_PREFIX,
            TRANSCRIBE,
            urlencoding::encode(language),
            enhance_stt_output,
            urlencoding::encode(focused_app)
        )
    }
}

/// Transcripts endpoints
pub mod transcripts {
    use super::*;

    pub const LIST: &str = "/transcripts";

    /// Build transcripts list endpoint URL with optional query parameters
    pub fn list_url(params: Option<&str>) -> String {
        match params {
            Some(p) => format!(
                "{}{}{}?{}",
                config::api_base_url(),
                super::API_V1_PREFIX,
                LIST,
                p
            ),
            None => format!("{}{}{}", config::api_base_url(), super::API_V1_PREFIX, LIST),
        }
    }

    /// Build single transcript endpoint URL
    pub fn get_url(id: &str) -> String {
        format!(
            "{}{}{}/{}",
            config::api_base_url(),
            super::API_V1_PREFIX,
            LIST,
            id
        )
    }

    /// Build delete transcript endpoint URL
    pub fn delete_url(id: &str) -> String {
        format!(
            "{}{}{}/{}",
            config::api_base_url(),
            super::API_V1_PREFIX,
            LIST,
            id
        )
    }
}

/// User endpoints
pub mod user {
    use super::*;

    pub const PROFILE: &str = "/users/me";
    pub const STATS: &str = "/users/me/stats";
    pub const CONFIG: &str = "/users/me/config";

    /// Build config endpoint URL with optional query parameters
    pub fn config_url(params: Option<&str>) -> String {
        match params {
            Some(p) => format!(
                "{}{}{}?{}",
                config::api_base_url(),
                super::API_V1_PREFIX,
                CONFIG,
                p
            ),
            None => format!(
                "{}{}{}",
                config::api_base_url(),
                super::API_V1_PREFIX,
                CONFIG
            ),
        }
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

/// Text-to-Speech (TTS) endpoints
pub mod tts {
    use super::*;

    pub const SPEAK: &str = "/tts/speak";

    /// Build speak endpoint URL
    pub fn speak_url() -> String {
        format!(
            "{}{}{}",
            config::api_base_url(),
            super::API_V1_PREFIX,
            SPEAK
        )
    }
}

/// Helper function to build full URL from endpoint path
pub fn build_url(endpoint: &str) -> String {
    format!("{}{}{}", config::api_base_url(), API_V1_PREFIX, endpoint)
}
