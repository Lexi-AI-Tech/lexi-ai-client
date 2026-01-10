/**
 * Auth Store
 *
 * Manages authentication state for Lexi AI.
 * Stores user info, tokens, and authentication status.
 * Uses OS keychain for secure storage (macOS Keychain, Windows Credential Manager, Linux Secret Service).
 */

import React from "react";
import {
  storeAuthDataSecure,
  getAuthDataSecure,
  clearAuthDataSecure,
} from "../lib/secureStorage";
import type { AuthUser, AuthTokens, AuthState } from "../types";

// Store state
let isAuthenticated: boolean = false;
let user: AuthUser | null = null;
let tokens: AuthTokens | null = null;
let isLoading: boolean = false;
let error: string | null = null;
let storageInitialized: boolean = false;

// Load from secure storage (OS keychain)
const loadFromStorage = async () => {
  try {
    const secureData = await getAuthDataSecure();
    if (secureData) {
      console.log("✅ Loaded auth data from secure storage (OS keychain)");
      isAuthenticated = true;
      user = secureData.user || null;
      tokens = {
        access_token: secureData.access_token,
        refresh_token: secureData.refresh_token,
        expires_at: secureData.expires_at,
        expires_in: secureData.expires_in,
      };

      storageInitialized = true;
      notifyListeners();
      return;
    }
  } catch (e) {
    console.error("Failed to load auth state from secure storage:", e);
  }

  // No auth data found - mark as initialized
  storageInitialized = true;
  notifyListeners();
};

// Save to secure storage (OS keychain)
const saveToStorage = async () => {
  try {
    if (tokens?.access_token && user) {
      await storeAuthDataSecure({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        expires_in: tokens.expires_in,
        user: user,
      });
    } else if (!isAuthenticated) {
      // Clear secure storage if not authenticated
      await clearAuthDataSecure();
    }
  } catch (e) {
    console.error("Failed to save auth state to secure storage:", e);
  }
};

// Initialize from storage (async, but don't block)
loadFromStorage();

// Listeners for state changes
const listeners: Set<() => void> = new Set();

const notifyListeners = () => {
  listeners.forEach((listener) => listener());
};

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
  setAuthData: (newTokens: AuthTokens, newUser: AuthUser) => {
    tokens = newTokens;
    user = newUser;
    isAuthenticated = true;
    error = null;

    saveToStorage().catch((err) => {
      console.error("Failed to save auth data:", err);
    });
    notifyListeners();
  },
  clearAuth: () => {
    isAuthenticated = false;
    user = null;
    tokens = null;
    error = null;
    // Remove from secure storage (async, but don't block)
    clearAuthDataSecure().catch((err) => {
      console.error("Failed to clear auth data from secure storage:", err);
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
  refreshTokenIfNeeded: async () => {
    // No-op: Token refresh is handled automatically
    return false;
  },
  checkAuth: async () => {
    await loadFromStorage();
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
