//! Room WebSocket Streaming Module
//!
//! Handles WebSocket connection to server for real-time transcription.
//! Manages audio streaming and receives transcript updates.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub text: Option<String>,
    #[serde(rename = "starttime")]
    pub start_time: Option<f64>,
    #[serde(rename = "endtime")]
    pub end_time: Option<f64>,
    pub speaker: Option<u32>,
    pub message: Option<String>, // For error messages
}

pub struct RoomWebSocket {
    app: AppHandle,
    room_id: String,
    jwt_token: String,
    language: String,
    pub audio_tx: Arc<Mutex<Option<mpsc::Sender<Vec<u8>>>>>,
    is_connected: Arc<Mutex<bool>>,
}

impl RoomWebSocket {
    pub fn new(app: AppHandle, room_id: String, jwt_token: String, language: String) -> Self {
        Self {
            app,
            room_id,
            jwt_token,
            language,
            audio_tx: Arc::new(Mutex::new(None)),
            is_connected: Arc::new(Mutex::new(false)),
        }
    }

    pub async fn connect(&mut self) -> Result<(), String> {
        use urlencoding::encode;
        
        let api_base_url = crate::config::api_base_url();
        let ws_base_url = api_base_url
            .replace("http://", "ws://")
            .replace("https://", "wss://");
        let ws_url = format!(
            "{}/api/v1/rooms/{}/stream?token={}&language={}",
            ws_base_url, 
            self.room_id, 
            encode(&self.jwt_token),
            encode(&self.language)
        );

        let url = ws_url
            .parse::<tokio_tungstenite::tungstenite::http::Uri>()
            .map_err(|e| format!("Invalid WebSocket URL: {}", e))?;

        // Connect to WebSocket
        let (ws_stream, _) = connect_async(url)
            .await
            .map_err(|e| format!("Failed to connect to WebSocket: {}", e))?;

        let (mut write, mut read) = ws_stream.split();

        // Create channel for audio chunks
        let (audio_tx, mut audio_rx) = mpsc::channel::<Vec<u8>>(100);
        *self.audio_tx.lock().unwrap() = Some(audio_tx);

        let is_connected = Arc::clone(&self.is_connected);
        *is_connected.lock().unwrap() = true;

        // Spawn task to send audio chunks
        let mut total_chunks = 0;
        let mut total_bytes = 0;
        tokio::spawn(async move {
            while let Some(chunk) = audio_rx.recv().await {
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
            println!("📤 Audio sending complete. Total: {} chunks, {} bytes", total_chunks, total_bytes);
        });

        // Spawn task to receive transcript messages
        let app = self.app.clone();
        let is_connected_clone = Arc::clone(&is_connected);
        let mut transcript_count = 0;
        tokio::spawn(async move {
            loop {
                match read.next().await {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(msg) = serde_json::from_str::<TranscriptMessage>(&text) {
                            transcript_count += 1;
                            if let Some(ref transcript_text) = msg.text {
                                // Safely truncate to 50 characters (not bytes) to avoid panicking on Unicode
                                let preview: String = transcript_text
                                    .chars()
                                    .take(50)
                                    .collect();
                                println!("📝 Received transcript #{}: speaker={}, text='{}'", 
                                    transcript_count, 
                                    msg.speaker.unwrap_or(0),
                                    preview
                                );
                            }
                            // Emit transcript event to frontend
                            // Log what we're emitting for debugging
                            println!("📤 Emitting transcript to frontend: msg_type={}, text={:?}, speaker={:?}, start_time={:?}, end_time={:?}", 
                                msg.msg_type,
                                msg.text.as_ref().map(|t| {
                                    let preview: String = t.chars().take(30).collect();
                                    preview
                                }),
                                msg.speaker,
                                msg.start_time,
                                msg.end_time
                            );
                            if let Err(e) = app.emit("room-transcript", &msg) {
                                eprintln!("❌ Failed to emit transcript: {}", e);
                            }
                        } else {
                            eprintln!("⚠️ Failed to parse transcript message: {}", text);
                        }
                    }
                    Some(Ok(Message::Close(_))) => {
                        println!("WebSocket closed by server");
                        break;
                    }
                    Some(Err(e)) => {
                        eprintln!("WebSocket error: {}", e);
                        let _ = app.emit("room-websocket-error", format!("{}", e));
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

    pub fn send_audio_chunk(&self, chunk: Vec<u8>) -> Result<(), String> {
        if let Some(ref tx) = *self.audio_tx.lock().unwrap() {
            tx.try_send(chunk)
                .map_err(|e| format!("Failed to send audio chunk: {}", e))?;
            Ok(())
        } else {
            Err("WebSocket not connected".to_string())
        }
    }

    pub fn is_connected(&self) -> bool {
        *self.is_connected.lock().unwrap()
    }

    pub fn close(&mut self) {
        *self.is_connected.lock().unwrap() = false;
        *self.audio_tx.lock().unwrap() = None;
    }
}
