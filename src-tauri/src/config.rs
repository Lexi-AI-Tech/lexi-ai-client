// Configuration module for managing environment variables
// This module provides a centralized way to access configuration values
// from environment variables. All values are required and must be set.

use std::env;
use std::path::PathBuf;

/// Application configuration loaded from environment variables
/// 
/// This struct provides type-safe access to all configuration values.
/// Values are loaded from environment variables at initialization time.
/// All environment variables are required - the application will panic if any are missing.
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
    /// Creates a new Config instance by loading values from environment variables
    /// 
    /// Loads the `.env` file from the `lexi-ai-client` directory (parent of `src-tauri`).
    /// 
    /// Required environment variables:
    /// - `VITE_API_BASE_URL`: Base URL for the API server
    /// - `VITE_GOOGLE_REDIRECT_URI`: OAuth redirect URI
    /// 
    /// Note: OAuth callback port is hardcoded to 8000 (and will try 8001, 8002 if unavailable)
    /// 
    /// # Panics
    /// Panics if any required environment variable is missing or if the `.env` file cannot be loaded.
    pub fn new() -> Self {
        // Load .env file from lexi-ai-client directory (parent of src-tauri)
        // Try to find the .env file by going up from the current directory
        let env_path = if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
            // When running via cargo, use CARGO_MANIFEST_DIR which points to src-tauri
            let mut path = PathBuf::from(manifest_dir);
            path.pop(); // Go up to lexi-ai-client
            path.push(".env");
            path
        } else {
            // Fallback: try relative path from current directory
            PathBuf::from("../.env")
        };
        
        if let Err(e) = dotenv::from_path(&env_path) {
            eprintln!("⚠️  Warning: Failed to load .env file from {:?}: {}", env_path, e);
            eprintln!("💡 Make sure .env file exists in the lexi-ai-client directory");
        } else {
            println!("✅ Loaded .env file from: {:?}", env_path);
        }
        
        Self {
            api_base_url: env::var("VITE_API_BASE_URL")
                .expect("VITE_API_BASE_URL environment variable is required"),
            
            oauth_redirect_uri: env::var("VITE_GOOGLE_REDIRECT_URI")
                .expect("VITE_GOOGLE_REDIRECT_URI environment variable is required"),
            
            oauth_callback_port: 8000, // Hardcoded OAuth callback port
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
static CONFIG: once_cell::sync::Lazy<Config> = once_cell::sync::Lazy::new(Config::new);

/// Get the global configuration instance
/// 
/// # Returns
/// A reference to the global Config instance
pub fn get_config() -> &'static Config {
    &CONFIG
}

