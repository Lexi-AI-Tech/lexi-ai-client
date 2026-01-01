/**
 * Auth Store
 *
 * Manages authentication state for Lexi AI.
 * Stores user info, tokens, and authentication status.
 * Uses persistent storage (Tauri Store in production, localStorage as fallback).
 */

import {
  getStorageItem,
  setStorageItem,
  removeStorageItem,
  getStorageItemSync,
} from "../lib/persistentStorage";

export interface AuthUser {
  email: string;
  name: string;
  picture?: string;
}

export interface AuthTokens {
  access_token: string; // Backend JWT access token
  refresh_token?: string; // Backend JWT refresh token
  expires_in?: number;
  expires_at?: number;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
  error: string | null;
  isInitialized: boolean;
  setAuthData: (tokens: AuthTokens, user: AuthUser) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

// Store state
let isAuthenticated: boolean = false;
let user: AuthUser | null = null;
let tokens: AuthTokens | null = null;
let isLoading: boolean = false;
let error: string | null = null;
let storageInitialized: boolean = false;

// Load from persistent storage on initialization
const loadFromStorage = async () => {
  try {
    // First try sync localStorage for immediate access (fallback)
    const storedSync = getStorageItemSync("lexi-auth");
    if (storedSync) {
      try {
        const parsed = JSON.parse(storedSync);
        isAuthenticated = parsed.isAuthenticated || false;
        user = parsed.user || null;
        tokens = parsed.tokens || null;

        // Check if tokens are expired
        if (tokens?.expires_at && tokens.expires_at < Date.now()) {
          // Tokens expired, clear auth
          isAuthenticated = false;
          user = null;
          tokens = null;
          await saveToStorage();
          storageInitialized = true;
          notifyListeners();
        } else {
          storageInitialized = true;
          notifyListeners();
        }
      } catch (e) {
        console.error("Failed to parse stored auth data:", e);
      }
    }

    // Then try async persistent storage (Tauri Store)
    const stored = await getStorageItem("lexi-auth");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        isAuthenticated = parsed.isAuthenticated || false;
        user = parsed.user || null;
        tokens = parsed.tokens || null;

        // Check if tokens are expired
        if (tokens?.expires_at && tokens.expires_at < Date.now()) {
          // Tokens expired, clear auth
          isAuthenticated = false;
          user = null;
          tokens = null;
          await saveToStorage();
          storageInitialized = true;
          notifyListeners();
        } else {
          storageInitialized = true;
          notifyListeners();
        }
      } catch (e) {
        console.error("Failed to parse stored auth data:", e);
      }
    }
  } catch (e) {
    console.error("Failed to load auth state:", e);
  }
  // Always mark as initialized, even if no stored data was found
  if (!storageInitialized) {
    storageInitialized = true;
    notifyListeners();
  }
};

// Save to persistent storage
const saveToStorage = async () => {
  try {
    const data = JSON.stringify({
      isAuthenticated,
      user,
      tokens,
    });
    await setStorageItem("lexi-auth", data);
  } catch (e) {
    console.error("Failed to save auth state:", e);
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

    // Calculate expires_at if not provided
    if (!tokens.expires_at && tokens.expires_in) {
      tokens.expires_at = Date.now() + tokens.expires_in * 1000;
    }

    // Save to storage (async, but don't block)
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
    // Remove from storage (async, but don't block)
    removeStorageItem("lexi-auth").catch((err) => {
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
};

// Import React for the hook
import React from "react";

// React hook to subscribe to store changes
export const useAuthStore = () => {
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  React.useEffect(() => {
    const listener = () => forceUpdate();
    listeners.add(listener);

    // Listen for auth expiration events from API client
    const handleAuthExpired = () => {
      authStore.clearAuth();
    };
    window.addEventListener("auth-expired", handleAuthExpired);

    return () => {
      listeners.delete(listener);
      window.removeEventListener("auth-expired", handleAuthExpired);
    };
  }, []);

  return authStore;
};
