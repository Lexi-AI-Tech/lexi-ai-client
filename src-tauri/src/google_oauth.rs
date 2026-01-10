//! Google OAuth Authentication Module
//!
//! This module provides a secure OAuth 2.0 authentication flow using PKCE (Proof Key for Code Exchange)
//! for user authentication with Google accounts.
//!
//! ## OAuth Flow
//!
//! 1. **Generate PKCE Challenge/Verifier**: Creates cryptographically secure verifier and challenge pair
//! 2. **Generate State**: Creates random state string for CSRF protection
//! 3. **Build Authorization URL**: Constructs Google OAuth authorization URL with PKCE parameters
//! 4. **Open Browser**: Opens the authorization URL in the user's default browser
//! 5. **Store Verifier**: Stores PKCE verifier in application state for later token exchange
//! 6. **Callback Handling**: OAuth callback is handled by the Lexi AI Server UI route (not a local server)
//!
//! ## Security Features
//!
//! - **PKCE**: Uses Proof Key for Code Exchange for enhanced security (required for public clients)
//! - **CSRF Protection**: Random state parameter prevents cross-site request forgery attacks
//! - **Cryptographically Secure**: Uses `rand` crate for secure random number generation
//! - **Base64URL Encoding**: Uses URL-safe base64 encoding for challenge/verifier
//!
//! ## Implementation Details
//!
//! - **Verifier Generation**: 64 random bytes, base64url-encoded (43-128 characters)
//! - **Challenge Generation**: SHA256 hash of verifier, base64url-encoded
//! - **State Generation**: 32 random bytes, base64url-encoded
//! - **Token Exchange**: Handled by Lexi AI Server (client retrieves verifier via `get_pkce_verifier` command)

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

use crate::config;
use crate::utils;

/// OAuth state management for storing PKCE verifiers
/// Maps OAuth state strings to their corresponding PKCE verifiers
#[derive(Default)]
pub struct OAuthState {
    pub verifiers: Mutex<HashMap<String, String>>, // state -> verifier mapping
}

/// PKCE challenge response containing all necessary data for OAuth flow
#[derive(Serialize, Deserialize)]
pub struct PkceChallenge {
    pub challenge: String,
    pub verifier: String,
    pub state: String,
    pub auth_url: String,
}

/// Generates a cryptographically secure random string for PKCE verifier
/// Returns a base64url-encoded string (43-128 characters)
fn generate_pkce_verifier() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..64).map(|_| rng.gen()).collect();
    URL_SAFE_NO_PAD.encode(&bytes)
}

/// Generates PKCE challenge from verifier using SHA256
/// Returns a base64url-encoded SHA256 hash of the verifier
fn generate_pkce_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let hash = hasher.finalize();
    URL_SAFE_NO_PAD.encode(hash)
}

/// Generates a random state string for CSRF protection
/// Returns a base64url-encoded random string
fn generate_oauth_state() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    URL_SAFE_NO_PAD.encode(&bytes)
}

/// Builds Google OAuth authorization URL with PKCE parameters
/// Note: system_type and device_type are encoded in the state parameter (handled by caller)
fn build_google_oauth_url(
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> String {
    let scopes = "openid email profile";
    
    format!(
        "https://accounts.google.com/o/oauth2/v2/auth?\
        client_id={}&\
        redirect_uri={}&\
        response_type=code&\
        scope={}&\
        state={}&\
        code_challenge={}&\
        code_challenge_method=S256&\
        access_type=offline&\
        prompt=consent",
        urlencoding::encode(client_id),
        urlencoding::encode(redirect_uri),
        urlencoding::encode(scopes),
        urlencoding::encode(state),
        urlencoding::encode(challenge)
    )
}

/// Opens the OAuth URL in the user's default browser
/// Platform-specific implementation for macOS, Windows, and Linux
fn open_browser(url: &str, app: AppHandle) {
    let url_clone = url.to_string();
    tauri::async_runtime::spawn(async move {
        let result = {
            #[cfg(target_os = "macos")]
            {
                Command::new("open").arg(&url_clone).spawn()
            }
            #[cfg(target_os = "windows")]
            {
                Command::new("cmd")
                    .args(["/C", "start", &url_clone])
                    .spawn()
            }
            #[cfg(target_os = "linux")]
            {
                Command::new("xdg-open").arg(&url_clone).spawn()
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                Err(std::io::Error::new(
                    std::io::ErrorKind::Unsupported,
                    "Unsupported platform",
                ))
            }
        };

        if let Err(e) = result {
            eprintln!("Failed to open browser: {}", e);
            let _ = app.emit("oauth-error", format!("Failed to open browser: {}", e));
        }
    });
}

/// Start Google OAuth login flow with PKCE
///
/// This command:
/// 1. Generates PKCE challenge/verifier pair
/// 2. Generates a random state for CSRF protection (includes system_type and device_type)
/// 3. Builds Google OAuth authorization URL
/// 4. Opens the browser with the auth URL
/// 5. Returns the PKCE challenge and auth URL to the frontend
#[tauri::command]
pub async fn start_google_login(
    app: AppHandle,
    state: State<'_, OAuthState>,
    client_id: String,
) -> Result<PkceChallenge, String> {
    // Generate PKCE verifier and challenge
    let verifier = generate_pkce_verifier();
    let challenge = generate_pkce_challenge(&verifier);

    // Generate base state for CSRF protection
    let base_state = generate_oauth_state();
    
    // Get system_type and device_type
    let system_type = utils::get_system_type();
    let device_type = utils::get_device_type();
    
    // Encode system_type and device_type in the state parameter
    // Format: base64(base_state|system_type|device_type)
    let state_with_metadata = format!("{}|{}|{}", base_state, system_type, device_type);
    let oauth_state = URL_SAFE_NO_PAD.encode(state_with_metadata.as_bytes());

    // Store verifier with the full oauth_state as key
    {
        let mut verifiers = state.verifiers.lock().unwrap();
        verifiers.insert(oauth_state.clone(), verifier.clone());
    }

    // Build Google OAuth URL with configured redirect URI
    let redirect_uri = config::oauth_redirect_uri();
    let auth_url = build_google_oauth_url(&client_id, redirect_uri, &oauth_state, &challenge);

    // Open browser
    open_browser(&auth_url, app.clone());

    // Note: OAuth callback is now handled by the UI route (/auth/google/callback)
    // The verifier is stored in state and can be retrieved via get_pkce_verifier command
    // No need to start a separate callback server

    Ok(PkceChallenge {
        challenge,
        verifier,
        state: oauth_state,
        auth_url,
    })
}

/// Get PKCE verifier for a given state
#[tauri::command]
pub fn get_pkce_verifier(state: State<'_, OAuthState>, oauth_state: String) -> Option<String> {
    let verifiers = state.verifiers.lock().unwrap();
    verifiers.get(&oauth_state).cloned()
}
