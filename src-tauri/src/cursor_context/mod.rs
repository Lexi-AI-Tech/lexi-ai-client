use arboard::Clipboard;
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct CursorContext {
    pub selected_text: Option<String>,
    pub app_name: Option<String>,
}

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

/// Get selected text by simulating copy command (Cmd+C on macOS, Ctrl+C elsewhere)
///
/// This function:
/// 1. Saves the current clipboard content
/// 2. Simulates copy command via `keyboard_simulator` module
/// 3. Waits briefly for the copy operation to complete
/// 4. Retrieves the copied text from clipboard
/// 5. Restores the original clipboard content
/// 6. Returns the selected text
pub fn get_selected_text_via_clipboard() -> Option<String> {
    let mut clipboard = match Clipboard::new() {
        Ok(clip) => clip,
        Err(e) => {
            eprintln!("Failed to initialize clipboard: {}", e);
            return None;
        }
    };

    // Step 1: Save current clipboard content
    let original_clipboard = clipboard.get_text().unwrap_or_default();

    // Step 2: Clear clipboard to ensure we get fresh data
    if let Err(e) = clipboard.clear() {
        eprintln!("Failed to clear clipboard: {}", e);
        return None;
    }

    // Step 3: Simulate copy command via keyboard_simulator module
    let copy_result = crate::keyboard_simulator::simulate_copy();

    if let Err(e) = copy_result {
        eprintln!("Failed to simulate copy command: {}", e);
        // Restore clipboard before returning
        let _ = clipboard.set_text(original_clipboard);
        return None;
    }

    // Step 4: Wait for copy operation to complete
    thread::sleep(Duration::from_millis(50));

    // Step 5: Get the copied text from clipboard
    let selected_text = clipboard.get_text().unwrap_or_default();

    // Step 6: Restore original clipboard content
    let _ = clipboard.set_text(original_clipboard);

    // Return the selected text (empty string means no selection)
    if selected_text.is_empty() {
        None
    } else {
        Some(selected_text)
    }
}

/// Stub implementation for non-macOS, non-Windows platforms
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn get_cursor_context() -> Option<CursorContext> {
    None
}
