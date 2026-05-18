//! Audio capture and encoding for Lexi.
//!
//! | Module | Role |
//! |--------|------|
//! | [`recorder`] | Microphone capture (`cpal`) |
//! | [`thread`] | Hotkey recording loop (assistant / action / doc) |
//! | [`meeting`] | Live meeting mic + system audio |
//! | `pipeline`, `resampler` | Windows-only STT preprocessing before upload |

pub mod meeting;
pub mod recorder;
pub mod thread;

// Windows: mono 16 kHz pipeline before cloud STT (see `recorder::windows`).
#[cfg(target_os = "windows")]
pub mod pipeline;
#[cfg(target_os = "windows")]
pub mod resampler;
