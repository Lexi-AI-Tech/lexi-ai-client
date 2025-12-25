//! Configuration Commands
//!
//! This module provides Tauri commands for managing configuration state.

use tauri::State;
use crate::state::LanguageState;

/// Set the transcription language from frontend
/// 
/// This command allows the frontend to update the language preference stored in Rust state.
/// The frontend should call this whenever the language preference changes.
/// 
/// # Arguments
/// * `language` - Optional language code from frontend (e.g., "en", "es", "auto")
#[tauri::command]
pub fn set_language(state: State<LanguageState>, language: Option<String>) {
    if let Ok(mut language_guard) = state.language.lock() {
        *language_guard = language.clone();
        println!("🌐 Language updated to: {:?}", language);
    }
}

/// Get the current transcription language
/// 
/// # Returns
/// * `Option<String>` - The current language code if available, None otherwise
pub fn get_language(state: &State<LanguageState>) -> Option<String> {
    if let Ok(language_guard) = state.language.lock() {
        language_guard.clone()
    } else {
        None
    }
}

