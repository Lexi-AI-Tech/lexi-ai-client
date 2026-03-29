/**
 * Auth Store
 *
 * Manages authentication state for Lexi AI.
 * This is a pure in-memory UI state wrapper - all auth source of truth lives in Rust.
 *
 * Storage operations:
 * - Startup: Calls Rust `auth_get_state` to load UI-safe state
 * - Changes: Rust emits `auth_state_changed`; we re-fetch `auth_get_state`
 * - Logout/Clear: Calls Rust `clear_auth_data`
 */

import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AuthUiState, AuthUser, AuthState } from "../types";
import { onboardingStore } from "./onboardingStore";

// Store state (in-memory only)
let isAuthenticated: boolean = false;
let user: AuthUser | null = null;
let isLoading: boolean = false;
let error: string | null = null;
let storageInitialized: boolean = false;

// Listeners for state changes
const listeners: Set<() => void> = new Set();

const notifyListeners = () => {
  listeners.forEach((listener) => listener());
};

// Load auth state from Rust backend on startup
const initializeFromRust = async () => {
  try {
    const state = await invoke<AuthUiState>("auth_get_state");
    isAuthenticated = !!state?.is_authenticated;
    user = (state?.user as AuthUser | null | undefined) ?? null;
  } catch (e) {
    console.error("Failed to load auth state from Rust:", e);
  }

  storageInitialized = true;
  notifyListeners();
};

// Initialize on module load
initializeFromRust();

// Listen for auth_expired events from Rust backend
// Rust already cleared auth and reset onboarding; we sync in-memory state and refresh onboarding UI.
listen("auth_expired", async () => {
  console.log("🔴 Auth expired event received, clearing auth state");
  isAuthenticated = false;
  user = null;
  error = null;

  await onboardingStore.refreshState();

  notifyListeners();
}).catch((err: unknown) => {
  console.error("Failed to setup auth_expired listener:", err);
});

// Listen for auth state changes (login/logout/refresh) from Rust backend.
// Rust is the source of truth; we just re-fetch the latest UI-safe state.
listen("auth_state_changed", async () => {
  await initializeFromRust();
}).catch((err: unknown) => {
  console.error("Failed to setup auth_state_changed listener:", err);
});

export const authStore: AuthState = {
  get isAuthenticated() {
    return isAuthenticated;
  },
  get user() {
    return user;
  },
  get isLoading() {
    return isLoading;
  },
  get error() {
    return error;
  },
  get isInitialized() {
    return storageInitialized;
  },

  // Clear auth - calls Rust to clear storage
  clearAuth: () => {
    isAuthenticated = false;
    user = null;
    error = null;

    // Clear from Rust backend
    invoke("clear_auth_data").catch((err) => {
      console.error("Failed to clear auth data:", err);
    });

    notifyListeners();
  },

  setLoading: (loading: boolean) => {
    isLoading = loading;
    notifyListeners();
  },

  setError: (err: string | null) => {
    error = err;
    notifyListeners();
  },

  // Reload auth state from Rust backend
  checkAuth: async () => {
    await initializeFromRust();
  },
};

// React hook to subscribe to store changes
export const useAuthStore = () => {
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  React.useEffect(() => {
    const listener = () => forceUpdate();
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }, []);

  return authStore;
};
