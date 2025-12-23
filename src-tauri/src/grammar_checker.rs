use languagetool_rust::{check::CheckRequest, server::ServerClient};
use serde::Serialize;

#[derive(Serialize)]
pub struct GrammarSuggestion {
    pub start: usize,
    pub end: usize,
    pub original: String,
    pub replacement: String,
    pub explanation: String,
}

#[derive(Serialize)]
pub struct GrammarCheckResult {
    pub suggestions: Vec<GrammarSuggestion>,
}

#[tauri::command]
pub async fn check_grammar(text: String, cursor_pos: usize) -> Result<String, String> {
    // Run in a blocking task or async if client supports it
    // languagetool-rust is async.
    
    // We'll use the public API for now or check if we can run local.
    // The crate supports connecting to a server. Default is https://api.languagetool.org/v2
    
    // NOTE: Public API has rate limits. For persistent use, we should ideally bundle a local server or use a paid key.
    // For MVP, public API is fine.
    
    let client = ServerClient::new("https://api.languagetool.org/v2", "");
    
    // with_language expects a String language code
    let req = CheckRequest::default()
        .with_text(text.clone())
        .with_language("en-US".to_string());

    let response = client.check(&req).await.map_err(|e| e.to_string())?;

    if response.matches.is_empty() {
        return Ok(serde_json::to_string(&GrammarCheckResult { suggestions: vec![] }).unwrap());
    }

    // Filter suggestions near cursor
    // Match offset is 0-indexed based on chars?
    let mut relevant_suggestions = Vec::new();
    
    for m in response.matches {
        // Let's check if the cursor is within or near the error
        // context window: e.g. 50 chars? or just if it overlaps?
        // User wants "Focus on the word/sentence at the cursor"
        
        let start = m.offset;
        let end = m.offset + m.length;
        
        // Check overlap or proximity
        // If cursor is within [start - 10, end + 10]
        if cursor_pos >= start.saturating_sub(10) && cursor_pos <= end.saturating_add(10) {
             if let Some(repl) = m.replacements.first() {
                 relevant_suggestions.push(GrammarSuggestion {
                    start,
                    end,
                    original: text[start..end].to_string(),
                    replacement: repl.value.clone(),
                    explanation: m.message,
                 });
             }
        }
    }
    
    // If no relevant suggestions found near cursor, maybe return nothing or top one?
    // Let's stick to cursor proximity to avoid annoying popups for text far away.
    
    Ok(serde_json::to_string(&GrammarCheckResult { suggestions: relevant_suggestions }).unwrap())
}

#[tauri::command]
pub fn replace_text(start: usize, end: usize, new_text: String) -> Result<(), String> {
     // This needs to use Accessibility API to replace text.
     // Getting the focused element again might be tricky because we need the EXACT element that was focused.
     // However, `TextMonitor` logic runs in a loop and finds the focused element.
     // Detailed implementation of replace requires `accessibility` crate mutable set value.
     
     use accessibility::{AXUIElement, AXAttribute};
     use system_configuration::core_foundation::string::CFString;
     use std::thread;
     use std::time::Duration;

     // Retry loop to get focused element
     for _ in 0..3 {
         let system_wide = AXUIElement::system_wide();
         let focused_app_attr = AXAttribute::new(&CFString::from_static_string("AXFocusedApplication"));
         if let Ok(frontmost) = system_wide.attribute(&focused_app_attr) {
            if let Some(frontmost_elem) = frontmost.downcast::<AXUIElement>() {
                let focused_ui_attr = AXAttribute::new(&CFString::from_static_string("AXFocusedUIElement"));
                 if let Ok(focused_ui) = frontmost_elem.attribute(&focused_ui_attr) {
                    if let Some(focused_elem) = focused_ui.downcast::<AXUIElement>() {
                        
                        let value_attr = AXAttribute::new(&CFString::from_static_string("AXValue"));
                        if let Ok(text_val) = focused_elem.attribute(&value_attr) {
                            if let Some(cf_string) = text_val.downcast::<CFString>() {
                                let current_text = cf_string.to_string();
                                let mut new_full_text = current_text.clone();
                                 // Safety check indices
                                 if start < new_full_text.len() && end <= new_full_text.len() {
                                     new_full_text.replace_range(start..end, &new_text);
                                     
                                     // Set the new value
                                     // Note: The accessibility crate 0.1 doesn't have update_attribute
                                     // We would need to use a different approach or update the crate
                                     // For now, we'll return an error indicating this needs implementation
                                     // TODO: Implement text replacement using accessibility API
                                     return Err("Text replacement not yet implemented".to_string());
                                 }
                            }
                        }
                    }
                 }
            }
         }
         thread::sleep(Duration::from_millis(50));
     }
     
     Err("Failed to replace text".to_string())
}
