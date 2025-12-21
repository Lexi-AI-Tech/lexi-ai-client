//! Speech-to-Text (STT) Service Module
//!
//! This module handles communication with the Lexi AI Server for speech-to-text transcription.
//! It sends WAV audio data to the server API endpoint via HTTP multipart form requests.
//!
//! ## Architecture
//!
//! The client sends audio to the Lexi AI Server, which handles the Groq Whisper API integration
//! internally. This means:
//! - No Groq API key is needed in the client
//! - Authentication is handled via Bearer token (JWT) in the Authorization header
//! - The server manages API rate limiting, retries, and error handling
//!
//! ## Request/Response Format
//!
//! - **Request**: Multipart form data with WAV audio file
//! - **Response**: JSON object with `{"text": "transcribed text here"}`
//!
//! ## Features
//!
//! - **Cancellation Support**: HTTP requests can be cancelled via tokio oneshot channel
//! - **Error Handling**: Comprehensive error messages for debugging
//! - **Debug Logging**: Detailed logging of request/response for troubleshooting

use std::error::Error;
use reqwest::multipart;
use tokio::sync::oneshot;
use crate::config;

/// STT (Speech-to-Text) Service client for transcribing audio using Lexi AI Server
/// 
/// This struct manages HTTP requests to the Lexi AI Server endpoint for speech-to-text conversion.
/// The server handles the Groq API integration internally.
pub struct SttService {
    client: reqwest::Client,  // HTTP client for making API requests
}

impl SttService {
    /// Creates a new SttService instance
    /// 
    /// Initializes the HTTP client.
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(), // Create a new HTTP client
        }
    }

    /// Transcribes audio data to text using Lexi AI Server
    /// 
    /// This function:
    /// 1. Creates a multipart form request with the audio file
    /// 2. Sends the request to Lexi AI Server transcription endpoint
    /// 3. Parses the JSON response to extract the transcribed text
    /// 
    /// The request can be cancelled by aborting the tokio task, which will cause
    /// the HTTP request to be dropped and cancelled.
    /// 
    /// # Arguments
    /// * `audio_data` - WAV file data as bytes (typically from AudioRecorder)
    /// * `auth_token` - Optional authentication token (Bearer token) for authenticated requests
    /// * `cancel_rx` - Optional cancellation receiver. If this receives a signal, the request will be cancelled.
    /// 
    /// # Returns
    /// * `Ok(String)` - The transcribed text on success
    /// * `Err(Box<dyn Error>)` - An error if the API call fails or if the request was cancelled
    pub async fn transcribe_audio(
        &self,
        audio_data: Vec<u8>,
        auth_token: Option<String>,
        cancel_rx: Option<oneshot::Receiver<()>>,
    ) -> Result<String, Box<dyn Error + Send + Sync>> {
        // Debug logging
        println!("🔍 DEBUG: Audio data size: {} bytes", audio_data.len());

        // Create a multipart form part for the audio file
        // The server expects the audio file to be sent as a multipart form field
        let part = multipart::Part::bytes(audio_data)
            .file_name("audio.wav")        // Filename hint for the server
            .mime_str("audio/wav")?;       // MIME type indicating WAV audio format

        // Build the multipart form with the audio file
        let form = multipart::Form::new()
            .part("file", part);  // Attach the audio file

        println!("🔍 DEBUG: Sending request to Lexi AI Server...");

        // Build the request
        // Get API base URL from configuration
        let api_base_url = config::api_base_url();
        let mut request = self.client
            .post(format!("{}/api/transcription/speech-to-text", api_base_url))
            .multipart(form);  // Attach the multipart form with audio file

        // Add authorization header if token is provided
        if let Some(token) = &auth_token {
            request = request.header("Authorization", format!("Bearer {}", token));
            println!("🔍 DEBUG: Added Authorization header (token length: {})", token.len());
        } else {
            println!("🔍 DEBUG: No auth token provided - request will likely fail with 401");
        }

        // Send the request with cancellation support
        // Use tokio::select! to race between the request and cancellation signal
        let res = if let Some(cancel_rx) = cancel_rx {
            tokio::select! {
                result = request.send() => {
                    match result {
                        Ok(res) => res,
                        Err(e) => return Err(Box::new(e)),
                    }
                }
                _ = cancel_rx => {
                    println!("🛑 HTTP request cancelled via cancellation signal");
                    return Err("Request cancelled".into());
                }
            }
        } else {
            // No cancellation support, just send normally
            request.send().await?
        };

        let status = res.status();
        println!("🔍 DEBUG: Response status: {}", status);

        // Check if the request was successful (status code 200-299)
        if !status.is_success() {
            // Read the error response body
            let error_text = res.text().await?;
            println!("🔍 DEBUG: Server Error response: {}", error_text);
            return Err(format!("Server Error ({}): {}", status, error_text).into());
        }

        // Parse the JSON response
        // The server returns a JSON object with a "text" field containing the transcription
        let json: serde_json::Value = res.json().await?;
        println!("🔍 DEBUG: Full server response: {}", serde_json::to_string_pretty(&json).unwrap_or_default());
        
        // Extract the transcribed text from the JSON response
        // The response format is: { "text": "transcribed text here" }
        let text = json["text"]
            .as_str()
            .unwrap_or("")
            .to_string();
        println!("🔍 DEBUG: Extracted text: {}", text);

        Ok(text)
    }
}
