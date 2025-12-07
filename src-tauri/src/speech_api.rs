// SpeechAPI module handles communication with Groq's Whisper API for speech-to-text transcription
// It sends audio data (WAV format) to the API and receives transcribed text in response
// The API key is loaded from environment variables (GROQ_API_KEY) or a .env file

use std::error::Error;
use std::env;
use reqwest::multipart;
use dotenv::dotenv;

/// SpeechAPI client for transcribing audio using Groq's Whisper API
/// 
/// This struct manages HTTP requests to the Groq API endpoint for speech-to-text conversion.
/// It uses the Whisper Large V3 model, which provides high-quality transcription.
pub struct SpeechAPI {
    client: reqwest::Client,  // HTTP client for making API requests
    api_key: String,          // Groq API key for authentication
}

impl SpeechAPI {
    /// Creates a new SpeechAPI instance
    /// 
    /// Initializes the HTTP client and loads the API key from environment variables.
    /// The API key can be set via:
    /// - A .env file in the project root (loaded via dotenv)
    /// - The GROQ_API_KEY environment variable
    /// 
    /// If no API key is found, an empty string is used (which will cause errors on API calls).
    pub fn new() -> Self {
        // Load environment variables from .env file if it exists
        // The .ok() converts Result to Option, ignoring errors if .env doesn't exist
        dotenv().ok();
        
        // Get the API key from environment variables
        // If not found, default to empty string (will cause API calls to fail)
        let api_key = env::var("GROQ_API_KEY").unwrap_or_default();
        
        Self {
            client: reqwest::Client::new(), // Create a new HTTP client
            api_key,
        }
    }

    /// Transcribes audio data to text using Groq's Whisper API
    /// 
    /// This function:
    /// 1. Validates that an API key is configured
    /// 2. Creates a multipart form request with the audio file
    /// 3. Sends the request to Groq's transcription endpoint
    /// 4. Parses the JSON response to extract the transcribed text
    /// 
    /// # Arguments
    /// * `audio_data` - WAV file data as bytes (typically from AudioRecorder)
    /// 
    /// # Returns
    /// * `Ok(String)` - The transcribed text on success
    /// * `Err(Box<dyn Error>)` - An error if the API call fails or API key is missing
    pub async fn transcribe_audio(&self, audio_data: Vec<u8>) -> Result<String, Box<dyn Error + Send + Sync>> {
        // Validate that API key is configured
        if self.api_key.is_empty() {
            return Err("GROQ_API_KEY not set".into());
        }

        // Debug logging (can be removed in production)
        println!("🔍 DEBUG: Audio data size: {} bytes", audio_data.len());
        println!("🔍 DEBUG: API Key present: {}", !self.api_key.is_empty());

        // Create a multipart form part for the audio file
        // The API expects the audio file to be sent as a multipart form field named "file"
        let part = multipart::Part::bytes(audio_data)
            .file_name("audio.wav")        // Filename hint for the API
            .mime_str("audio/wav")?;       // MIME type indicating WAV audio format

        // Build the multipart form with the model name and audio file
        let form = multipart::Form::new()
            .text("model", "whisper-large-v3")  // Specify Whisper Large V3 model
            .part("file", part);                 // Attach the audio file

        println!("🔍 DEBUG: Sending request to Groq API...");

        // Send POST request to Groq's transcription endpoint
        // This endpoint follows the OpenAI API format (Groq is compatible)
        let res = self.client
            .post("https://api.groq.com/openai/v1/audio/transcriptions")
            .header("Authorization", format!("Bearer {}", self.api_key))  // Bearer token authentication
            .multipart(form)  // Attach the multipart form with audio file
            .send()
            .await?;  // Wait for the response

        println!("🔍 DEBUG: Response status: {}", res.status());

        // Check if the request was successful (status code 200-299)
        if !res.status().is_success() {
            // Read the error response body
            let error_text = res.text().await?;
            println!("🔍 DEBUG: API Error response: {}", error_text);
            return Err(format!("API Error: {}", error_text).into());
        }

        // Parse the JSON response
        // The API returns a JSON object with a "text" field containing the transcription
        let json: serde_json::Value = res.json().await?;
        println!("🔍 DEBUG: Full API response: {}", serde_json::to_string_pretty(&json).unwrap_or_default());
        
        // Extract the transcribed text from the JSON response
        // The response format is: { "text": "transcribed text here" }
        let text = json["text"].as_str().unwrap_or("").to_string();
        println!("🔍 DEBUG: Extracted text: {}", text);

        Ok(text)
    }
}
