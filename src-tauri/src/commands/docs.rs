//! Docs Commands
//!
//! Tauri commands for managing rich-text documents (Notion-style docs).
//! Stored locally via Tauri Store; content is TipTap/ProseMirror JSON as string.

use crate::commands::auth::get_auth_token_async;
use crate::RecordingCommand;
use crate::RecordingCommandTx;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

const STORE_FILE: &str = ".docs.dat";
const DOCS_KEY: &str = "docs";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Doc {
    pub id: String,
    pub title: String,
    /// TipTap/ProseMirror JSON document as string
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateDocRequest {
    pub title: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateDocRequest {
    pub title: Option<String>,
    pub content: Option<String>,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn load_docs(app: &AppHandle) -> Result<Vec<Doc>, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to access docs storage: {}", e))?;
    match store.get(DOCS_KEY) {
        Some(v) => serde_json::from_value(v.clone()).map_err(|e| format!("Invalid docs data: {}", e)),
        None => Ok(Vec::new()),
    }
}

fn save_docs(app: &AppHandle, docs: &[Doc]) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to access docs storage: {}", e))?;
    let value = serde_json::to_value(docs).map_err(|e| e.to_string())?;
    store.set(DOCS_KEY, value);
    store.save().map_err(|e| format!("Failed to save docs store: {}", e))?;
    Ok(())
}

/// List all docs (newest first)
#[tauri::command]
pub fn get_docs(app: AppHandle) -> Result<Vec<Doc>, String> {
    let mut docs = load_docs(&app)?;
    docs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(docs)
}

/// Get a single doc by id
#[tauri::command]
pub fn get_doc(app: AppHandle, doc_id: String) -> Result<Option<Doc>, String> {
    let docs = load_docs(&app)?;
    Ok(docs.into_iter().find(|d| d.id == doc_id))
}

/// Create a new doc
#[tauri::command]
pub fn create_doc(
    app: AppHandle,
    title: Option<String>,
    content: Option<String>,
) -> Result<Doc, String> {
    let mut docs = load_docs(&app)?;
    let now = now_iso();
    let doc = Doc {
        id: Uuid::new_v4().to_string(),
        title: title.unwrap_or_else(|| "Untitled".to_string()),
        content: content.unwrap_or_else(|| default_content()),
        created_at: now.clone(),
        updated_at: now,
    };
    docs.push(doc.clone());
    save_docs(&app, &docs)?;
    Ok(doc)
}

/// Update an existing doc
#[tauri::command]
pub fn update_doc(
    app: AppHandle,
    doc_id: String,
    title: Option<String>,
    content: Option<String>,
) -> Result<Doc, String> {
    let mut docs = load_docs(&app)?;
    let pos = docs.iter().position(|d| d.id == doc_id);
    let doc = match pos {
        Some(i) => {
            let d = &mut docs[i];
            if let Some(t) = title {
                d.title = t;
            }
            if let Some(c) = content {
                d.content = c;
            }
            d.updated_at = now_iso();
            d.clone()
        }
        None => return Err("Doc not found".to_string()),
    };
    save_docs(&app, &docs)?;
    Ok(doc)
}

/// Delete a doc
#[tauri::command]
pub fn delete_doc(app: AppHandle, doc_id: String) -> Result<(), String> {
    let mut docs = load_docs(&app)?;
    let len_before = docs.len();
    docs.retain(|d| d.id != doc_id);
    if docs.len() == len_before {
        return Err("Doc not found".to_string());
    }
    save_docs(&app, &docs)?;
    Ok(())
}

fn default_content() -> String {
    r#"{"type":"doc","content":[{"type":"paragraph"}]}"#.to_string()
}

/// Start recording for doc (Docs UI mic button). Emits doc_recording_started; when user stops, transcript is emitted as doc_transcription_ready.
#[tauri::command]
pub fn start_doc_recording(app: AppHandle) -> Result<(), String> {
    let tx = app.state::<RecordingCommandTx>();
    tx.0.send(RecordingCommand::DocStart).map_err(|e| e.to_string())
}

/// Stop recording for doc. Transcript will be emitted via doc_transcription_ready after processing.
#[tauri::command]
pub fn stop_doc_recording(app: AppHandle) -> Result<(), String> {
    let tx = app.state::<RecordingCommandTx>();
    tx.0.send(RecordingCommand::DocStop).map_err(|e| e.to_string())
}

/// Call server LLM to structure transcript into TipTap/Notion-style rich content. Returns TipTap JSON string.
#[tauri::command]
pub async fn structure_doc_content(app: AppHandle, transcript: String) -> Result<String, String> {
    let auth_token = get_auth_token_async(&app).await.map_err(|_| "Authentication required")?;
    let url = crate::api_endpoints::docs::structure_content_url();
    let client = crate::utils::create_http_client();
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "transcript": transcript }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let err_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Server error: {}", err_text));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;
    let content = data
        .get("content")
        .or_else(|| data.get("data").and_then(|d| d.get("content")))
        .and_then(|c| c.as_str())
        .ok_or_else(|| "Missing content in response")?;
    Ok(content.to_string())
}

/// Rewrite only a selected section of a doc per user instructions. Returns the rewritten text for that section only.
#[tauri::command]
pub async fn rewrite_doc_section(
    app: AppHandle,
    text: String,
    instructions: String,
    context_before: Option<String>,
    context_after: Option<String>,
) -> Result<String, String> {
    let auth_token = get_auth_token_async(&app).await.map_err(|_| "Authentication required")?;
    let url = crate::api_endpoints::docs::rewrite_section_url();
    let client = crate::utils::create_http_client();
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "text": text,
            "instructions": instructions,
            "context_before": context_before.unwrap_or_default(),
            "context_after": context_after.unwrap_or_default(),
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let err_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Server error: {}", err_text));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;
    let content = data
        .get("content")
        .or_else(|| data.get("data").and_then(|d| d.get("content")))
        .and_then(|c| c.as_str())
        .ok_or_else(|| "Missing content in response")?;
    Ok(content.to_string())
}
