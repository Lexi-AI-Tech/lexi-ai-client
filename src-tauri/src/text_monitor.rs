// src-tauri/src/text_monitor.rs

use accessibility::{AXAttribute, AXUIElement};
use serde::Serialize;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use system_configuration::core_foundation::string::CFString;

#[derive(Serialize, Clone)]
pub struct TextChangePayload {
    pub text: String,
    pub cursor_pos: usize,
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
                            
                            // Try to get cursor position
                            let cursor_pos = 0;
                            let selected_range_attr = AXAttribute::new(&CFString::from_static_string("AXSelectedTextRange"));
                            if let Ok(_selected_range_val) = focused_elem.attribute(&selected_range_attr) {
                                // TODO: Parse cursor position from AXSelectedTextRange
                                // For now, default to 0
                            }

                            // Emit to frontend
                            let payload = TextChangePayload {
                                text: text.clone(),
                                cursor_pos, 
                            };
                            println!("📤 Emitting text-change event to frontend (text length: {}, cursor_pos: {})", text.len(), cursor_pos);
                            let _ = app_handle.emit("text-change", payload);
                        }
                    }
                }
            }
            
            thread::sleep(Duration::from_millis(300)); // Debounce
        }
    });
    
    println!("✅ Text monitoring thread spawned successfully");
    Ok(())
}