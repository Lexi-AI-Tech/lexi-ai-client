//! WebSocket Module
//!
//! Handles WebSocket connections for OAuth flow.
//! Listens for OAuth completion notifications and emits Tauri events to the frontend.

use crate::commands::app_config;
use crate::secure_storage::{self, AuthData, UserData};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use tokio::time::{sleep, Duration};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Debug, Serialize, Deserialize)]
struct WebSocketMessage {
    #[serde(rename = "type")]
    message_type: Option<String>,
    status: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    user: Option<UserData>,
    error: Option<String>,
}

/// Active WebSocket connection state
struct WebSocketState {
    cancel_tx: Option<oneshot::Sender<()>>,
}

use std::sync::OnceLock;

static WEBSOCKET_STATE: OnceLock<Arc<Mutex<Option<WebSocketState>>>> = OnceLock::new();

fn get_websocket_state() -> &'static Arc<Mutex<Option<WebSocketState>>> {
    WEBSOCKET_STATE.get_or_init(|| Arc::new(Mutex::new(None)))
}

/// Start WebSocket connection for OAuth flow
///
/// Connects to the OAuth WebSocket endpoint and listens for completion messages.
/// Emits Tauri events when OAuth completes or errors occur.
///
/// # Arguments
/// * `app` - The Tauri AppHandle
/// * `state` - OAuth state parameter for WebSocket authentication
///
/// # Returns
/// * `Result<(), String>` - Ok if connection started successfully
#[tauri::command]
pub async fn start_oauth_websocket(app: AppHandle, state: String) -> Result<(), String> {
    // Check if there's already an active connection
    {
        let ws_state = get_websocket_state().lock().unwrap();
        if ws_state.is_some() {
            return Err("WebSocket connection already active".to_string());
        }
    }

    // Build WebSocket URL
    let base_url = crate::config::api_base_url();
    let ws_base_url = base_url
        .replace("https://", "wss://")
        .replace("http://", "ws://");
    let ws_url = format!(
        "{}/api/v1/auth/ws/auth/{}",
        ws_base_url,
        urlencoding::encode(&state)
    );

    println!("🔌 Connecting to WebSocket: {}", ws_url);

    // Create cancellation channel
    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();

    // Store cancel sender
    {
        let mut ws_state = get_websocket_state().lock().unwrap();
        *ws_state = Some(WebSocketState {
            cancel_tx: Some(cancel_tx),
        });
    }

    let app_clone = app.clone();
    let app_for_timeout = app.clone();
    let state_mutex = get_websocket_state().clone();

    // Spawn WebSocket connection task
    tokio::spawn(async move {
        // Set up timeout (5 minutes)
        let timeout_duration = Duration::from_secs(5 * 60);
        let timeout_task = tokio::spawn(async move {
            sleep(timeout_duration).await;
            println!("⏱️  OAuth WebSocket timeout");
            app_for_timeout
                .emit("oauth-timeout", "Authentication timed out")
                .unwrap_or_default();
        });

        // Connect to WebSocket
        let ws_result = connect_async(&ws_url).await;

        match ws_result {
            Ok((ws_stream, _)) => {
                println!("✅ WebSocket connected, waiting for OAuth completion");

                let (mut _write, mut read) = ws_stream.split();

                // Listen for messages or cancellation
                loop {
                    tokio::select! {
                        // Check for cancellation
                        _ = &mut cancel_rx => {
                            println!("🛑 WebSocket connection cancelled");
                            timeout_task.abort();
                            break;
                        }
                        // Read WebSocket message
                        msg = read.next() => {
                            match msg {
                                Some(Ok(Message::Text(text))) => {
                                    println!("📨 Received WebSocket message: {}", text);

                                    match serde_json::from_str::<WebSocketMessage>(&text) {
                                        Ok(data) => {
                                            // Handle pong response (heartbeat)
                                            if data.message_type.as_deref() == Some("pong") {
                                                continue;
                                            }

                                            // Handle authentication completion
                                            if data.status.as_deref() == Some("completed") {
                                                if let (Some(access_token), Some(user)) = (data.access_token, data.user) {
                                                    println!("✅ OAuth completed, tokens received via WebSocket");

                                                    let expires_at = crate::commands::auth::get_jwt_exp_claim(&access_token)
                                                        .or_else(|| {
                                                            data.expires_in.map(|expires_in| {
                                                                std::time::SystemTime::now()
                                                                    .duration_since(std::time::UNIX_EPOCH)
                                                                    .unwrap()
                                                                    .as_secs()
                                                                    + expires_in
                                                            })
                                                        });

                                                    // Store auth data
                                                    let auth_data = AuthData {
                                                        access_token: access_token.clone(),
                                                        refresh_token: data.refresh_token,
                                                        expires_at,
                                                        expires_in: data.expires_in,
                                                        user: Some(user.clone()),
                                                    };

                                                    if let Err(e) = secure_storage::store_auth_data(&app_clone, &auth_data) {
                                                        eprintln!("⚠️  Failed to store auth data: {}", e);
                                                        app_clone
                                                            .emit("oauth-error", "Failed to store authentication data")
                                                            .unwrap_or_default();
                                                    } else {
                                                        // Fetch app config from server (first time after login)
                                                        match app_config::fetch_config_from_server(&app_clone).await {
                                                            Ok(mut config) => {
                                                                println!("✅ App config fetched and synced after login");
                                                                app_config::sync_autostart_status(&app_clone, &mut config);
                                                            }
                                                            Err(e) => {
                                                                eprintln!("⚠️  Failed to fetch app config after login: {}", e);
                                                            }
                                                        }
                                                        // Emit success event with user data
                                                        app_clone
                                                            .emit("oauth-completed", &user)
                                                            .unwrap_or_default();
                                                    }

                                                    // Cancel timeout
                                                    timeout_task.abort();
                                                    break;
                                                }
                                            } else if data.status.as_deref() == Some("error") {
                                                // Handle authentication error
                                                let error_msg = data.error.unwrap_or_else(|| "Authentication failed".to_string());
                                                println!("❌ OAuth error received via WebSocket: {}", error_msg);

                                                app_clone
                                                    .emit("oauth-error", &error_msg)
                                                    .unwrap_or_default();

                                                // Cancel timeout
                                                timeout_task.abort();
                                                break;
                                            } else {
                                                println!("⚠️  Unexpected WebSocket message: {:?}", data);
                                            }
                                        }
                                        Err(e) => {
                                            eprintln!("⚠️  Failed to parse WebSocket message: {}", e);
                                        }
                                    }
                                }
                                Some(Ok(Message::Close(_))) => {
                                    println!("🔌 WebSocket closed by server");
                                    timeout_task.abort();
                                    break;
                                }
                                Some(Err(e)) => {
                                    eprintln!("⚠️  WebSocket error: {}", e);
                                    app_clone
                                        .emit("oauth-error", &format!("WebSocket error: {}", e))
                                        .unwrap_or_default();
                                    timeout_task.abort();
                                    break;
                                }
                                None => {
                                    println!("🔌 WebSocket connection closed");
                                    timeout_task.abort();
                                    break;
                                }
                                _ => {
                                    // Ignore other message types (binary, ping, pong)
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("❌ Failed to connect to WebSocket: {}", e);
                app_clone
                    .emit(
                        "oauth-error",
                        &format!("Failed to connect to WebSocket: {}", e),
                    )
                    .unwrap_or_default();
            }
        }

        // Clean up state
        let mut ws_state = state_mutex.lock().unwrap();
        *ws_state = None;
    });

    Ok(())
}

/// Stop WebSocket connection for OAuth flow
///
/// Cancels the active WebSocket connection if one exists.
///
/// # Returns
/// * `Result<(), String>` - Ok if connection was stopped (or didn't exist)
#[tauri::command]
pub async fn stop_oauth_websocket() -> Result<(), String> {
    let mut ws_state = get_websocket_state().lock().unwrap();

    if let Some(state) = ws_state.take() {
        if let Some(cancel_tx) = state.cancel_tx {
            let _ = cancel_tx.send(());
            println!("🛑 WebSocket connection stopped");
        }
    }

    Ok(())
}
