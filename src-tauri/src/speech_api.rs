use std::error::Error;
use std::env;
use reqwest::multipart;
use dotenv::dotenv;

pub struct SpeechAPI {
    client: reqwest::Client,
    api_key: String,
}

impl SpeechAPI {
    pub fn new() -> Self {
        dotenv().ok(); // Load .env file if present
        let api_key = env::var("GROQ_API_KEY").unwrap_or_default();
        Self {
            client: reqwest::Client::new(),
            api_key,
        }
    }

    pub async fn transcribe_audio(&self, audio_data: Vec<u8>) -> Result<String, Box<dyn Error + Send + Sync>> {
        if self.api_key.is_empty() {
            return Err("GROQ_API_KEY not set".into());
        }

        println!("🔍 DEBUG: Audio data size: {} bytes", audio_data.len());
        println!("🔍 DEBUG: API Key present: {}", !self.api_key.is_empty());

        let part = multipart::Part::bytes(audio_data)
            .file_name("audio.wav")
            .mime_str("audio/wav")?;

        let form = multipart::Form::new()
            .text("model", "whisper-large-v3")
            .part("file", part);

        println!("🔍 DEBUG: Sending request to Groq API...");

        let res = self.client
            .post("https://api.groq.com/openai/v1/audio/transcriptions")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .multipart(form)
            .send()
            .await?;

        println!("🔍 DEBUG: Response status: {}", res.status());

        if !res.status().is_success() {
            let error_text = res.text().await?;
            println!("🔍 DEBUG: API Error response: {}", error_text);
            return Err(format!("API Error: {}", error_text).into());
        }

        let json: serde_json::Value = res.json().await?;
        println!("🔍 DEBUG: Full API response: {}", serde_json::to_string_pretty(&json).unwrap_or_default());
        
        let text = json["text"].as_str().unwrap_or("").to_string();
        println!("🔍 DEBUG: Extracted text: {}", text);

        Ok(text)
    }

    pub async fn summarize_text(&self, text: &str) -> Result<String, Box<dyn Error + Send + Sync>> {
        if self.api_key.is_empty() {
            return Err("GROQ_API_KEY not set".into());
        }

        let prompt = format!(
            "Please provide a concise summary of the following meeting transcript. \
            Focus on key decisions, action items, and important points.\n\n\
            Transcript:\n{}", 
            text
        );

        let body = serde_json::json!({
            "model": "llama3-8b-8192",
            "messages": [
                {"role": "user", "content": prompt}
            ]
        });

        let res = self.client
            .post("https://api.groq.com/openai/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .await?;

        if !res.status().is_success() {
            let error_text = res.text().await?;
            return Err(format!("API Error: {}", error_text).into());
        }

        let json: serde_json::Value = res.json().await?;
        let summary = json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("No summary generated")
            .to_string();

        Ok(summary)
    }
}
