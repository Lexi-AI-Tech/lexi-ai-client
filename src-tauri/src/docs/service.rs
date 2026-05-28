//! HTTP client for docs voice-to-content (audio → STT + LLM on server).

use crate::api_endpoints::docs;
use crate::commands::auth::get_auth_token_async;
use crate::utils;
use reqwest::multipart;
use serde::{Deserialize, Serialize};
use std::error::Error;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocContentResponse {
    pub title: String,
    pub content: String,
}

/// Posts WAV audio to the docs create-from-audio endpoint (transcribe + generate on server).
pub struct DocsService {
    client: reqwest::Client,
}

impl DocsService {
    pub fn new() -> Self {
        Self {
            client: utils::create_http_client(),
        }
    }

    pub async fn create_doc_from_audio(
        &self,
        audio_data: Vec<u8>,
        app_handle: &AppHandle,
        language: String,
        vocabulary: Vec<String>,
    ) -> Result<DocContentResponse, Box<dyn Error + Send + Sync>> {
        let auth_token = get_auth_token_async(app_handle).await.map_err(|e| {
            let _ = app_handle.emit("login_required", ());
            format!("Authentication required: {}", e)
        })?;

        let part = multipart::Part::bytes(audio_data)
            .file_name("audio.wav")
            .mime_str("audio/wav")?;

        let form = multipart::Form::new()
            .part("audio_file", part)
            .text("language", language)
            .text("vocabulary", serde_json::to_string(&vocabulary)?);

        let url = docs::create_doc_from_audio_url();
        utils::log_api_request("POST", &url);

        let request = self
            .client
            .post(&url)
            .multipart(form)
            .header("Authorization", format!("Bearer {}", auth_token));
        let request = utils::apply_feature_usage_header(app_handle, request);

        let res = request.send().await?;
        utils::capture_feature_usage_header(app_handle, &res);

        let status = res.status();
        if !status.is_success() {
            let error_text = res.text().await.unwrap_or_else(|_| "Unknown error".into());
            if status == reqwest::StatusCode::UNAUTHORIZED {
                let _ = app_handle.emit("login_required", ());
            }
            return Err(format!("Server error ({}): {}", status, error_text).into());
        }

        let result: DocContentResponse = res.json().await?;
        Ok(result)
    }
}
