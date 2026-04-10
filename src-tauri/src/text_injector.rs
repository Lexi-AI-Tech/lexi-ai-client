//! Text Injector Module
//!
//! This module handles injecting transcribed text into the currently active application
//! at the current cursor position. It uses a clipboard + paste keystroke approach that
//! works across all applications and platforms.
//!
//! ## Implementation Strategy
//!
//! The injection method uses a two-step process:
//! 1. **Clipboard**: Copy the text to the system clipboard using `arboard`
//! 2. **Paste Keystroke**: Simulate the paste keyboard shortcut via `keyboard_simulator` module
//!    - macOS: Cmd+V (via AppleScript)
//!    - Windows/Linux: Ctrl+V (via `enigo`)
//!
//! This approach is more reliable than direct text injection because:
//! - Works in all applications (browsers, text editors, terminals, etc.)
//! - Respects application-specific paste behavior
//! - Doesn't require low-level window manipulation
//!
//! ## Dependencies
//!
//! - **arboard**: Cross-platform clipboard management (macOS, Windows, Linux/X11)
//! - **keyboard_simulator**: Common module for cross-platform keyboard simulation
//!   - Uses AppleScript (macOS) for keyboard event simulation
//!   - Uses enigo (Windows/Linux) for cross-platform keyboard event simulation
//!
//! ## Permissions Required
//!
//! - **Accessibility** (macOS): Required for keyboard simulation via AppleScript

use arboard::Clipboard;
use std::error::Error;
use std::thread;
use std::time::Duration;

/// TextInjector provides cross-platform functionality to inject text into the active application
///
/// This implementation uses:
/// 1. `arboard` to set the system clipboard (cross-platform: macOS, Windows, Linux/X11)
/// 2. `keyboard_simulator` module to simulate the paste keystroke
///    - macOS: Cmd+V (via AppleScript)
///    - Windows/Linux: Ctrl+V (via enigo)
///
/// This approach works across all applications and inserts text at the
/// current cursor position, making it ideal for voice-to-text workflows.
///
/// # Permissions
/// - **macOS**: Requires **Accessibility** access for keyboard simulation
/// - **Windows**: Usually works without extra permissions
/// - **Linux**: Needs X11 (enigo's Wayland support is experimental)
pub struct TextInjector;

impl TextInjector {
    /// Creates a new TextInjector instance
    pub fn new() -> Self {
        Self
    }

    /// Injects text into the currently active application
    ///
    /// This method:
    /// 1. Saves the current clipboard content (optional preservation)
    /// 2. Copies the provided text to the system clipboard
    /// 3. Simulates a paste keystroke (Cmd+V on macOS, Ctrl+V elsewhere)
    /// 4. Optionally restores the original clipboard content
    ///
    /// The text is inserted at the current cursor position in whatever application
    /// is currently active (text editor, browser, terminal, etc.).
    ///
    /// # Arguments
    /// * `text` - The text to inject into the active application
    ///
    /// # Returns
    /// * `Ok(())` - Successfully injected the text
    /// * `Err(Box<dyn Error>)` - An error if clipboard or key simulation fails
    ///
    /// # Note
    /// This method temporarily overwrites the clipboard contents. The original
    /// clipboard is preserved on a best-effort basis.
    pub fn inject_text(&self, text: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
        let mut clipboard = Clipboard::new()?;

        let original_clipboard_text = clipboard.get_text().ok();

        // Step 1: Set clipboard to the text we want to inject
        // arboard handles UTF-8 encoding and special characters automatically
        clipboard.set_text(text)?;

        // Small delay to ensure clipboard is ready
        thread::sleep(Duration::from_millis(80));

        // Step 2: Simulate paste keystroke via keyboard_simulator module
        // Handles platform-specific implementation (AppleScript on macOS, enigo on Windows/Linux)
        crate::keyboard_simulator::simulate_paste()?;

        // Brief delay to ensure paste processes (some apps need a moment)
        thread::sleep(Duration::from_millis(350));

        if let Some(original) = original_clipboard_text {
            let _ = clipboard.set_text(original);
        } else if clipboard.get_text().ok().as_deref() == Some(text) {
            let _ = clipboard.clear();
        }

        Ok(())
    }
}
