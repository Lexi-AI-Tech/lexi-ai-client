//! Shortcuts Module
//!
//! This module handles voice command shortcuts that replace transcriptions with predefined values.
//! Commands are loaded from app config (server-synced) and use O(1) HashMap lookup for performance.
//! Matching is punctuation-insensitive so LLM-enhanced transcriptions (e.g. "hello." or "Hello!")
//! still match the shortcut phrase "hello".

use std::collections::HashMap;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::commands::app_config::get_app_config;
use crate::commands::shortcuts::Shortcut;
use crate::state::ShortcutCommandsState;

const SHORTCUT_COMMANDS_CACHE_TTL: Duration = Duration::from_secs(30 * 60);

/// Normalizes text for shortcut lookup: trim, lowercase, remove punctuation, collapse whitespace.
/// This makes detection foolproof when the assistant adds punctuation (e.g. "hello." → "hello").
fn normalize_for_shortcut_lookup(s: &str) -> String {
    let s = s.trim().to_lowercase();
    let s: String = s
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect();
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

/// Returns a HashMap of voice commands and their corresponding replacement values from app config.
///
/// Fetches app config from the server and builds a map from normalized shortcut phrase to value.
/// On fetch failure, returns an empty map so injection still uses the raw transcription.
/// Commands are case-insensitive and punctuation-insensitive.
pub async fn get_commands(app: &AppHandle) -> HashMap<String, String> {
    // Fast path: use in-memory cache populated from app config fetch/update, while fresh.
    let mut stale_cached_commands: HashMap<String, String> = HashMap::new();
    if let Some(cache_state) = app.try_state::<ShortcutCommandsState>() {
        if let Ok(cache) = cache_state.0.lock() {
            stale_cached_commands = cache.commands.clone();
            let is_fresh = cache
                .last_refreshed_at
                .map(|t| t.elapsed() < SHORTCUT_COMMANDS_CACHE_TTL)
                .unwrap_or(false);
            if is_fresh && !cache.commands.is_empty() {
                return cache.commands.clone();
            }
        }
    }

    // Cold start or TTL-expired path: fetch from server and warm cache.
    let config = match get_app_config(app.clone()).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("⚠️  Failed to load shortcuts from app config: {}", e);
            // If refresh fails, keep serving stale cache to avoid breaking transcription.
            return stale_cached_commands;
        }
    };

    let commands = build_commands_map(config.shortcuts.as_deref().unwrap_or(&[]));
    set_cached_commands(app, commands.clone());
    commands
}

/// Build normalized command map from shortcuts list.
pub fn build_commands_map(shortcuts: &[Shortcut]) -> HashMap<String, String> {
    let mut commands = HashMap::new();
    for s in shortcuts {
        let key = normalize_for_shortcut_lookup(&s.phrase);
        if !key.is_empty() {
            commands.insert(key, s.value.clone());
        }
    }
    commands
}

/// Replace in-memory shortcut command cache.
pub fn set_cached_commands(app: &AppHandle, commands: HashMap<String, String>) {
    if let Some(cache_state) = app.try_state::<ShortcutCommandsState>() {
        if let Ok(mut cache) = cache_state.0.lock() {
            cache.commands = commands;
            cache.last_refreshed_at = Some(std::time::Instant::now());
        }
    }
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
