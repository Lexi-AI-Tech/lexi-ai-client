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
    pub transcript: Option<String>,
    #[serde(rename = "is_final")]
    pub is_final: Option<bool>,
    pub words: Option<Vec<serde_json::Value>>,
    pub speaker: Option<u32>,
    pub message: Option<String>, // For error messages
}

pub struct RoomWebSocket {
    app: AppHandle,
    room_id: String,
    jwt_token: String,
    pub audio_tx: Arc<Mutex<Option<mpsc::Sender<Vec<u8>>>>>,
    is_connected: Arc<Mutex<bool>>,
}

impl RoomWebSocket {
    pub fn new(app: AppHandle, room_id: String, jwt_token: String) -> Self {
        Self {
            app,
            room_id,
            jwt_token,
            audio_tx: Arc::new(Mutex::new(None)),
            is_connected: Arc::new(Mutex::new(false)),
        }
    }

    pub async fn connect(&mut self) -> Result<(), String> {
        let api_base_url = crate::config::api_base_url();
        let ws_base_url = api_base_url
            .replace("http://", "ws://")
            .replace("https://", "wss://");
        let ws_url = format!(
            "{}/api/v1/rooms/{}/stream?token={}",
            ws_base_url, self.room_id, self.jwt_token
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
        tokio::spawn(async move {
            while let Some(chunk) = audio_rx.recv().await {
                if let Err(e) = write.send(Message::Binary(chunk)).await {
                    eprintln!("Failed to send audio chunk: {}", e);
                    break;
                }
            }
        });

        // Spawn task to receive transcript messages
        let app = self.app.clone();
        let is_connected_clone = Arc::clone(&is_connected);
        tokio::spawn(async move {
            loop {
                match read.next().await {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(msg) = serde_json::from_str::<TranscriptMessage>(&text) {
                            // Emit transcript event to frontend
                            if let Err(e) = app.emit("room-transcript", &msg) {
                                eprintln!("Failed to emit transcript: {}", e);
                            }
                        } else {
                            eprintln!("Failed to parse transcript message: {}", text);
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
