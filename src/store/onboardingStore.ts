/**
 * Onboarding Store
 * 
 * Manages the onboarding flow state for Lexi AI.
 * Stores the current step and completion status.
 */

export type OnboardingStep = 
  | 'welcome'
  | 'permissions'
  | 'fn-key-test'
  | 'microphone-test'
  | 'home';

export interface OnboardingState {
  currentStep: OnboardingStep;
  isCompleted: boolean;
  setStep: (step: OnboardingStep) => void;
  nextStep: () => void;
  previousStep: () => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
}

// Step order for navigation
const STEP_ORDER: OnboardingStep[] = [
  'welcome',
  'permissions',
  'fn-key-test',
  'microphone-test',
  'home'
];

// Store state
let currentStep: OnboardingStep = 'welcome';
let isCompleted: boolean = false;

// Load from localStorage on initialization
const loadFromStorage = () => {
  try {
    const stored = localStorage.getItem('lexi-onboarding');
    if (stored) {
      const parsed = JSON.parse(stored);
      currentStep = parsed.currentStep || 'welcome';
      isCompleted = parsed.isCompleted || false;
    }
  } catch (e) {
    console.error('Failed to load onboarding state:', e);
  }
};

// Save to localStorage
const saveToStorage = () => {
  try {
    localStorage.setItem('lexi-onboarding', JSON.stringify({
      currentStep,
      isCompleted
    }));
  } catch (e) {
    console.error('Failed to save onboarding state:', e);
  }
};

// Initialize from storage
loadFromStorage();

// Listeners for state changes
const listeners: Set<() => void> = new Set();

const notifyListeners = () => {
  listeners.forEach(listener => listener());
};

export const onboardingStore: OnboardingState = {
  get currentStep() {
    return currentStep;
  },
  get isCompleted() {
    return isCompleted;
  },
  setStep: (step: OnboardingStep) => {
    currentStep = step;
    saveToStorage();
    notifyListeners();
  },
  nextStep: () => {
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex < STEP_ORDER.length - 1) {
      currentStep = STEP_ORDER[currentIndex + 1];
      saveToStorage();
      notifyListeners();
    }
  },
  previousStep: () => {
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex > 0) {
      currentStep = STEP_ORDER[currentIndex - 1];
      saveToStorage();
      notifyListeners();
    }
  },
  completeOnboarding: () => {
    isCompleted = true;
    currentStep = 'home';
    saveToStorage();
    notifyListeners();
  },
  resetOnboarding: () => {
    currentStep = 'welcome';
    isCompleted = false;
    saveToStorage();
    notifyListeners();
  }
};

// Import React for the hook
import React from 'react';

// React hook to subscribe to store changes
export const useOnboardingStore = () => {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  
  React.useEffect(() => {
    const listener = () => forceUpdate();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  
  return onboardingStore;
};
