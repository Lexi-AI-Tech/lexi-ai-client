//! Room WebSocket Streaming Module
//!
//! Connects to the Rooms streaming endpoint and forwards raw audio bytes (PCM16 LE)
//! while emitting transcript events to the frontend.

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
    is_connected: Arc<Mutex<bool>>,
    pub ready_rx: Arc<Mutex<Option<tokio::sync::oneshot::Receiver<()>>>>,
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

        let (ws_stream, _) = connect_async(request)
            .await
            .map_err(|e| format!("Failed to connect to WebSocket: {}", e))?;

        let (mut write, mut read) = ws_stream.split();

        let (audio_tx, mut audio_rx) = mpsc::channel::<Vec<u8>>(100);
        *self.audio_tx.lock().unwrap() = Some(audio_tx);

        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        *self.ready_rx.lock().unwrap() = Some(ready_rx);

        let is_connected = Arc::clone(&self.is_connected);
        *is_connected.lock().unwrap() = true;

        // Sender: forward audio chunks to server as Binary frames.
        tokio::spawn(async move {
            while let Some(chunk) = audio_rx.recv().await {
                if let Err(e) = write.send(Message::Binary(chunk)).await {
                    eprintln!("❌ Failed to send room audio chunk: {}", e);
                    break;
                }
            }
            let _ = write.send(Message::Close(None)).await;
        });

        // Receiver: emit transcripts + ready signal.
        let app = self.app.clone();
        let is_connected_clone = Arc::clone(&self.is_connected);
        let mut ready_tx_for_handler = Some(ready_tx);
        tokio::spawn(async move {
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                            if server_msg.msg_type == "ready" {
                                if let Some(tx) = ready_tx_for_handler.take() {
                                    let _ = tx.send(());
                                }
                                let _ = app.emit("room-websocket-ready", ());
                                continue;
                            }
                        }
                        if let Ok(tmsg) = serde_json::from_str::<TranscriptMessage>(&text) {
                            let _ = app.emit("room-transcript", &tmsg);
                        }
                    }
                    Ok(Message::Close(_)) => break,
                    Ok(_) => {}
                    Err(e) => {
                        let _ = app.emit("room-websocket-error", format!("{}", e));
                        break;
                    }
                }
            }
            *is_connected_clone.lock().unwrap() = false;
        });

        Ok(())
    }
}

