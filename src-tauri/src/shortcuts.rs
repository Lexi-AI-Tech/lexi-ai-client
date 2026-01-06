//! Shortcuts Module
//!
//! This module handles voice command shortcuts that replace transcriptions with predefined values.
//! Commands are case-insensitive and use O(1) HashMap lookup for performance.

use std::collections::HashMap;

/// Returns a HashMap of voice commands and their corresponding replacement values.
///
/// This uses a HashMap for O(1) lookup performance when checking if a transcription
/// matches a command. Commands are case-insensitive.
///
/// # TODO
/// Remove these hardcoded commands and get them from app config state
pub fn get_commands() -> HashMap<String, String> {
    let mut commands = HashMap::new();
    // TODO: Remove these hardcoded commands and get them from app config state
    commands.insert(
        "linkedin".to_string(),
        "https://www.linkedin.com/in/ranjeet-baraik-b803231a0/".to_string(),
    );
    commands.insert("google".to_string(), "www.google.com".to_string());
    commands
}

/// Checks if the transcription matches any command and returns the replacement value.
///
/// Returns Some(replacement) if a command match is found, None otherwise.
/// Matching is case-insensitive and trims whitespace.
///
/// # Arguments
/// * `transcription` - The transcription text to check against commands
///
/// # Example
/// ```
/// use lexi_ai_client::shortcuts::check_command;
///
/// assert_eq!(check_command("linkedin"), Some("https://www.linkedin.com/in/ranjeet-baraik-b803231a0/".to_string()));
/// assert_eq!(check_command("LINKEDIN"), Some("https://www.linkedin.com/in/ranjeet-baraik-b803231a0/".to_string()));
/// assert_eq!(check_command("unknown"), None);
/// ```
pub fn check_command(transcription: &str) -> Option<String> {
    let commands = get_commands();
    let trimmed = transcription.trim();
    let lowercased = trimmed.to_lowercase();

    commands.get(&lowercased).cloned()
}
