// OAuth module for handling Google OAuth authentication with PKCE
// This module provides secure OAuth 2.0 authentication flow using PKCE (Proof Key for Code Exchange)

use std::collections::HashMap;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use crate::config;

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
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    use rand::Rng;
    
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..64).map(|_| rng.gen()).collect();
    URL_SAFE_NO_PAD.encode(&bytes)
}

/// Generates PKCE challenge from verifier using SHA256
/// Returns a base64url-encoded SHA256 hash of the verifier
fn generate_pkce_challenge(verifier: &str) -> String {
    use sha2::{Sha256, Digest};
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let hash = hasher.finalize();
    URL_SAFE_NO_PAD.encode(hash)
}

/// Generates a random state string for CSRF protection
/// Returns a base64url-encoded random string
fn generate_oauth_state() -> String {
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    use rand::Rng;
    
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    URL_SAFE_NO_PAD.encode(&bytes)
}

/// Builds Google OAuth authorization URL with PKCE parameters
fn build_google_oauth_url(client_id: &str, redirect_uri: &str, state: &str, challenge: &str) -> String {
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
    use std::process::Command;
    
    let url_clone = url.to_string();
    tauri::async_runtime::spawn(async move {
        let result = {
            #[cfg(target_os = "macos")]
            {
                Command::new("open").arg(&url_clone).spawn()
            }
            #[cfg(target_os = "windows")]
            {
                Command::new("cmd").args(["/C", "start", &url_clone]).spawn()
            }
            #[cfg(target_os = "linux")]
            {
                Command::new("xdg-open").arg(&url_clone).spawn()
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "Unsupported platform"))
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
/// 2. Generates a random state for CSRF protection
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
    
    // Generate state for CSRF protection
    let oauth_state = generate_oauth_state();
    
    // Store verifier with state as key
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
pub fn get_pkce_verifier(
    state: State<'_, OAuthState>,
    oauth_state: String,
) -> Option<String> {
    let verifiers = state.verifiers.lock().unwrap();
    verifiers.get(&oauth_state).cloned()
}

