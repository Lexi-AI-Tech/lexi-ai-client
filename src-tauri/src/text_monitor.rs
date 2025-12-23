// src-tauri/src/text_monitor.rs

use accessibility::{AXAttribute, AXUIElement};
use serde::Serialize;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use system_configuration::core_foundation::string::CFString;
use crate::grammar_checker::check_grammar_internal;

// Helper function to get element bounds (x, y, width, height)
// AXBounds returns a CFDictionary - TODO: Properly parse CFDictionary to extract X, Y, Width, Height values
// For now, this is a placeholder - we'll implement proper parsing later
fn _get_element_bounds(_elem: &AXUIElement) -> Option<(f64, f64, f64, f64)> {
    // TODO: Parse AXBounds CFDictionary to extract:
    // - X: CFNumber
    // - Y: CFNumber  
    // - Width: CFNumber
    // - Height: CFNumber
    None
}

#[derive(Serialize, Clone)]
#[allow(dead_code)] // Reserved for future use if we need to emit text-change events
pub struct TextChangePayload {
    pub text: String,
    pub cursor_pos: usize,
}

#[derive(Serialize, Clone)]
pub struct GrammarSuggestionsPayload {
    pub suggestions: Vec<crate::grammar_checker::GrammarSuggestion>,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

pub struct TextMonitor {
    _unused: (),
}

impl TextMonitor {
    pub fn new() -> Self {
        Self { _unused: () }
    }
}

#[tauri::command]
pub fn start_monitoring(app_handle: AppHandle) -> Result<(), String> {
    println!("🚀 start_monitoring command called – spawning monitoring thread");

    thread::spawn(move || {
        println!("📡 Text monitoring thread started");

        let mut last_text = String::new();
        let mut last_grammar_check_text = String::new();
        let mut _last_focused_elem: Option<AXUIElement> = None; // Reserved for future use when parsing AXBounds
        let mut grammar_check_timer: Option<std::time::Instant> = None;
        const GRAMMAR_CHECK_DEBOUNCE_MS: u64 = 500; // Wait 500ms after typing stops

        loop {

            let system_wide = AXUIElement::system_wide();
            let mut focused_elem_option: Option<AXUIElement> = None;

            // Method 1: Direct global focused UI element
            let focused_ui_attr = AXAttribute::new(&CFString::from_static_string("AXFocusedUIElement"));
            if let Ok(focused_ui) = system_wide.attribute(&focused_ui_attr) {
                if let Some(elem) = focused_ui.downcast::<AXUIElement>() {
                    focused_elem_option = Some(elem);
                }
            }

            // Method 2: Fallback via frontmost app → focused window
            if focused_elem_option.is_none() {
                let frontmost_attr = AXAttribute::new(&CFString::from_static_string("AXFrontmostApplication"));
                if let Ok(frontmost) = system_wide.attribute(&frontmost_attr) {
                    if let Some(app_elem) = frontmost.downcast::<AXUIElement>() {
                        let window_attr = AXAttribute::new(&CFString::from_static_string("AXFocusedWindow"));
                        if let Ok(window) = app_elem.attribute(&window_attr) {
                            if let Some(win_elem) = window.downcast::<AXUIElement>() {
                                let ui_attr = AXAttribute::new(&CFString::from_static_string("AXFocusedUIElement"));
                                if let Ok(ui) = win_elem.attribute(&ui_attr) {
                                    if let Some(ui_elem) = ui.downcast::<AXUIElement>() {
                                        focused_elem_option = Some(ui_elem);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if let Some(focused_elem) = focused_elem_option {
                // Store the focused element for getting bounds later (when we implement AXBounds parsing)
                _last_focused_elem = Some(focused_elem.clone());
                
                // Try to read text value
                let value_attr = AXAttribute::new(&CFString::from_static_string("AXValue"));
                if let Ok(text_val) = focused_elem.attribute(&value_attr) {
                    if let Some(cf_string) = text_val.downcast::<CFString>() {
                        let text = cf_string.to_string();
                        
                        // Only log if text is non-empty or if it changed
                        if text.len() > 0 || text != last_text {
                            println!("📝 Text monitor read text (length: {}): {}", text.len(), 
                                if text.len() > 100 { format!("{}...", &text[..100]) } else { text.clone() });
                        }
                        
                        if text != last_text {
                            println!("🔄 Text changed detected! Previous length: {}, New length: {}", last_text.len(), text.len());
                            last_text = text.clone();

                            // Reset grammar check timer when text changes
                            grammar_check_timer = Some(std::time::Instant::now());
                            last_grammar_check_text = text.clone();
                        }
                        
                        // Check if it's time to run grammar check (debounced)
                        if let Some(timer) = grammar_check_timer {
                            if timer.elapsed().as_millis() >= GRAMMAR_CHECK_DEBOUNCE_MS as u128 {
                                grammar_check_timer = None;
                                
                                // Only check grammar if text is meaningful
                                if !last_grammar_check_text.is_empty() && last_grammar_check_text.len() >= 3 {
                                    println!("🔍 Running grammar check for text (length: {})", last_grammar_check_text.len());
                                    
                                    // Get element bounds for positioning overlay
                                    // TODO: Properly parse AXBounds CFDictionary to get actual element position
                                    // For now, use a reasonable default position (top-right area of screen)
                                    // In the future, we'll parse the AXBounds dictionary to get the actual
                                    // x, y, width, height of the focused text element
                                    let overlay_x = Some(500.0);
                                    let overlay_y = Some(200.0);
                                    println!("📍 Positioning overlay at default position: x={}, y={}", overlay_x.unwrap(), overlay_y.unwrap());
                                    
                                    // Run grammar check (synchronous for now)
                                    let app_handle_clone = app_handle.clone();
                                    let text_to_check = last_grammar_check_text.clone();
                                    let cursor_pos_for_check = 0; // TODO: Get actual cursor position
                                    
                                    let result = check_grammar_internal(text_to_check, cursor_pos_for_check);
                                    
                                    // Emit grammar suggestions to frontend with position
                                    let payload = GrammarSuggestionsPayload {
                                        suggestions: result.suggestions.clone(),
                                        x: overlay_x,
                                        y: overlay_y,
                                    };
                                    println!("📤 Emitting grammar-suggestions event ({} suggestions, position: {:?}, {:?})", 
                                        result.suggestions.len(), overlay_x, overlay_y);
                                    let _ = app_handle_clone.emit("grammar-suggestions", payload);
                                }
                            }
                        }
                    }
                }
            } else {
                // No focused element, clear the stored element
                _last_focused_elem = None;
            }
            
            thread::sleep(Duration::from_millis(300)); // Debounce
        }
    });
    
    println!("✅ Text monitoring thread spawned successfully");
    Ok(())
}