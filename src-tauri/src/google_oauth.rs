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

/// Response structure for OAuth callback containing authorization code and state
#[derive(Serialize, Deserialize)]
pub struct GoogleCallbackResponse {
    pub code: String,
    pub state: String,
    pub verifier: String,
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

/// Starts an HTTP server to listen for OAuth callback
/// Tries multiple ports (8000, 8001, 8002) and handles the callback request
fn start_oauth_callback_server(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        use hyper::server::conn::http1;
        use hyper::service::service_fn;
        use hyper_util::rt::TokioIo;
        use tokio::net::TcpListener;
        use http_body_util::Full;
        use hyper::body::Bytes;
        use hyper::{Request, Response, StatusCode};
        
        // Try ports starting from configured port, then try next two ports
        let start_port = config::oauth_callback_port();
        let ports = vec![start_port, start_port + 1, start_port + 2];
        let mut listener: Option<TcpListener> = None;
        
        // Find an available port
        for port in &ports {
            match TcpListener::bind(format!("127.0.0.1:{}", port)).await {
                Ok(l) => {
                    listener = Some(l);
                    println!("OAuth callback server listening on port {}", port);
                    break;
                }
                Err(e) => {
                    eprintln!("Port {} unavailable: {}, trying next...", port, e);
                }
            }
        }
        
        if let Some(listener) = listener {
            // Accept one connection (OAuth callback)
            match listener.accept().await {
                Ok((stream, _)) => {
                    let io = TokioIo::new(stream);
                    
                    // Create service function to handle the request
                    let app_for_service = app.clone();
                    
                    let service = service_fn(move |req: Request<hyper::body::Incoming>| {
                        let app = app_for_service.clone();
                        
                        async move {
                            let path = req.uri().path();
                            let query = req.uri().query().unwrap_or("");
                            
                            if path == "/" || path.starts_with("/?") {
                                // Parse query parameters
                                let query_pairs: HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes())
                                    .into_owned()
                                    .collect();
                                
                                if let (Some(code), Some(callback_state)) = (query_pairs.get("code"), query_pairs.get("state")) {
                                    println!("OAuth callback received - code: {}..., state: {}", 
                                        &code.chars().take(10).collect::<String>(), callback_state);
                                    
                                    // Get verifier from app state
                                    if let Some(oauth_state) = app.try_state::<OAuthState>() {
                                        let verifier = {
                                            let verifiers = oauth_state.verifiers.lock().unwrap();
                                            println!("Looking for verifier with state: {}, available states: {:?}", 
                                                callback_state, verifiers.keys().collect::<Vec<_>>());
                                            verifiers.get(callback_state).cloned()
                                        };
                                        
                                        if let Some(verifier) = verifier {
                                            println!("Verifier found, length: {}", verifier.len());
                                            // Emit callback event to frontend
                                            let response = GoogleCallbackResponse {
                                                code: code.clone(),
                                                state: callback_state.clone(),
                                                verifier: verifier.clone(),
                                            };
                                            println!("Emitting google-oauth-callback event with code: {}..., state: {}, verifier length: {}", 
                                                &code.chars().take(10).collect::<String>(), 
                                                &response.state, 
                                                response.verifier.len());
                                            match app.emit("google-oauth-callback", &response) {
                                                Ok(_) => println!("Successfully emitted google-oauth-callback event"),
                                                Err(e) => eprintln!("Failed to emit callback event: {}", e),
                                            }
                                            
                                            // Return success page
                                            let html = r#"
                                                <!DOCTYPE html>
                                                <html>
                                                <head><title>Authentication Successful</title></head>
                                                <body>
                                                    <h1>Authentication Successful!</h1>
                                                    <p>You can close this window and return to the application.</p>
                                                    <script>setTimeout(() => window.close(), 2000);</script>
                                                </body>
                                                </html>
                                            "#;
                                            Ok::<_, hyper::Error>(Response::builder()
                                                .status(StatusCode::OK)
                                                .header("Content-Type", "text/html")
                                                .body(Full::new(Bytes::from(html)))
                                                .unwrap())
                                        } else {
                                            eprintln!("Verifier not found for state: {}", callback_state);
                                            Ok::<_, hyper::Error>(Response::builder()
                                                .status(StatusCode::BAD_REQUEST)
                                                .body(Full::new(Bytes::from("Invalid state parameter")))
                                                .unwrap())
                                        }
                                    } else {
                                        eprintln!("Failed to access OAuth state");
                                        Ok::<_, hyper::Error>(Response::builder()
                                            .status(StatusCode::INTERNAL_SERVER_ERROR)
                                            .body(Full::new(Bytes::from("Internal server error")))
                                            .unwrap())
                                    }
                                } else {
                                    // No code or state in query
                                    Ok::<_, hyper::Error>(Response::builder()
                                        .status(StatusCode::BAD_REQUEST)
                                        .body(Full::new(Bytes::from("Missing code or state parameter")))
                                        .unwrap())
                                }
                            } else {
                                // 404 for other paths
                                Ok::<_, hyper::Error>(Response::builder()
                                    .status(StatusCode::NOT_FOUND)
                                    .body(Full::new(Bytes::from("Not found")))
                                    .unwrap())
                            }
                        }
                    });
                    
                    // Handle the connection
                    if let Err(err) = http1::Builder::new()
                        .serve_connection(io, service)
                        .await
                    {
                        eprintln!("Error serving OAuth callback: {:?}", err);
                    }
                }
                Err(e) => {
                    eprintln!("Failed to accept OAuth callback connection: {}", e);
                    let _ = app.emit("oauth-error", format!("Failed to accept connection: {}", e));
                }
            }
        } else {
            eprintln!("Failed to bind to any OAuth callback port");
            let _ = app.emit("oauth-error", "Failed to start OAuth callback server");
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
    
    // Start listening for OAuth callback
    start_oauth_callback_server(app);
    
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

