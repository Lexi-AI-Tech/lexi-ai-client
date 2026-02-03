//! Shortcuts Module
//!
//! This module handles voice command shortcuts that replace transcriptions with predefined values.
//! Commands are loaded from app config (server-synced) and use O(1) HashMap lookup for performance.

use std::collections::HashMap;
use tauri::AppHandle;

use crate::commands::app_config::get_app_config;

/// Returns a HashMap of voice commands and their corresponding replacement values from app config.
///
/// Fetches app config from the server and builds a map from shortcut phrase (lowercase) to value.
/// On fetch failure, returns an empty map so injection still uses the raw transcription.
/// Commands are case-insensitive.
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
            commands.insert(s.phrase.trim().to_lowercase(), s.value);
        }
    }
    commands
}

/// Checks if the transcription matches any command and returns the replacement value.
///
/// Loads commands from app config and performs a case-insensitive lookup.
/// Returns Some(replacement) if a command match is found, None otherwise.
/// Matching is case-insensitive and trims whitespace.
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
/// Matching is case-insensitive and trims whitespace.
///
/// # Example
/// ```
/// use std::collections::HashMap;
/// use lexi_ai::shortcuts::check_command_with_commands;
///
/// let mut commands = HashMap::new();
/// commands.insert("linkedin".to_string(), "https://linkedin.com".to_string());
/// assert_eq!(check_command_with_commands(&commands, "linkedin"), Some("https://linkedin.com".to_string()));
/// assert_eq!(check_command_with_commands(&commands, "LINKEDIN"), Some("https://linkedin.com".to_string()));
/// assert_eq!(check_command_with_commands(&commands, "unknown"), None);
/// ```
pub fn check_command_with_commands(
    commands: &HashMap<String, String>,
    transcription: &str,
) -> Option<String> {
    let trimmed = transcription.trim();
    let lowercased = trimmed.to_lowercase();
    commands.get(&lowercased).cloned()
}
