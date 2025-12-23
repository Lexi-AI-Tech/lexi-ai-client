// src-tauri/src/grammar_checker.rs

use languagetool_rust::{check::CheckRequest, server::ServerClient};
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct GrammarSuggestion {
    pub start: usize,
    pub end: usize,
    pub original: String,
    pub replacement: String,
    pub explanation: String,
}

#[derive(Serialize, Clone)]
pub struct GrammarCheckResult {
    pub suggestions: Vec<GrammarSuggestion>,
}

#[tauri::command]
pub async fn check_grammar(text: String, cursor_pos: usize) -> Result<GrammarCheckResult, String> {
    println!("🔍 check_grammar called - text length: {}, cursor_pos: {}", text.len(), cursor_pos);
    
    // Use public LanguageTool API (rate-limited but fine for testing/MVP)
    let client = ServerClient::new("https://api.languagetool.org/v2", "");

    let request = CheckRequest::default()
        .with_text(text.clone())
        .with_language("en-US".to_string());

    println!("📤 Sending request to LanguageTool API...");
    let response = client
        .check(&request)
        .await
        .map_err(|e| {
            println!("❌ LanguageTool API error: {}", e);
            format!("LanguageTool API error: {}", e)
        })?;
    
    println!("✅ Received response from LanguageTool API ({} matches)", response.matches.len());

    let mut suggestions = Vec::new();

    for mat in response.matches {
        let start = mat.offset;
        let end = mat.offset + mat.length;

        // Only include suggestions near the cursor (±30 chars) to avoid noise
        if cursor_pos >= start.saturating_sub(30) && cursor_pos <= end.saturating_add(30) {
            if let Some(replacement) = mat.replacements.first() {
                suggestions.push(GrammarSuggestion {
                    start,
                    end,
                    original: text[start..end].to_string(),
                    replacement: replacement.value.clone(),
                    explanation: mat.message.clone(),
                });
            }
        }
    }

    println!("📝 Returning {} suggestions near cursor position {}", suggestions.len(), cursor_pos);
    Ok(GrammarCheckResult { suggestions })
}

// Placeholder – we'll implement real replacement later
#[tauri::command]
pub fn replace_text(start: usize, end: usize, new_text: String) -> Result<(), String> {
    println!("🔧 replace_text called – start: {}, end: {}, new_text: '{}'", start, end, new_text);
    println!("⚠️  Text replacement not yet implemented (will use Accessibility API later)");
    // TODO: Implement text replacement using Accessibility API
    // This will need to:
    // 1. Get the currently focused text element
    // 2. Replace the text range [start, end) with new_text
    // 3. Update the cursor position appropriately
    Ok(())
}