// Configuration module for managing application configuration
// This module provides a centralized way to access configuration values.
// All values are hardcoded here for the built application.

/// Application configuration with hardcoded values
/// 
/// This struct provides type-safe access to all configuration values.
/// All values are hardcoded and do not require environment variables.
#[derive(Debug, Clone)]
pub struct Config {
    /// Base URL for the Lexi AI Server API
    pub api_base_url: String,
    
    /// OAuth redirect URI for the callback server
    pub oauth_redirect_uri: String,
    
    /// OAuth callback server port (first port to try)
    pub oauth_callback_port: u16,
}

impl Config {
    /// Creates a new Config instance with hardcoded values
    /// 
    /// All configuration values are hardcoded here. Update these values
    /// directly in this function to change the application configuration.
    pub fn new() -> Self {
        Self {
            api_base_url: "http://localhost:1230".to_string(),
            oauth_redirect_uri: "http://localhost:8000/auth/google/callback".to_string(),
            oauth_callback_port: 8000,
        }
    }
    
    /// Get the API base URL
    pub fn api_base_url(&self) -> &str {
        &self.api_base_url
    }
    
    /// Get the OAuth redirect URI
    pub fn oauth_redirect_uri(&self) -> &str {
        &self.oauth_redirect_uri
    }
    
    /// Get the OAuth callback port
    pub fn oauth_callback_port(&self) -> u16 {
        self.oauth_callback_port
    }
}

impl Default for Config {
    fn default() -> Self {
        Self::new()
    }
}

/// Global configuration instance
/// 
/// This is initialized once at application startup and can be accessed
/// throughout the application. Use `get_config()` to access it.
static CONFIG: std::sync::LazyLock<Config> = std::sync::LazyLock::new(Config::new);

/// Get the global configuration instance
/// 
/// # Returns
/// A reference to the global Config instance
pub fn get_config() -> &'static Config {
    &CONFIG
}

