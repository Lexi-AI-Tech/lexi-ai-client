//! Docs audio processing: send WAV to server (STT + doc generation) and emit results to the UI.

use crate::commands::app_config::load_app_config;
use crate::docs::service::DocsService;
use tauri::{AppHandle, Emitter};

/// Process doc voice recording: one server call returns editor content + suggested title.
pub fn process_audio_for_doc(audio_data: Vec<u8>, app_handle: AppHandle) {
    let app_handle_for_task = app_handle.clone();

    let _task = tauri::async_runtime::spawn(async move {
        let app_config = match load_app_config(&app_handle_for_task) {
            Ok(config) => config,
            Err(e) => {
                let _ = app_handle_for_task.emit("doc_from_audio_error", e);
                return;
            }
        };

        let language = app_config
            .languages
            .as_ref()
            .and_then(|langs| langs.first().cloned())
            .unwrap_or_else(|| "auto".to_string());
        let vocabulary = app_config.vocabulary.unwrap_or_default();

        let docs_service = DocsService::new();
        match docs_service
            .create_doc_from_audio(
                audio_data,
                &app_handle_for_task,
                language,
                vocabulary,
            )
            .await
        {
            Ok(result) => {
                let _ = app_handle_for_task.emit("doc_from_audio_ready", result);
            }
            Err(e) => {
                let _ = app_handle_for_task
                    .emit("doc_from_audio_error", e.to_string());
            }
        }
    });
}
