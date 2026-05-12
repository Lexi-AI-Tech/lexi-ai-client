use super::{get_selected_text_via_clipboard, CursorContext};

/// Get cursor context: active window app name and selected text.
///
/// Same approach as active-win-pos-rs:
/// - **Focused app**: NSWorkspace `frontmostApplication` (the active window’s app).
/// - **Selected text**: Clipboard copy simulation (Cmd+C) then read.
///
/// Returns a CursorContext with selected text and app name, or None if retrieval fails.
pub fn get_cursor_context() -> Option<CursorContext> {
    let app_name = get_frontmost_application_name()?;
    let selected_text = get_selected_text_via_clipboard();
    Some(CursorContext {
        selected_text,
        app_name: Some(app_name),
    })
}

/// Returns the frontmost (active) application name.
pub fn get_frontmost_application_name() -> Option<String> {
    let active = active_win_pos_rs::get_active_window().ok()?;
    let name = active.app_name;
    if name.is_empty() {
        Some("Unknown".to_string())
    } else {
        Some(name)
    }
}
