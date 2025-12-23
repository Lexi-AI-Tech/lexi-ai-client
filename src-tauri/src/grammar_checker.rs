// src-tauri/src/grammar_checker.rs

// use languagetool_rust::{check::CheckRequest, server::ServerClient};
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
    
    // For now, return hardcoded suggestion for testing
    // TODO: Re-enable LanguageTool API integration later
    // let client = ServerClient::new("https://api.languagetool.org/v2", "");
    // let request = CheckRequest::default()
    //     .with_text(text.clone())
    //     .with_language("en-US".to_string());
    // let response = client.check(&request).await?;
    
    // Return a hardcoded suggestion if text is not empty
    let suggestions = if !text.is_empty() && text.len() > 5 {
        vec![GrammarSuggestion {
            start: 0,
            end: 5.min(text.len()),
            original: text[0..5.min(text.len())].to_string(),
            replacement: "hardcoded text".to_string(),
            explanation: "This is a hardcoded suggestion for testing".to_string(),
        }]
    } else {
        Vec::new()
    };
    
    println!("✅ Returning {} hardcoded suggestions", suggestions.len());
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