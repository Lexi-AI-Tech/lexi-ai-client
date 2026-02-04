/**
 * Auth Store
 *
 * Manages authentication state for Lexi AI.
 * This is a pure in-memory state manager - all storage is handled by Rust backend.
 *
 * Storage operations:
 * - Startup: Calls Rust get_auth_data to load persisted state
 * - Login: Rust WebSocket stores auth, React just updates in-memory state
 * - Logout: Calls Rust clear_auth_data
 */

import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AuthUser, AuthTokens, AuthState, AuthData } from "../types";

// Store state (in-memory only)
let isAuthenticated: boolean = false;
let user: AuthUser | null = null;
let tokens: AuthTokens | null = null;
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
    const authData = await invoke<AuthData | null>("get_auth_data");
    if (authData) {
      console.log("✅ Loaded auth data from Rust backend");
      isAuthenticated = true;
      user = authData.user || null;
      tokens = {
        access_token: authData.access_token,
        refresh_token: authData.refresh_token,
        expires_at: authData.expires_at,
        expires_in: authData.expires_in,
      };
    }
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
  tokens = null;
  error = null;

  invoke("clear_auth_data").catch((err: unknown) => {
    console.error("Failed to clear auth data:", err);
  });

  const { onboardingStore } = await import("./onboardingStore");
  await onboardingStore.refreshState();

  notifyListeners();
}).catch((err: unknown) => {
  console.error("Failed to setup auth_expired listener:", err);
});

export const authStore: AuthState = {
  get isAuthenticated() {
    return isAuthenticated;
  },
  get user() {
    return user;
  },
  get tokens() {
    return tokens;
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

  // Update in-memory state only - storage is handled by Rust
  setAuthData: (newTokens: AuthTokens, newUser: AuthUser) => {
    tokens = newTokens;
    user = newUser;
    isAuthenticated = true;
    error = null;
    notifyListeners();
  },

  // Clear auth - calls Rust to clear storage
  clearAuth: () => {
    isAuthenticated = false;
    user = null;
    tokens = null;
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

  // No-op: Token refresh is handled automatically by Rust
  refreshTokenIfNeeded: async () => {
    return false;
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
