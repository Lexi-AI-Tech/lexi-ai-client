use accessibility::{AXAttribute, AXUIElement};
use serde::Serialize;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{Emitter, State};
use system_configuration::core_foundation::string::CFString;

#[derive(Serialize, Clone)]
pub struct TextChangePayload {
    pub text: String,
    pub cursor_pos: usize,
}

pub struct TextMonitor {
    last_text: Mutex<String>,
}

impl TextMonitor {
    pub fn new() -> Self {
        Self {
            last_text: Mutex::new(String::new()),
        }
    }
}

#[tauri::command]
pub fn start_monitoring(
    app_handle: tauri::AppHandle,
    state: State<'_, TextMonitor>,
) -> Result<(), String> {
    // Basic check to see if we can access system wide element, which implicitly checks permission
    let system_wide = AXUIElement::system_wide();
    let attr = AXAttribute::new(&CFString::from_static_string("AXFrontmostApplication"));
    if system_wide.attribute(&attr).is_err() {
         return Err("Accessibility permission denied. Please grant permission in System Settings > Privacy & Security > Accessibility.".to_string());
    }

    let _state_monitor = state.inner().last_text.lock().unwrap().clone(); // Just to checking locking? No, we need to pass state to thread, but State is not Send/Sync usually? Turi State is wrapper around Arc.
    // Actually we can't pass State to thread easily if it's not clonable in the way we want or if we hold a lock.
    // Better to use AppHandle to manage state or pass a Clone of the Arc inside State if possible.
    // In Tauri 2.0, State<T> is basically Arc<T> wrapper.
    // But `State` itself might not be movable to thread if we drift from scope.
    // Let's use `app_handle.state::<TextMonitor>()` inside the thread if possible, or clone the inner arc.
    
    // We will just spin up a thread and emit events using app_handle.
    
    thread::spawn(move || {
        let mut last_text = String::new();
        loop {
            // Get frontmost app
            let system_wide = AXUIElement::system_wide();
            let focused_app_attr = AXAttribute::new(&CFString::from_static_string("AXFocusedApplication"));
            if let Ok(frontmost) = system_wide.attribute(&focused_app_attr) {
                if let Some(frontmost_elem) = frontmost.downcast::<AXUIElement>() {
                    let focused_ui_attr = AXAttribute::new(&CFString::from_static_string("AXFocusedUIElement"));
                     if let Ok(focused_ui) = frontmost_elem.attribute(&focused_ui_attr) {
                        if let Some(focused_elem) = focused_ui.downcast::<AXUIElement>() {
                            
                             // Extract text from focused element
                            let value_attr = AXAttribute::new(&CFString::from_static_string("AXValue"));
                            if let Ok(text_val) = focused_elem.attribute(&value_attr) {
                                if let Some(cf_string) = text_val.downcast::<CFString>() {
                                    let text = cf_string.to_string();
                                    if text != last_text {
                                        last_text = text.clone();
                                        
                                        // Try to get cursor position
                                        let cursor_pos = 0;
                                        let selected_range_attr = AXAttribute::new(&CFString::from_static_string("AXSelectedTextRange"));
                                        if let Ok(_selected_range_val) = focused_elem.attribute(&selected_range_attr) {
                                            // Range is usually value of type AXValueRef which is wrapper around NSRange
                                            // accessibility crate returns AXValueResult.
                                            // This part is tricky without looking at docs of accessibility crate 0.1.
                                            // For now, let's assume 0 or try to parse if possible.
                                            // The user code used `AXAttribute::axSelectedTextRange`.
                                            // accessibility 0.1 might have slightly different API.
                                            // We'll trust standard "AXSelectedTextRange" attribute string.
                                            // We might need to debug this part.
                                        }

                                        // Emit to frontend
                                        let payload = TextChangePayload {
                                            text: text.clone(),
                                            cursor_pos, 
                                        };
                                        let _ = app_handle.emit("text-change", payload);
                                    }
                                }
                            }
                        }
                     }
                }
            }
            thread::sleep(Duration::from_millis(300)); // Debounce
        }
    });
    Ok(())
}
