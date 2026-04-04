//! OS-level permission checks and Tauri commands (microphone, accessibility, system audio).
//!
//! macOS logic lives in `macos.rs`; other targets use `stub.rs` no-ops.

#![allow(unexpected_cfgs)]

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(not(target_os = "macos"))]
mod stub;
#[cfg(not(target_os = "macos"))]
pub use stub::*;
