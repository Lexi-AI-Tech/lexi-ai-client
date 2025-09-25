use std::process::Command;
use std::error::Error;

pub struct TextInjector;

impl TextInjector {
    pub fn new() -> Self {
        Self
    }

    pub fn inject_text(&self, text: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
        // Use AppleScript to type text at the current cursor position
        let script = format!(
            "tell application \"System Events\"\n\
             set the clipboard to \"{}\"\n\
             keystroke \"v\" using command down\n\
             end tell",
            text.replace("\"", "\\\"")
        );

        let output = Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()?;

        if !output.status.success() {
            return Err(format!(
                "Failed to inject text: {}",
                String::from_utf8_lossy(&output.stderr)
            ).into());
        }

        Ok(())
    }
}
