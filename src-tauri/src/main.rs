// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// This is the main entry point for the Lexi AI Tauri application.
// The application provides a voice-to-text overlay that:
// 1. Listens for Function key (fn) press/release to start/stop audio recording
// 2. Captures audio from the default microphone
// 3. Transcribes the audio using Lexi AI Server (which uses Groq's Whisper API)
// 4. Injects the transcribed text into the currently active application

use std::sync::mpsc;
use std::thread;
use std::sync::Mutex;
use std::collections::HashMap;

use tauri::{AppHandle, Manager, Emitter, State};
use serde::{Deserialize, Serialize};

// Module declarations for core functionality
mod audio_recorder;  // Handles audio capture from microphone
mod stt_service;     // Communicates with Groq API for speech-to-text transcription
mod text_injector;   // Injects transcribed text into active application
mod global_key_listener;  // Handles global keyboard event listening via rdev
mod permissions;     // Handles permission requests for microphone, input monitoring, and accessibility
mod pill;           // Handles pill overlay window management
mod cursor_context;  // Handles cursor context retrieval using macOS Accessibility API

use audio_recorder::AudioRecorder;
use stt_service::SttService;
use text_injector::TextInjector;

use permissions::{
    request_accessibility_permission,
    request_input_monitoring_permission,
    request_microphone_permission,
    check_accessibility_permission,
    check_input_monitoring_permission,
    check_microphone_permission,
};

/// Inject text into the currently active application
/// 
/// This command allows the frontend to directly inject text into any active application.
/// It uses the cross-platform TextInjector implementation which:
/// 1. Copies text to the clipboard
/// 2. Simulates a paste keystroke (Cmd+V on macOS, Ctrl+V elsewhere)
/// 
/// # Arguments
/// * `text` - The text to inject
/// 
/// # Returns
/// * `Ok(())` - Successfully injected the text
/// * `Err(String)` - An error message if injection failed
#[tauri::command]
fn inject_text(text: String) -> Result<(), String> {
    let injector = TextInjector::new();
    injector
        .inject_text(&text)
        .map_err(|e| format!("Injection failed: {}", e))
}

// Re-export pill functions as Tauri commands
#[tauri::command]
fn show_pill_window(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    pill::show_pill_window(app, x, y)
}

#[tauri::command]
fn toggle_pill_window(app: AppHandle) -> Result<(), String> {
    pill::toggle_pill_window(app)
}

// OAuth state management
#[derive(Default)]
struct OAuthState {
    verifiers: Mutex<HashMap<String, String>>, // state -> verifier mapping
}

#[derive(Serialize, Deserialize)]
struct PkceChallenge {
    challenge: String,
    verifier: String,
    state: String,
    auth_url: String,
}

#[derive(Serialize, Deserialize)]
struct GoogleCallbackResponse {
    code: String,
    state: String,
    verifier: String,
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
async fn start_google_login(
    app: AppHandle,
    state: State<'_, OAuthState>,
    client_id: String,
) -> Result<PkceChallenge, String> {
    use sha2::{Sha256, Digest};
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    
    // Generate PKCE verifier (43-128 characters, URL-safe)
    let verifier = {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..64).map(|_| rng.gen()).collect();
        URL_SAFE_NO_PAD.encode(&bytes)
    };
    
    // Generate challenge (SHA256 hash of verifier, base64url encoded)
    let challenge = {
        let mut hasher = Sha256::new();
        hasher.update(verifier.as_bytes());
        let hash = hasher.finalize();
        URL_SAFE_NO_PAD.encode(hash)
    };
    
    // Generate state for CSRF protection
    let oauth_state = {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
        URL_SAFE_NO_PAD.encode(&bytes)
    };
    
    // Store verifier with state as key
    {
        let mut verifiers = state.verifiers.lock().unwrap();
        verifiers.insert(oauth_state.clone(), verifier.clone());
    }
    
    // Build Google OAuth URL with localhost redirect
    let redirect_uri = "http://127.0.0.1:8000";
    let scopes = "openid email profile";
    let auth_url = format!(
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
        urlencoding::encode(&client_id),
        urlencoding::encode(redirect_uri),
        urlencoding::encode(scopes),
        urlencoding::encode(&oauth_state),
        urlencoding::encode(&challenge)
    );
    
    // Open browser using std::process::Command (cross-platform)
    let app_clone_for_shell = app.clone();
    let auth_url_clone = auth_url.clone();
    tauri::async_runtime::spawn(async move {
        use std::process::Command;
        let result = {
            #[cfg(target_os = "macos")]
            {
                Command::new("open").arg(&auth_url_clone).spawn()
            }
            #[cfg(target_os = "windows")]
            {
                Command::new("cmd").args(["/C", "start", &auth_url_clone]).spawn()
            }
            #[cfg(target_os = "linux")]
            {
                Command::new("xdg-open").arg(&auth_url_clone).spawn()
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "Unsupported platform"))
            }
        };
        
        if let Err(e) = result {
            eprintln!("Failed to open browser: {}", e);
            // Emit error to frontend
            let _ = app_clone_for_shell.emit("oauth-error", format!("Failed to open browser: {}", e));
        }
    });
    
    // Start listening for OAuth callback using a manual HTTP server
    let app_clone = app.clone();
    
    tauri::async_runtime::spawn(async move {
        use hyper::server::conn::http1;
        use hyper::service::service_fn;
        use hyper_util::rt::TokioIo;
        use tokio::net::TcpListener;
        use http_body_util::Full;
        use hyper::body::Bytes;
        use hyper::{Request, Response, StatusCode};
        
        // Try ports in order: 8000, 8001, 8002
        let ports = vec![8000u16, 8001, 8002];
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
                    let app_for_service = app_clone.clone();
                    
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
                    let _ = app_clone.emit("oauth-error", format!("Failed to accept connection: {}", e));
                }
            }
        } else {
            eprintln!("Failed to bind to any OAuth callback port");
            let _ = app_clone.emit("oauth-error", "Failed to start OAuth callback server");
        }
    });
    
    Ok(PkceChallenge {
        challenge,
        verifier,
        state: oauth_state,
        auth_url,
    })
}

/// Get PKCE verifier for a given state
#[tauri::command]
fn get_pkce_verifier(
    state: State<'_, OAuthState>,
    oauth_state: String,
) -> Option<String> {
    let verifiers = state.verifiers.lock().unwrap();
    verifiers.get(&oauth_state).cloned()
}

/// Processes recorded audio data by:
/// 1. Sending it to the speech-to-text API for transcription
/// 2. Injecting the transcribed text into the active application
/// 3. Emitting events to the frontend to update UI state
/// 
/// This function runs in a separate thread to avoid blocking the main thread.
/// It creates a new Tokio runtime since it's called from a non-async context.
fn process_audio(audio_data: Vec<u8>, app_handle: AppHandle) {
    thread::spawn(move || {
        // Create a new Tokio runtime for async operations
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            println!("Processing audio, size: {} bytes", audio_data.len());
            
            // Notify frontend that transcription has started
            app_handle.emit("processing_start", ()).unwrap_or_default();
            
            // Initialize the STT service client and transcribe the audio
            let stt_service = SttService::new();
            match stt_service.transcribe_audio(audio_data).await {
                Ok(transcription) => {
                    println!("Transcription: {}", transcription);
                    
                    // Notify frontend of successful transcription
                    app_handle.emit("transcription_success", &transcription).unwrap_or_default();
                    
                    // Only inject text if transcription is not empty
                    if !transcription.trim().is_empty() {
                        let injector = TextInjector::new();
                        match injector.inject_text(&transcription) {
                            Ok(_) => {
                                // Successfully injected text into active application
                                app_handle.emit("injection_success", ()).unwrap_or_default();
                            }
                            Err(e) => {
                                eprintln!("Failed to inject text: {}", e);
                                // Notify frontend of injection failure
                                app_handle.emit("injection_error", e.to_string()).unwrap_or_default();
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Transcription failed: {}", e);
                    // Notify frontend of transcription failure
                    app_handle.emit("transcription_error", e.to_string()).unwrap_or_default();
                }
            }
        });
    });
}

/// Main entry point for the Tauri application
/// 
/// Sets up the application window, configures macOS-specific window behavior,
/// and registers global shortcuts for Function key (fn) presses/releases
/// to control audio recording.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(OAuthState::default())
        .invoke_handler(tauri::generate_handler![
            request_microphone_permission,
            request_input_monitoring_permission,
            request_accessibility_permission,
            check_microphone_permission,
            check_input_monitoring_permission,
            check_accessibility_permission,
            inject_text,
            show_pill_window,
            toggle_pill_window,
            start_google_login,
            get_pkce_verifier
        ])
        .setup(move |app| {
            // CRITICAL FIX FOR MACOS FLOATING WINDOWS
            // This policy allows the app to have accessory windows (like the pill)
            // that float above all spaces and do not clutter the Dock/App Switcher.
            // Must be set before getting the app handle to avoid borrow checker issues.
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                println!("🍎 Set macOS activation policy to Accessory (app will not appear in Dock)");
            }
            
            let app_handle = app.handle();
            
            // Initialize and position the pill window at the center of the screen
            // The window is created dynamically in Rust but shown at app startup
            if let Err(e) = pill::init_pill_window(app_handle.clone()) {
                eprintln!("Failed to initialize pill window: {}", e);
            }
            
            // Channel to communicate with the recording thread
            // Sender is used by key listener to signal start/stop, receiver is used in the recording thread
            let (recording_tx, recording_rx) = mpsc::channel::<bool>(); // true = start, false = stop
            
            // Start the global input listener (rdev) in a background thread
            // Pass the channel sender so it can trigger recording on Function key press/release
            global_key_listener::start_listener(app_handle.clone(), recording_tx);

            let window = app.get_webview_window("main").unwrap();
            
            // Prevent the app from closing when window is closed
            // This keeps the global shortcut monitoring active
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Hide the window instead of closing it
                    // This keeps the app running in the background so hotkeys continue to work
                    api.prevent_close();
                    if let Err(e) = window_clone.hide() {
                        eprintln!("Failed to hide window: {}", e);
                    } else {
                        println!("Window hidden - app continues running in background. Hotkeys will still work.");
                    }
                }
            });
            
            #[cfg(desktop)]
            {
                // Spawn a dedicated thread to manage the audio recorder
                // This thread will handle creating, starting, and stopping the recorder
                // It receives signals from the global key listener via the channel
                let app_handle_for_recording = app_handle.clone();
                thread::spawn(move || {
                    let mut recorder: Option<AudioRecorder> = None;
                    
                    loop {
                        match recording_rx.recv() {
                            Ok(true) => {
                                // Start recording (Function key pressed)
                                if recorder.is_none() {
                                    println!("Function key (fn) pressed - Starting recording in dedicated thread...");
                                    
                                    // Show the pill window when recording starts (it's already created at startup)
                                    if let Some(pill_window) = app_handle_for_recording.get_webview_window("pill") {
                                        if let Err(e) = pill_window.show() {
                                            eprintln!("Failed to show pill window: {}", e);
                                        }
                                    }
                                    
                                    let mut new_recorder = AudioRecorder::new();
                                    match new_recorder.start_recording() {
                                        Ok(_) => {
                                            recorder = Some(new_recorder);
                                            app_handle_for_recording.emit("recording_started", ()).unwrap_or_default();
                                        }
                                        Err(e) => {
                                            eprintln!("Failed to start recording: {}", e);
                                            app_handle_for_recording.emit("recording_error", e.to_string()).unwrap_or_default();
                                        }
                                    }
                                }
                            }
                            Ok(false) => {
                                // Stop recording (Function key released)
                                if let Some(mut rec) = recorder.take() {
                                    println!("Function key (fn) released - Stopping recording in dedicated thread...");
                                    
                                    match rec.stop_recording() {
                                        Ok(audio_data) => {
                                            app_handle_for_recording.emit("recording_stopped", ()).unwrap_or_default();
                                            // Process the audio in a separate thread
                                            process_audio(audio_data, app_handle_for_recording.clone());
                                        }
                                        Err(e) => {
                                            eprintln!("Failed to stop recording: {}", e);
                                            app_handle_for_recording.emit("recording_error", e.to_string()).unwrap_or_default();
                                        }
                                    }
                                }
                            }
                            Err(_) => {
                                // Channel closed, exit thread
                                break;
                            }
                        }
                    }
                });
            }
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}