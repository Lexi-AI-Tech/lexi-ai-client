//! Shortcuts Module
//!
//! This module handles voice command shortcuts that replace transcriptions with predefined values.
//! Shortcuts are passed in directly (from app config) — no API call is made inside this module.
//! Matching is punctuation-insensitive so LLM-enhanced transcriptions
//! (e.g. "hello." or "Hello!") still match the shortcut phrase "hello".

use crate::commands::shortcuts::Shortcut;

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

/// Checks if the transcription matches any shortcut and returns the replacement value.
///
/// Linear scan
/// Matching is case-insensitive, trims whitespace, and ignores punctuation.
///
/// # Arguments
/// * `shortcuts` - The list of shortcuts from app config
/// * `transcription` - The transcription text to check against shortcuts
pub fn check_shortcuts(shortcuts: &[Shortcut], transcription: &str) -> Option<String> {
    let key = normalize_for_shortcut_lookup(transcription);
    if key.is_empty() {
        return None;
    }

    shortcuts.iter().find_map(|s| {
        let shortcut_key = normalize_for_shortcut_lookup(&s.phrase);
        if shortcut_key == key {
            Some(s.value.clone())
        } else {
            None
        }
    })
}
