use std::error::Error;

pub struct SpeechAPI;

impl SpeechAPI {
    pub fn new(_api_url: String) -> Self {
        Self
    }

    pub async fn transcribe_audio(&self, _audio_data: Vec<u8>) -> Result<String, Box<dyn Error + Send + Sync>> {
        // Simulate processing delay
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        
        // Return "hello world" directly
        Ok("hello world".to_string())
    }
}
