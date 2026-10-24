//! Audio capture and encoding for Lexi.
//!
//! | Module | Role |
//! |--------|------|
//! | [`recorder`] | Microphone capture (`cpal`) |
//! | [`thread`] | Hotkey recording loop (assistant / action / doc) |
//! | [`meeting`] | Live meeting mic + system audio |
//! | `pipeline`, `resampler` | STT preprocessing (mono 16 kHz) before upload (Windows) or local inference |

pub mod meeting;
pub mod recorder;
pub mod thread;

// Mono 16 kHz pipeline: Windows cloud STT (see `recorder::windows`) and offline STT.
pub mod pipeline;
pub mod resampler;
