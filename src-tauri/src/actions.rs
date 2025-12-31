//! Actions Module
//!
//! This module handles voice actions triggered by a specific action trigger phrase.
//! When a transcription starts with the action trigger (e.g., "Hey Lexi"), instead of
//! injecting the transcription directly, it processes the action and injects the result.
//!
//! ## Implementation
//!
//! - **Action Trigger**: Hardcoded as "Hey Lexi" (case-insensitive)
//! - **Action Processing**: Extracts the action command from the transcription and
//!   calls `perform_action` to get the result text to inject
//! - **Text Injection**: The result from `perform_action` is injected instead of the
//!   original transcription

/// Hardcoded action trigger phrase (case-insensitive)
const ACTION_TRIGGER: &str = "hey lexi";

/// Normalizes text by removing punctuation and normalizing whitespace.
///
/// This helps handle STT errors like:
/// - "hey, lexi" -> "hey lexi"
/// - "hey? lexi" -> "hey lexi"
/// - "hey  lexi" -> "hey lexi"
/// - "heylexi" -> "hey lexi" (handles missing space)
///
/// # Arguments
/// * `text` - The text to normalize
///
/// # Returns
/// * `String` - The normalized text
fn normalize_text(text: &str) -> String {
    let mut normalized = String::new();
    let mut prev_was_alphanumeric = false;
    
    for ch in text.chars() {
        if ch.is_alphanumeric() {
            normalized.push(ch.to_lowercase().next().unwrap_or(ch));
            prev_was_alphanumeric = true;
        } else if prev_was_alphanumeric {
            // Add space when transitioning from alphanumeric to non-alphanumeric
            normalized.push(' ');
            prev_was_alphanumeric = false;
        }
        // Skip punctuation and whitespace (except we add space when needed)
    }
    
    normalized.trim().to_string()
}

/// Finds the end position of "lexi" in the original text (case-insensitive).
///
/// This searches for "lexi" in the original text, handling case variations.
/// It looks for the sequence of characters "l", "e", "x", "i" in order,
/// skipping any non-alphanumeric characters between them.
///
/// # Arguments
/// * `text` - The original transcription text
///
/// # Returns
/// * `Option<usize>` - The byte position after "lexi" (and any following punctuation/whitespace) if found, None otherwise
fn find_lexi_end_position(text: &str) -> Option<usize> {
    let lowercased = text.to_lowercase();
    let lexi_chars: Vec<char> = "lexi".chars().collect();
    
    // Collect all alphanumeric characters with their original positions
    let alphanumeric_positions: Vec<(usize, char)> = lowercased
        .char_indices()
        .filter(|(_, ch)| ch.is_alphanumeric())
        .collect();
    
    // Search for "lexi" in the alphanumeric sequence
    for window in alphanumeric_positions.windows(lexi_chars.len()) {
        let matches = window
            .iter()
            .zip(lexi_chars.iter())
            .all(|((_, ch), &expected)| *ch == expected);
        
        if matches {
            // Found "lexi", get the position after the last character
            let last_char_pos = window.last().unwrap().0;
            let last_char = window.last().unwrap().1;
            let mut end_pos = last_char_pos + last_char.len_utf8();
            
            // Skip any punctuation/whitespace after "lexi" in the original text
            let remaining = &text[end_pos..];
            for (offset, ch) in remaining.char_indices() {
                if ch.is_alphanumeric() {
                    end_pos += offset;
                    break;
                }
            }
            
            return Some(end_pos);
        }
    }
    
    None
}

/// Checks if the transcription starts with the action trigger phrase.
///
/// This function is robust to STT errors and handles cases like:
/// - "hey lexi" (normal)
/// - "heylexi" (no space)
/// - "hey, lexi" (comma)
/// - "hey? lexi" (question mark)
/// - "Hey Lexi" (capitalization)
///
/// Returns `Some(action_command)` if the transcription starts with the trigger,
/// where `action_command` is the rest of the transcription after the trigger.
/// Returns `None` if the transcription doesn't start with the trigger.
///
/// Matching is case-insensitive and handles punctuation/whitespace variations.
///
/// # Arguments
/// * `transcription` - The transcription text to check for action trigger
///
/// # Example
/// ```
/// use lexi_ai_client::actions::check_action_trigger;
///
/// assert_eq!(check_action_trigger("hey lexi summarise this text"), Some("summarise this text".to_string()));
/// assert_eq!(check_action_trigger("Hey Lexi do something"), Some("do something".to_string()));
/// assert_eq!(check_action_trigger("heylexi test"), Some("test".to_string()));
/// assert_eq!(check_action_trigger("hey, lexi test"), Some("test".to_string()));
/// assert_eq!(check_action_trigger("just some text"), None);
/// ```
pub fn check_action_trigger(transcription: &str) -> Option<String> {
    let trimmed = transcription.trim();
    
    // Normalize the text to handle STT errors (punctuation, spacing, etc.)
    let normalized = normalize_text(trimmed);
    
    // Check if normalized text starts with the trigger
    if normalized.starts_with(ACTION_TRIGGER) {
        // Find where "lexi" ends in the original text to extract the command properly
        if let Some(end_pos) = find_lexi_end_position(trimmed) {
            let action_command = trimmed[end_pos..].trim().to_string();
            Some(action_command)
        } else {
            // Fallback: if we can't find exact position (shouldn't happen if normalization worked),
            // try to extract command by finding where normalized trigger ends
            let trigger_len = ACTION_TRIGGER.len();
            if normalized.len() > trigger_len {
                // Count alphanumeric characters to find approximate position
                let mut alnum_count = 0;
                let mut target_count = 0;
                for ch in ACTION_TRIGGER.chars() {
                    if ch.is_alphanumeric() {
                        target_count += 1;
                    }
                }
                
                for (pos, ch) in trimmed.char_indices() {
                    if ch.is_alphanumeric() {
                        alnum_count += 1;
                        if alnum_count > target_count {
                            return Some(trimmed[pos..].trim().to_string());
                        }
                    }
                }
            }
            None
        }
    } else {
        None
    }
}

/// Performs an action based on the action command and returns the result text.
///
/// This function processes the action command and returns text that should be
/// injected instead of the original transcription.
///
/// # Arguments
/// * `action_command` - The action command extracted from the transcription
///                      (e.g., "summarise this text", "do something")
///
/// # Returns
/// * `String` - The text result to inject (currently hardcoded to "action performed successfully")
///
/// # TODO
/// - Implement actual action processing based on the command
/// - Support different action types (summarise, translate, etc.)
/// - Use selected text from cursor context when available
pub fn perform_action(action_command: &str) -> String {
    // TODO: Implement actual action processing
    // For now, just return a success message
    println!("🎯 Performing action: '{}'", action_command);
    "action performed successfully".to_string()
}
