//! Docs Commands
//!
//! Tauri commands for managing rich-text documents (Notion-style docs).
//! All doc data is stored on the backend; these commands call the API.

use crate::commands::auth::get_auth_token_async;
use crate::RecordingCommand;
use crate::RecordingCommandTx;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::{AppHandle, Manager};

fn emit_docs_changed(app: &AppHandle, doc_id: Option<&str>, kind: &str) {
    // Best-effort: UI should still function if emitting fails.
    let _ = app.emit(
        "docs_changed",
        serde_json::json!({
            "kind": kind,
            "docId": doc_id,
        }),
    );
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Doc {
    pub id: String,
    pub title: String,
    /// LexiDoc JSON string (API canonical `content`)
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateDocRequest {
    #[serde(rename = "docId")]
    pub doc_id: String,
    pub title: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteDocRequest {
    #[serde(rename = "docId")]
    pub doc_id: String,
}

/// Use inner object when the server wraps payloads as `{ "data": { ... } }`.
fn api_doc_root<'a>(v: &'a serde_json::Value) -> &'a serde_json::Value {
    match v.get("data") {
        Some(serde_json::Value::Object(_)) => v.get("data").unwrap(),
        _ => v,
    }
}

fn required_api_string(root: &serde_json::Value, key: &str) -> Result<String, String> {
    match root.get(key) {
        Some(serde_json::Value::String(s)) => Ok(s.clone()),
        Some(serde_json::Value::Number(n)) => Ok(n.to_string()),
        None | Some(serde_json::Value::Null) => Err(format!("Missing {}", key)),
        _ => Err(format!("Invalid {} (expected string)", key)),
    }
}

fn doc_content_field(root: &serde_json::Value) -> String {
    match root.get("content") {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(v) => v.to_string(),
        None => String::new(),
    }
}

/// Parse API doc response into Doc (pub for use from meeting commands).
pub fn parse_doc_from_value(v: &serde_json::Value) -> Result<Doc, String> {
    let root = api_doc_root(v);
    let id = required_api_string(root, "id")?;
    let title = match root.get("title") {
        Some(serde_json::Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() {
                "Untitled".to_string()
            } else {
                t.to_string()
            }
        }
        None | Some(serde_json::Value::Null) => "Untitled".to_string(),
        Some(v) => v.to_string(),
    };
    let content = doc_content_field(root);
    let created_at = required_api_string(root, "created_at")?;
    let updated_at = required_api_string(root, "updated_at")?;
    Ok(Doc {
        id,
        title,
        content,
        created_at,
        updated_at,
    })
}

fn parse_doc_list(value: serde_json::Value) -> Result<Vec<Doc>, String> {
    let arr = value.as_array().ok_or("Expected array")?;
    let mut docs = Vec::with_capacity(arr.len());
    for v in arr {
        docs.push(parse_doc_from_value(v)?);
    }
    Ok(docs)
}

async fn docs_request(
    app: &AppHandle,
    method: &str,
    url: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let auth_token = get_auth_token_async(app)
        .await
        .map_err(|_| "Authentication required")?;
    let client = crate::utils::create_http_client();
    let mut req = match method {
        "GET" => client.get(url),
        "POST" => client.post(url),
        "PATCH" => client.patch(url),
        "DELETE" => client.delete(url),
        _ => return Err("Unsupported method".to_string()),
    };
    req = req.header("Authorization", format!("Bearer {}", auth_token));
    if let Some(b) = body {
        req = req.header("Content-Type", "application/json").json(&b);
    }
    let response = req
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Server error: {} - {}", status, body));
    }
    if response.status().as_u16() == 204 {
        return Ok(serde_json::Value::Null);
    }
    response
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))
}

/// List all docs (newest first) from the backend.
#[tauri::command]
pub async fn get_docs(app: AppHandle) -> Result<Vec<Doc>, String> {
    let url = crate::api_endpoints::docs::list_url();
    let value = docs_request(&app, "GET", &url, None).await?;
    parse_doc_list(value)
}

/// Get a single doc by id from the backend.
#[tauri::command]
pub async fn get_doc(app: AppHandle, doc_id: String) -> Result<Option<Doc>, String> {
    let url = crate::api_endpoints::docs::doc_url(&doc_id);
    let value = docs_request(&app, "GET", &url, None).await?;
    if value.is_null() {
        return Ok(None);
    }
    parse_doc_from_value(&value).map(Some)
}

/// Create a new doc on the backend.
#[tauri::command]
pub async fn create_doc(
    app: AppHandle,
    title: Option<String>,
    content: Option<String>,
) -> Result<Doc, String> {
    let url = crate::api_endpoints::docs::list_url();
    let body = serde_json::json!({
        "title": title.unwrap_or_else(|| "Untitled".to_string()),
        "content": content
    });
    let value = docs_request(&app, "POST", &url, Some(body)).await?;
    let doc = parse_doc_from_value(&value)?;
    emit_docs_changed(&app, Some(doc.id.as_str()), "created");
    Ok(doc)
}

/// Update an existing doc on the backend.
#[tauri::command]
pub async fn update_doc(app: AppHandle, payload: UpdateDocRequest) -> Result<Doc, String> {
    let url = crate::api_endpoints::docs::doc_url(&payload.doc_id);
    let mut body = serde_json::Map::new();
    if let Some(t) = payload.title {
        body.insert("title".to_string(), serde_json::Value::String(t));
    }
    if let Some(c) = payload.content {
        body.insert("content".to_string(), serde_json::Value::String(c));
    }
    let value = docs_request(&app, "PATCH", &url, Some(serde_json::Value::Object(body))).await?;
    let doc = parse_doc_from_value(&value)?;
    emit_docs_changed(&app, Some(doc.id.as_str()), "updated");
    Ok(doc)
}

/// Delete a doc on the backend.
#[tauri::command]
pub async fn delete_doc(app: AppHandle, payload: DeleteDocRequest) -> Result<(), String> {
    let url = crate::api_endpoints::docs::doc_url(&payload.doc_id);
    docs_request(&app, "DELETE", &url, None).await?;
    emit_docs_changed(&app, Some(payload.doc_id.as_str()), "deleted");
    Ok(())
}

/// Start recording for doc (Docs UI mic button). Emits doc_recording_started; when user stops, transcript is emitted as doc_transcription_ready.
#[tauri::command]
pub fn start_doc_recording(app: AppHandle) -> Result<(), String> {
    let tx = app.state::<RecordingCommandTx>();
    tx.0.send(RecordingCommand::DocStart)
        .map_err(|e| e.to_string())
}

/// Stop recording for doc. Transcript will be emitted via doc_transcription_ready after processing.
#[tauri::command]
pub fn stop_doc_recording(app: AppHandle) -> Result<(), String> {
    let tx = app.state::<RecordingCommandTx>();
    tx.0.send(RecordingCommand::DocStop)
        .map_err(|e| e.to_string())
}

/// Server response for create-doc-from-audio (editor JSON body + suggested title).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDocFromAudioResult {
    pub title: String,
    pub content: String,
}

/// Call server LLM to create doc content from a voice transcript.
#[tauri::command]
pub async fn create_doc_from_audio(
    app: AppHandle,
    transcript: String,
) -> Result<CreateDocFromAudioResult, String> {
    let auth_token = get_auth_token_async(&app)
        .await
        .map_err(|_| "Authentication required")?;
    let url = crate::api_endpoints::docs::create_doc_from_audio_url();
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
        let err_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
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
        .ok_or_else(|| "Missing content in response")?
        .to_string();
    let title = data
        .get("title")
        .or_else(|| data.get("data").and_then(|d| d.get("title")))
        .and_then(|t| t.as_str())
        .unwrap_or("Untitled")
        .to_string();
    Ok(CreateDocFromAudioResult { title, content })
}
