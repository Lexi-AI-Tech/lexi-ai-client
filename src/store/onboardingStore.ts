/**
 * Onboarding Store
 *
 * Manages the onboarding flow state for Lexi AI.
 */

import { invoke } from "@tauri-apps/api/core";
import React, { useEffect } from "react";
import type { OnboardingStep, OnboardingState } from "../types";

interface RustOnboardingState {
  current_step: string;
  is_completed: boolean;
}

let currentStep: OnboardingStep = "welcome";
let isCompleted: boolean = false;
let storageInitialized: boolean = false;

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

loadFromStorage();

const listeners: Set<() => void> = new Set();

const notifyListeners = () => {
  listeners.forEach((listener) => listener());
};

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
      // Persist completion to server (by system type and version) then update local state
      await invoke("complete_server_onboarding", { version: 1 }).catch((e) =>
        console.error("Failed to mark onboarding complete on server:", e)
      );
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
  refreshState: async () => {
    try {
      const state = await invoke<RustOnboardingState>("get_onboarding_state");
      currentStep = normalizeStep(state.current_step);
      isCompleted = state.is_completed;
      notifyListeners();
    } catch (e) {
      console.error("Failed to refresh onboarding state:", e);
    }
  },
};

export const useOnboardingStore = () => {
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

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
