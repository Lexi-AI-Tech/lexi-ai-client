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
//! - **Response**: Plain text string containing the transcribed text
//!
//! ## Features
//!
//! - **Cancellation Support**: HTTP requests can be cancelled via tokio oneshot channel
//! - **Error Handling**: Comprehensive error messages for debugging
//! - **Debug Logging**: Detailed logging of request/response for troubleshooting

use crate::api_endpoints::stt;
// use crate::whisper; // COMMENTED OUT: Model execution functionality
use reqwest::multipart;
use std::error::Error;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

/// STT (Speech-to-Text) Service client for transcribing audio using Lexi AI Server
///
/// This struct manages HTTP requests to the Lexi AI Server endpoint for speech-to-text conversion.
/// The server handles the Groq API integration internally.
pub struct SttService {
    client: reqwest::Client, // HTTP client for making API requests
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
    /// 3. Returns the plain text response containing the transcribed text
    ///
    /// The request can be cancelled by aborting the tokio task, which will cause
    /// the HTTP request to be dropped and cancelled.
    ///
    /// # Arguments
    /// * `audio_data` - WAV file data as bytes (typically from AudioRecorder)
    /// * `auth_token` - Optional authentication token (Bearer token) for authenticated requests
    /// * `language` - Language code for transcription (e.g., "en", "es", "auto")
    /// * `enhance_transcription` - Whether to enhance the transcription with AI
    /// * `focused_app` - Name of the currently focused application (required)
    /// * `cancel_rx` - Optional cancellation receiver. If this receives a signal, the request will be cancelled.
    /// * `app_handle` - Optional Tauri AppHandle for emitting events (e.g., login_required)
    /// * `offline_transcription` - Whether to use local Whisper model instead of server API
    /// * `vocabulary` - Optional vocabulary array to use as initial prompt for offline transcription
    ///
    /// # Returns
    /// * `Ok(String)` - The transcribed text on success
    /// * `Err(Box<dyn Error>)` - An error if the API call fails or if the request was cancelled
    pub async fn transcribe_audio(
        &self,
        audio_data: Vec<u8>,
        auth_token: Option<String>,
        language: String,
        enhance_transcription: bool,
        focused_app: String,
        cancel_rx: Option<oneshot::Receiver<()>>,
        app_handle: Option<AppHandle>,
        offline_transcription: bool,
        vocabulary: Vec<String>,
    ) -> Result<String, Box<dyn Error + Send + Sync>> {
        // Debug logging
        println!("🔍 DEBUG: Audio data size: {} bytes", audio_data.len());

        // COMMENTED OUT: Model execution functionality
        // Check if offline transcription is enabled
        if offline_transcription {
            // COMMENTED OUT: Offline transcription using local Whisper model
            return Err("Offline transcription is currently disabled. Please use server-based transcription.".into());
            
            // println!("📦 Using offline transcription (local Whisper model)");

            // // Prepare vocabulary option
            // let vocabulary_option = if !vocabulary.is_empty() {
            //     Some(vocabulary.clone())
            // } else {
            //     None
            // };

            // // Run the synchronous whisper function in a blocking task
            // let audio_data_clone = audio_data.clone();
            // let language_clone = language.clone();
            // let vocabulary_clone = vocabulary_option;

            // // Check for cancellation before starting
            // if let Some(cancel_rx) = cancel_rx {
            //     // Use tokio::select to race between transcription and cancellation
            //     tokio::select! {
            //         result = tokio::task::spawn_blocking(move || {
            //             whisper::transcribe_audio_data(audio_data_clone, language_clone, vocabulary_clone)
            //         }) => {
            //             match result {
            //                 Ok(Ok(text)) => Ok(text),
            //                 Ok(Err(e)) => Err(e.into()),
            //                 Err(e) => Err(format!("Transcription task failed: {}", e).into()),
            //             }
            //         }
            //         _ = cancel_rx => {
            //             println!("🛑 Offline transcription cancelled");
            //             Err("Request cancelled".into())
            //         }
            //     }
            // } else {
            //     // No cancellation support, just run the blocking task
            //     let vocabulary_for_blocking = if !vocabulary.is_empty() {
            //         Some(vocabulary)
            //     } else {
            //         None
            //     };
            //     tokio::task::spawn_blocking(move || {
            //         whisper::transcribe_audio_data(audio_data, language, vocabulary_for_blocking)
            //     })
            //     .await
            //     .map_err(|e| format!("Transcription task failed: {}", e))?
            //     .map_err(|e| e.into())
            // }
        } else {
            // Continue with server API transcription

            // Create a multipart form part for the audio file
            // The server expects the audio file to be sent as a multipart form field
            let part = multipart::Part::bytes(audio_data)
                .file_name("audio.wav") // Filename hint for the server
                .mime_str("audio/wav")?; // MIME type indicating WAV audio format

            // Build the multipart form with the audio file
            let form = multipart::Form::new().part("audio_file", part); // Attach the audio file

            // Build the request URL using centralized endpoint
            let url = stt::transcribe_url(&language, enhance_transcription, &focused_app);
            let mut request = self.client.post(&url).multipart(form); // Attach the multipart form with audio file

            // Add authorization header if token is provided
            if let Some(token) = &auth_token {
                request = request.header("Authorization", format!("Bearer {}", token));
                println!(
                    "🔍 DEBUG: Added Authorization header (token length: {})",
                    token.len()
                );
            } else {
                println!("🔍 DEBUG: No auth token provided - emitting login_required event");
                // Emit login_required event to pill component if app_handle is available
                if let Some(handle) = app_handle {
                    handle.emit("login_required", ()).unwrap_or_else(|e| {
                        eprintln!("Failed to emit login_required event: {}", e)
                    });
                }
                return Err("Authentication required. Please log in to continue.".into());
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

            // Parse the plain text response
            // The server returns plain text containing the transcribed text
            let text = res.text().await?;
            println!("🔍 DEBUG: Server response text: {}", text);

            Ok(text)
        }
    }
}
