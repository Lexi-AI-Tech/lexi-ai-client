//! Onboarding State Management Module
//!
//! This module provides Tauri commands for managing the onboarding flow state.
//! Onboarding state is stored in Tauri Store (persistent storage) instead of localStorage.
//!
//! ## Commands
//! - `get_onboarding_state` - Get current onboarding step and completion status
//! - `set_onboarding_step` - Set the current onboarding step
//! - `next_onboarding_step` - Move to the next step
//! - `previous_onboarding_step` - Move to the previous step
//! - `complete_onboarding` - Mark onboarding as completed
//! - `reset_onboarding` - Reset onboarding to initial state

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = ".onboarding.dat";

/// Onboarding step types
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum OnboardingStep {
    Welcome,
    Permissions,
    #[serde(rename = "hotkey-test")]
    HotkeyTest,
    #[serde(rename = "microphone-test")]
    MicrophoneTest,
    Home,
}

/// Onboarding state structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingState {
    pub current_step: OnboardingStep,
    pub is_completed: bool,
}

impl Default for OnboardingState {
    fn default() -> Self {
        Self {
            current_step: OnboardingStep::Welcome,
            is_completed: false,
        }
    }
}

/// Step order for navigation
const STEP_ORDER: &[OnboardingStep] = &[
    OnboardingStep::Welcome,
    OnboardingStep::Permissions,
    OnboardingStep::HotkeyTest,
    OnboardingStep::MicrophoneTest,
    OnboardingStep::Home,
];

/// Get current onboarding state
///
/// Returns the current onboarding step and completion status.
/// If no state exists, returns default (welcome step, not completed).
///
/// # Returns
/// * `OnboardingState` - Current onboarding state
#[tauri::command]
pub fn get_onboarding_state(app: AppHandle) -> Result<OnboardingState, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to access onboarding storage: {}", e))?;

    match store.get("state") {
        Some(state_value) => match serde_json::from_value::<OnboardingState>(state_value.clone()) {
            Ok(state) => {
                println!("✅ Loaded onboarding state from store");
                Ok(state)
            }
            Err(e) => {
                println!(
                    "⚠️  Failed to deserialize onboarding state: {}, using default",
                    e
                );
                Ok(OnboardingState::default())
            }
        },
        None => {
            println!("📝 No onboarding state found, using default");
            Ok(OnboardingState::default())
        }
    }
}

/// Set the current onboarding step
///
/// Updates the current step in the onboarding flow.
///
/// # Arguments
/// * `step` - The step to set (as string: "welcome", "permissions", "hotkey-test", "microphone-test", "home")
///
/// # Returns
/// * `OnboardingState` - Updated onboarding state
#[tauri::command]
pub fn set_onboarding_step(app: AppHandle, step: String) -> Result<OnboardingState, String> {
    let onboarding_step = match step.as_str() {
        "welcome" => OnboardingStep::Welcome,
        "permissions" => OnboardingStep::Permissions,
        "hotkey-test" => OnboardingStep::HotkeyTest,
        "microphone-test" => OnboardingStep::MicrophoneTest,
        "home" => OnboardingStep::Home,
        _ => return Err(format!("Invalid onboarding step: {}", step)),
    };

    let mut state = get_onboarding_state(app.clone())?;
    state.current_step = onboarding_step;

    save_onboarding_state(&app, &state)?;
    Ok(state)
}

/// Move to the next onboarding step
///
/// Advances to the next step in the onboarding flow.
/// Does nothing if already at the last step.
///
/// # Returns
/// * `OnboardingState` - Updated onboarding state
#[tauri::command]
pub fn next_onboarding_step(app: AppHandle) -> Result<OnboardingState, String> {
    let mut state = get_onboarding_state(app.clone())?;

    let current_index = STEP_ORDER
        .iter()
        .position(|&s| s == state.current_step)
        .unwrap_or(0);

    if current_index < STEP_ORDER.len() - 1 {
        state.current_step = STEP_ORDER[current_index + 1];
        save_onboarding_state(&app, &state)?;
    }

    Ok(state)
}

/// Move to the previous onboarding step
///
/// Goes back to the previous step in the onboarding flow.
/// Does nothing if already at the first step.
///
/// # Returns
/// * `OnboardingState` - Updated onboarding state
#[tauri::command]
pub fn previous_onboarding_step(app: AppHandle) -> Result<OnboardingState, String> {
    let mut state = get_onboarding_state(app.clone())?;

    let current_index = STEP_ORDER
        .iter()
        .position(|&s| s == state.current_step)
        .unwrap_or(0);

    if current_index > 0 {
        state.current_step = STEP_ORDER[current_index - 1];
        save_onboarding_state(&app, &state)?;
    }

    Ok(state)
}

/// Complete the onboarding flow
///
/// Marks onboarding as completed and sets the step to "home".
///
/// # Returns
/// * `OnboardingState` - Updated onboarding state
#[tauri::command]
pub fn complete_onboarding(app: AppHandle) -> Result<OnboardingState, String> {
    let mut state = get_onboarding_state(app.clone())?;
    state.is_completed = true;
    state.current_step = OnboardingStep::Home;

    save_onboarding_state(&app, &state)?;
    Ok(state)
}

/// Reset the onboarding flow
///
/// Resets onboarding to the initial state (welcome step, not completed).
///
/// # Returns
/// * `OnboardingState` - Reset onboarding state
#[tauri::command]
pub fn reset_onboarding(app: AppHandle) -> Result<OnboardingState, String> {
    let state = OnboardingState::default();
    save_onboarding_state(&app, &state)?;
    Ok(state)
}

/// Save onboarding state to Tauri Store
fn save_onboarding_state(app: &AppHandle, state: &OnboardingState) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to access onboarding storage: {}", e))?;

    let state_json = serde_json::to_value(state)
        .map_err(|e| format!("Failed to serialize onboarding state: {}", e))?;

    store.set("state", state_json);
    store
        .save()
        .map_err(|e| format!("Failed to save onboarding state: {}", e))?;

    println!("✅ Saved onboarding state to store");
    Ok(())
}
