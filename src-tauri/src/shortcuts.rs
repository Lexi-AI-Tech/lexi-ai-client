//! Shortcuts Module
//!
//! This module handles voice command shortcuts that replace transcriptions with predefined values.
//! Commands are loaded from app config (server-synced) and use O(1) HashMap lookup for performance.
//! Matching is punctuation-insensitive so LLM-enhanced transcriptions (e.g. "hello." or "Hello!")
//! still match the shortcut phrase "hello".

use std::collections::HashMap;
use tauri::AppHandle;

use crate::commands::app_config::get_app_config;

/// Normalizes text for shortcut lookup: trim, lowercase, remove punctuation, collapse whitespace.
/// This makes detection foolproof when the assistant adds punctuation (e.g. "hello." → "hello").
fn normalize_for_shortcut_lookup(s: &str) -> String {
    let s = s.trim().to_lowercase();
    let s: String = s
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect();
    s.split_whitespace().collect::<Vec<_>>().join(" ").trim().to_string()
}

/// Returns a HashMap of voice commands and their corresponding replacement values from app config.
///
/// Fetches app config from the server and builds a map from normalized shortcut phrase to value.
/// On fetch failure, returns an empty map so injection still uses the raw transcription.
/// Commands are case-insensitive and punctuation-insensitive.
pub async fn get_commands(app: &AppHandle) -> HashMap<String, String> {
    let config = match get_app_config(app.clone()).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("⚠️  Failed to load shortcuts from app config: {}", e);
            return HashMap::new();
        }
    };

    let mut commands = HashMap::new();
    if let Some(shortcuts) = config.shortcuts {
        for s in shortcuts {
            let key = normalize_for_shortcut_lookup(&s.phrase);
            if !key.is_empty() {
                commands.insert(key, s.value);
            }
        }
    }
    commands
}

/// Checks if the transcription matches any command and returns the replacement value.
///
/// Loads commands from app config and performs a punctuation-insensitive lookup.
/// Returns Some(replacement) if a command match is found, None otherwise.
/// Matching is case-insensitive, trims whitespace, and ignores punctuation.
///
/// # Arguments
/// * `app` - The Tauri AppHandle used to fetch app config
/// * `transcription` - The transcription text to check against commands
pub async fn check_command(app: &AppHandle, transcription: &str) -> Option<String> {
    let commands = get_commands(app).await;
    check_command_with_commands(&commands, transcription)
}

/// Checks if the transcription matches any command using a pre-built commands map.
///
/// Returns Some(replacement) if a command match is found, None otherwise.
/// Matching is case-insensitive, trims whitespace, and ignores punctuation so that
/// "hello", "hello.", "Hello!" all match the same shortcut.
///
/// # Example
/// ```
/// use std::collections::HashMap;
/// use crate::shortcuts::check_command_with_commands;
///
/// let mut commands = HashMap::new();
/// commands.insert("linkedin".to_string(), "https://linkedin.com".to_string());
/// assert_eq!(check_command_with_commands(&commands, "linkedin"), Some("https://linkedin.com".to_string()));
/// assert_eq!(check_command_with_commands(&commands, "LINKEDIN"), Some("https://linkedin.com".to_string()));
/// assert_eq!(check_command_with_commands(&commands, "linkedin."), Some("https://linkedin.com".to_string()));
/// assert_eq!(check_command_with_commands(&commands, "unknown"), None);
/// ```
pub fn check_command_with_commands(
    commands: &HashMap<String, String>,
    transcription: &str,
) -> Option<String> {
    let key = normalize_for_shortcut_lookup(transcription);
    if key.is_empty() {
        return None;
    }
    commands.get(&key).cloned()
}
