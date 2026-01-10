/**
 * Onboarding Store
 *
 * Manages the onboarding flow state for Lexi AI.
 * Now uses Rust Tauri commands for persistent storage instead of localStorage.
 * State is stored in Tauri Store (persistent storage) via Rust commands.
 */

import { invoke } from "@tauri-apps/api/core";
import React, { useEffect } from "react";
import type { OnboardingStep, OnboardingState } from "../types";

// Onboarding state from Rust
interface RustOnboardingState {
  current_step: string; // "welcome" | "permissions" | "hotkey-test" | "microphone-test" | "home"
  is_completed: boolean;
}

// Store state (cached locally for reactive updates)
let currentStep: OnboardingStep = "welcome";
let isCompleted: boolean = false;
let storageInitialized: boolean = false;

// Load from Rust storage
const loadFromStorage = async () => {
  try {
    const state = await invoke<RustOnboardingState>("get_onboarding_state");
    currentStep = state.current_step as OnboardingStep;
    isCompleted = state.is_completed;
    storageInitialized = true;
    notifyListeners();
  } catch (e) {
    console.error("Failed to load onboarding state:", e);
    // Use defaults if loading fails
    currentStep = "welcome";
    isCompleted = false;
    storageInitialized = true;
    notifyListeners();
  }
};

// Initialize from storage (async, but don't block)
loadFromStorage();

// Listeners for state changes
const listeners: Set<() => void> = new Set();

const notifyListeners = () => {
  listeners.forEach((listener) => listener());
};

// Helper to convert Rust step format to TypeScript format
const normalizeStep = (step: string): OnboardingStep => {
  switch (step) {
    case "welcome":
    case "permissions":
    case "hotkey-test":
    case "microphone-test":
    case "home":
      return step as OnboardingStep;
    default:
      return "welcome";
  }
};

export const onboardingStore: OnboardingState = {
  get currentStep() {
    return currentStep;
  },
  get isCompleted() {
    return isCompleted;
  },
  get isInitialized() {
    return storageInitialized;
  },
  setStep: async (step: OnboardingStep) => {
    try {
      const state = await invoke<RustOnboardingState>("set_onboarding_step", {
        step,
      });
      currentStep = normalizeStep(state.current_step);
      isCompleted = state.is_completed;
      notifyListeners();
    } catch (e) {
      console.error("Failed to set onboarding step:", e);
    }
  },
  nextStep: async () => {
    try {
      const state = await invoke<RustOnboardingState>("next_onboarding_step");
      currentStep = normalizeStep(state.current_step);
      isCompleted = state.is_completed;
      notifyListeners();
    } catch (e) {
      console.error("Failed to move to next step:", e);
    }
  },
  previousStep: async () => {
    try {
      const state = await invoke<RustOnboardingState>(
        "previous_onboarding_step",
      );
      currentStep = normalizeStep(state.current_step);
      isCompleted = state.is_completed;
      notifyListeners();
    } catch (e) {
      console.error("Failed to move to previous step:", e);
    }
  },
  completeOnboarding: async () => {
    try {
      const state = await invoke<RustOnboardingState>("complete_onboarding");
      currentStep = normalizeStep(state.current_step);
      isCompleted = state.is_completed;
      notifyListeners();
    } catch (e) {
      console.error("Failed to complete onboarding:", e);
    }
  },
  resetOnboarding: async () => {
    try {
      const state = await invoke<RustOnboardingState>("reset_onboarding");
      currentStep = normalizeStep(state.current_step);
      isCompleted = state.is_completed;
      notifyListeners();
    } catch (e) {
      console.error("Failed to reset onboarding:", e);
    }
  },
};

// React hook to subscribe to store changes
export const useOnboardingStore = () => {
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  // Load state on mount if not initialized
  useEffect(() => {
    if (!storageInitialized) {
      loadFromStorage().then(() => {
        forceUpdate();
      });
    }
  }, []);

  React.useEffect(() => {
    const listener = () => {
      forceUpdate();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return onboardingStore;
};
