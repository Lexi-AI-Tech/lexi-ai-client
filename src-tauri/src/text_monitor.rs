// src-tauri/src/text_monitor.rs

use accessibility::{AXAttribute, AXUIElement};
use core_foundation_sys::base::CFRange;
use core_graphics::geometry::{CGRect, CGPoint, CGSize};
use serde::Serialize;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use system_configuration::core_foundation::string::CFString;
use system_configuration::core_foundation::base::TCFType;

// External declarations for AXValue handling
extern "C" {
    fn AXValueGetType(value: *const std::ffi::c_void) -> u32;
    fn AXValueGetValue(value: *const std::ffi::c_void, value_type: u32, out_value: *mut std::ffi::c_void) -> bool;
}

// AXValue type constants (from ApplicationServices/AXValue.h)
const K_AX_VALUE_TYPE_CF_RANGE: u32 = 1;   // CFRange - character offsets
const K_AX_VALUE_TYPE_CG_RECT: u32 = 4;    // CGRect - bounding rectangle of selection

// Helper: Get cursor position (character offset) or fallback to text length
fn get_cursor_position(elem: &AXUIElement, text: &str) -> usize {
    let selected_range_attr = AXAttribute::new(&CFString::from_static_string("AXSelectedTextRange"));

    match elem.attribute(&selected_range_attr) {
        Ok(range_val) => {
            let ax_value_ptr = range_val.as_CFTypeRef();
            if ax_value_ptr.is_null() {
                println!("⚠️ AXSelectedTextRange returned null pointer");
                return text.len();
            }

            unsafe {
                let value_type = AXValueGetType(ax_value_ptr);

                match value_type {
                    K_AX_VALUE_TYPE_CF_RANGE => {
                        let mut cf_range = CFRange { location: 0, length: 0 };
                        if AXValueGetValue(
                            ax_value_ptr,
                            K_AX_VALUE_TYPE_CF_RANGE,
                            &mut cf_range as *mut _ as *mut std::ffi::c_void,
                        ) {
                            let pos = (cf_range.location + cf_range.length) as usize;
                            println!(
                                "📍 Cursor (CFRange): {} (selection length: {})",
                                pos, cf_range.length
                            );
                            return pos.min(text.len());
                        }
                    }

                    K_AX_VALUE_TYPE_CG_RECT => {
                        let mut rect: CGRect = CGRect {
                            origin: CGPoint { x: 0.0, y: 0.0 },
                            size: CGSize { width: 0.0, height: 0.0 },
                        };
                        if AXValueGetValue(
                            ax_value_ptr,
                            K_AX_VALUE_TYPE_CG_RECT,
                            &mut rect as *mut _ as *mut std::ffi::c_void,
                        ) {
                            println!(
                                "📍 Selection bounds (CGRect): x={:.1}, y={:.1}, w={:.1}, h={:.1}",
                                rect.origin.x, rect.origin.y, rect.size.width, rect.size.height
                            );
                            // Fallback to end of text (we can use rect for overlay later)
                            return text.len();
                        }
                    }

                    other => {
                        println!("⚠️ Unexpected AXValue type for selection range: {}", other);
                    }
                }
            }
        }
        Err(e) => {
            println!("⚠️ Failed to get AXSelectedTextRange attribute: {:?}", e);
        }
    }

    // Ultimate fallback: end of text
    text.len()
}

// Placeholder for future overlay positioning
fn _get_element_bounds(_elem: &AXUIElement) -> Option<(f64, f64, f64, f64)> {
    // TODO: Parse AXBounds (CFDictionary with X,Y,Width,Height)
    None
}

#[derive(Serialize, Clone)]
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
        let mut grammar_check_timer: Option<std::time::Instant> = None;
        const GRAMMAR_CHECK_DEBOUNCE_MS: u64 = 800;

        loop {
            let system_wide = AXUIElement::system_wide();
            let mut focused_elem_option: Option<AXUIElement> = None;

            // Try direct focused UI element first
            let focused_ui_attr = AXAttribute::new(&CFString::from_static_string("AXFocusedUIElement"));
            if let Ok(focused_ui) = system_wide.attribute(&focused_ui_attr) {
                if let Some(elem) = focused_ui.downcast::<AXUIElement>() {
                    focused_elem_option = Some(elem);
                }
            }

            // Fallback chain
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
                let value_attr = AXAttribute::new(&CFString::from_static_string("AXValue"));
                if let Ok(text_val) = focused_elem.attribute(&value_attr) {
                    if let Some(cf_string) = text_val.downcast::<CFString>() {
                        let text = cf_string.to_string();

                        if text != last_text || last_text.is_empty() {
                            let cursor_pos = get_cursor_position(&focused_elem, &text);

                            println!(
                                "🔄 Text changed | len: {} → {} | cursor: {} | preview: {}",
                                last_text.len(),
                                text.len(),
                                cursor_pos,
                                if text.len() > 80 {
                                    format!("{}...", &text[..80])
                                } else {
                                    text.clone()
                                }
                            );

                            last_text = text.clone();
                            last_grammar_check_text = text.clone();
                            grammar_check_timer = Some(std::time::Instant::now());
                        }

                        // Debounced grammar check
                        if let Some(timer) = grammar_check_timer {
                            if timer.elapsed().as_millis() >= GRAMMAR_CHECK_DEBOUNCE_MS as u128 {
                                grammar_check_timer = None;

                                if !last_grammar_check_text.is_empty() && last_grammar_check_text.len() >= 5 {
                                    println!("🔍 Running grammar check (debounced)");

                                    // TODO: Use real bounds when implemented
                                    let overlay_x = Some(600.0);
                                    let overlay_y = Some(300.0);

                                    let cursor_pos = get_cursor_position(&focused_elem, &last_grammar_check_text);

                                    let result = crate::grammar_checker::check_grammar_internal(
                                        last_grammar_check_text.clone(),
                                        cursor_pos,
                                    );

                                    let payload = GrammarSuggestionsPayload {
                                        suggestions: result.suggestions,
                                        x: overlay_x,
                                        y: overlay_y,
                                    };

                                    println!(
                                        "📤 Emitting grammar-suggestions ({} items)",
                                        payload.suggestions.len()
                                    );
                                    let _ = app_handle.emit("grammar-suggestions", payload);
                                }
                            }
                        }
                    }
                }
            }

            thread::sleep(Duration::from_millis(250));
        }
    });

    println!("✅ Monitoring thread spawned successfully");
    Ok(())
}