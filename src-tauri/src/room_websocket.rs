//! Room WebSocket Streaming Module
//!
//! Handles WebSocket connection to server for real-time transcription.
//! Manages audio streaming and receives transcript updates.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub text: Option<String>,
    #[serde(rename = "start_time")]
    pub start_time: Option<String>,
    #[serde(rename = "end_time")]
    pub end_time: Option<String>,
    #[serde(rename = "speaker_id")]
    pub speaker_id: Option<u32>,
    /// message_type: "user_audio" (mic, right), "system_audio" (system, left), "user_note" (typed note).
    #[serde(rename = "message_type")]
    pub message_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub message: Option<String>,
}

pub struct RoomWebSocket {
    app: AppHandle,
    room_id: String,
    jwt_token: String,
    language: String,
    pub audio_tx: Arc<Mutex<Option<mpsc::Sender<Vec<u8>>>>>,
    pub text_tx: Arc<Mutex<Option<mpsc::Sender<String>>>>, // For sending text messages (like end_recording)
    is_connected: Arc<Mutex<bool>>,
    pub ready_rx: Arc<Mutex<Option<tokio::sync::oneshot::Receiver<()>>>>, // Receive signal when server is ready
}

impl RoomWebSocket {
    pub fn new(app: AppHandle, room_id: String, jwt_token: String, language: String) -> Self {
        Self {
            app,
            room_id,
            jwt_token,
            language,
            audio_tx: Arc::new(Mutex::new(None)),
            text_tx: Arc::new(Mutex::new(None)),
            is_connected: Arc::new(Mutex::new(false)),
            ready_rx: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn connect(&mut self) -> Result<(), String> {
        use urlencoding::encode;

        let api_base_url = crate::config::api_base_url();
        let ws_base_url = api_base_url
            .replace("http://", "ws://")
            .replace("https://", "wss://");
        let ws_url = format!(
            "{}/api/v1/rooms/{}/stream?language={}",
            ws_base_url,
            self.room_id,
            encode(&self.language)
        );

        let mut request = ws_url
            .into_client_request()
            .map_err(|e| format!("Invalid WebSocket URL: {}", e))?;
        request.headers_mut().insert(
            "Authorization",
            format!("Bearer {}", self.jwt_token).parse().unwrap(),
        );

        // Connect to WebSocket
        let (ws_stream, _) = connect_async(request)
            .await
            .map_err(|e| format!("Failed to connect to WebSocket: {}", e))?;

        let (mut write, mut read) = ws_stream.split();

        // Create channels
        let (audio_tx, mut audio_rx) = mpsc::channel::<Vec<u8>>(100);
        let (text_tx, mut text_rx) = mpsc::channel::<String>(10);
        *self.audio_tx.lock().unwrap() = Some(audio_tx);
        *self.text_tx.lock().unwrap() = Some(text_tx);

        // Create ready signal channel
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        *self.ready_rx.lock().unwrap() = Some(ready_rx);

        let is_connected = Arc::clone(&self.is_connected);
        *is_connected.lock().unwrap() = true;

        // Spawn task to send messages (audio chunks and text messages)
        let mut total_chunks = 0;
        let mut total_bytes = 0;
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    // Send audio chunks
                    Some(chunk) = audio_rx.recv() => {
                        total_chunks += 1;
                        total_bytes += chunk.len();
                        if total_chunks % 100 == 0 {
                            println!("📤 Sent {} audio chunks, total {} bytes to server", total_chunks, total_bytes);
                        }
                        if let Err(e) = write.send(Message::Binary(chunk)).await {
                            eprintln!("❌ Failed to send audio chunk: {}", e);
                            break;
                        }
                    }
                    // Send text messages (like end_recording)
                    Some(text) = text_rx.recv() => {
                        println!("📤 Sending text message to server: {}", text);
                        if let Err(e) = write.send(Message::Text(text)).await {
                            eprintln!("❌ Failed to send text message: {}", e);
                            break;
                        }
                    }
                    else => {
                        println!("📤 Audio/text sending complete. Total: {} chunks, {} bytes", total_chunks, total_bytes);
                        break;
                    }
                }
            }
        });

        // Spawn task to receive messages from server
        let app = self.app.clone();
        let is_connected_clone = Arc::clone(&self.is_connected);
        let mut ready_tx_for_handler = Some(ready_tx);
        let mut transcript_count = 0;
        tokio::spawn(async move {
            loop {
                match read.next().await {
                    Some(Ok(Message::Text(text))) => {
                        // Try to parse as server control message first
                        if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                            if server_msg.msg_type == "ready" {
                                println!("✅ Received 'ready' signal from server");
                                // Signal that server is ready (only once)
                                if let Some(tx) = ready_tx_for_handler.take() {
                                    let _ = tx.send(());
                                }
                                // Emit event to frontend
                                let app_clone = app.clone();
                                tauri::async_runtime::spawn(async move {
                                    let _ = app_clone.emit("room-websocket-ready", ());
                                });
                                continue;
                            }
                        }

                        // Try to parse as transcript message
                        if let Ok(msg) = serde_json::from_str::<TranscriptMessage>(&text) {
                            transcript_count += 1;
                            println!(
                                "📝 Received transcript #{}: speaker={}, text={:?}",
                                transcript_count,
                                msg.speaker_id.unwrap_or(0),
                                msg.text
                            );

                            // Debug: Print what we're about to emit
                            if let Ok(json_str) = serde_json::to_string(&msg) {
                                println!("📤 Emitting to frontend: {}", json_str);
                            }

                            let app_clone = app.clone();
                            tauri::async_runtime::spawn(async move {
                                match app_clone.emit("room-transcript", &msg) {
                                    Ok(_) => {
                                        println!("✅ Successfully emitted 'room-transcript' event to frontend");
                                    }
                                    Err(e) => {
                                        eprintln!("❌ Failed to emit transcript: {}", e);
                                    }
                                }
                            });
                        } else {
                            eprintln!("⚠️ Failed to parse message: {}", text);
                        }
                    }
                    Some(Ok(Message::Close(_))) => {
                        println!("WebSocket closed by server");
                        break;
                    }
                    Some(Err(e)) => {
                        let app_clone = app.clone();
                        let error_msg = format!("{}", e);
                        tauri::async_runtime::spawn(async move {
                            let _ = app_clone.emit("room-websocket-error", error_msg);
                        });
                        break;
                    }
                    None => break,
                    _ => {}
                }
            }
            *is_connected_clone.lock().unwrap() = false;
        });

        Ok(())
    }
}
