use super::{get_selected_text_via_clipboard, CursorContext};

/// Get cursor context on Windows: active window app name and selected text.
///
/// Uses `active-win-pos-rs` for the focused application name and clipboard
/// copy simulation (Ctrl+C via enigo) for selected text.
pub fn get_cursor_context() -> Option<CursorContext> {
    let app_name = get_frontmost_application_name();
    let selected_text = get_selected_text_via_clipboard();
    Some(CursorContext {
        selected_text,
        app_name,
    })
}

/// Returns the frontmost (active) application name on Windows.
pub fn get_frontmost_application_name() -> Option<String> {
    let active = active_win_pos_rs::get_active_window().ok()?;
    let name = active.app_name;
    if name.is_empty() {
        Some("Unknown".to_string())
    } else {
        Some(name)
    }
}
