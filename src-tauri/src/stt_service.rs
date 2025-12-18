// STT (Speech-to-Text) Service module handles communication with Lexi AI Server for speech-to-text transcription
// It sends audio data (WAV format) to the server API and receives transcribed text in response
// The server handles the Groq API integration, so no API key is needed in the client

use std::error::Error;
use reqwest::multipart;
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
    /// # Arguments
    /// * `audio_data` - WAV file data as bytes (typically from AudioRecorder)
    /// * `auth_token` - Optional authentication token (Bearer token) for authenticated requests
    /// 
    /// # Returns
    /// * `Ok(String)` - The transcribed text on success
    /// * `Err(Box<dyn Error>)` - An error if the API call fails
    pub async fn transcribe_audio(&self, audio_data: Vec<u8>, auth_token: Option<String>) -> Result<String, Box<dyn Error + Send + Sync>> {
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

        // Send the request and wait for the response
        let res = request.send().await?;

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
