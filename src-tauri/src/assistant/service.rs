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
//! - **Error Handling**: Comprehensive error messages for debugging
//! - **Debug Logging**: Detailed logging of request/response for troubleshooting

use crate::api_endpoints::assistant;
use crate::cursor_context::{get_cursor_context, CursorContext};
use crate::utils;
// use crate::whisper; // COMMENTED OUT: Model execution functionality
use reqwest::multipart;
use std::error::Error;
use tauri::{AppHandle, Emitter};

/// Assistant Service client for transcribing audio using Lexi AI Server
///
/// This struct manages HTTP requests to the Lexi AI Server endpoint for speech-to-text conversion.
/// The server handles the Groq API integration internally.
pub struct AssistantService {
    client: reqwest::Client, // HTTP client for making API requests
}

impl AssistantService {
    /// Creates a new AssistantService instance
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
    /// # Arguments
    /// * `audio_data` - WAV file data as bytes (typically from AudioRecorder)
    /// * `auth_token` - Optional authentication token (Bearer token) for authenticated requests
    /// * `language` - Language code for transcription (e.g., "en", "es", "auto")
    /// * `enhance_transcription` - Whether to enhance the transcription with AI
    /// * `app_handle` - Optional Tauri AppHandle for emitting events (e.g., login_required)
    /// * `offline_transcription` - Whether to use local Whisper model instead of server API
    /// * `vocabulary` - Optional vocabulary array to use as initial prompt for offline transcription
    ///
    /// Cursor context (focused app, selected text) is fetched inside this function just before
    /// calling the Assistant API and is returned with the transcription for use by the caller.
    ///
    /// # Returns
    /// * `Ok((String, Option<CursorContext>))` - The transcribed text and cursor context on success
    /// * `Err(Box<dyn Error>)` - An error if the API call fails or if the request was cancelled
    pub async fn transcribe_audio(
        &self,
        audio_data: Vec<u8>,
        auth_token: Option<String>,
        language: String,
        enhance_transcription: bool,
        app_handle: Option<AppHandle>,
        offline_transcription: bool,
        vocabulary: Vec<String>,
    ) -> Result<(String, Option<CursorContext>), Box<dyn Error + Send + Sync>> {
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

            // Helper function to build the multipart form (takes focused_app so cursor context can be fetched just before the API call)
            let build_form = |audio_data: &[u8],
                              focused_app: &str|
             -> Result<multipart::Form, Box<dyn Error + Send + Sync>> {
                let part = multipart::Part::bytes(audio_data.to_vec())
                    .file_name("audio.wav")
                    .mime_str("audio/wav")?;

                let mut form = multipart::Form::new()
                    .part("audio_file", part)
                    .text("language", language.clone())
                    .text("enhance_stt_output", enhance_transcription.to_string())
                    .text("focused_app", focused_app.to_string());

                for word in &vocabulary {
                    form = form.text("vocabulary", word.clone());
                }

                Ok(form)
            };

            // Check if we have a token
            let current_token = if let Some(token) = auth_token {
                token
            } else {
                println!("🔍 DEBUG: No auth token provided - emitting login_required event");
                if let Some(handle) = app_handle {
                    handle.emit("login_required", ()).unwrap_or_else(|e| {
                        eprintln!("Failed to emit login_required event: {}", e)
                    });
                }
                return Err("Authentication required. Please log in to continue.".into());
            };

            println!(
                "🔍 DEBUG: Added Authorization header (token length: {})",
                current_token.len()
            );

            // Get cursor context just before making the API call
            let cursor_context = get_cursor_context();
            let focused_app = cursor_context
                .as_ref()
                .and_then(|ctx| ctx.app_name.clone())
                .unwrap_or_else(|| "Unknown".to_string());

            // Build the form and make the request
            let form = build_form(&audio_data, &focused_app)?;

            // Build the request URL
            let url = assistant::transcribe_url();
            utils::log_api_request("Transcribe audio to text", "POST", &url);
            let mut request = self.client.post(&url).multipart(form);
            request = request.header("Authorization", format!("Bearer {}", current_token));

            // Send the initial request
            let res = request.send().await?;

            let status = res.status();
            println!("🔍 DEBUG: Response status: {}", status);

            // Check if the request was successful (status code 200-299)
            if !status.is_success() {
                let error_text = res.text().await?;
                println!("🔍 DEBUG: Server Error response: {}", error_text);
                if status == reqwest::StatusCode::UNAUTHORIZED {
                    if let Some(handle) = app_handle {
                        handle.emit("login_required", ()).unwrap_or_else(|e| {
                            eprintln!("Failed to emit login_required event: {}", e)
                        });
                    }
                }
                return Err(format!("Server Error ({}): {}", status, error_text).into());
            }

            // Parse the plain text response
            // The server returns plain text containing the transcribed text
            let text = res.text().await?;
            println!("🔍 DEBUG: Server response text: {}", text);

            Ok((text, cursor_context))
        }
    }
}
