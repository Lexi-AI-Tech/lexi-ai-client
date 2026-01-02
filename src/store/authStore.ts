/**
 * Auth Store
 *
 * Manages authentication state for Lexi AI.
 * Stores user info, tokens, and authentication status.
 * Uses OS keychain for secure storage (macOS Keychain, Windows Credential Manager, Linux Secret Service).
 */

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

      // Check if tokens are expired and try to refresh
      if (tokens?.expires_at && tokens.expires_at < Date.now()) {
        if (tokens?.refresh_token) {
          console.log("🔄 Access token expired, attempting to refresh...");
          try {
            const { getDeviceInfo } = await import("../lib/deviceInfo");
            const device = getDeviceInfo();
            const API_BASE_URL =
              import.meta.env.MODE === "development"
                ? "http://localhost:1230"
                : "https://lexi-ai-server.onrender.com";

            const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                refresh_token: tokens.refresh_token,
                device_name: device.device_name,
                device_type: device.device_type,
              }),
            });

            if (response.ok) {
              const data = await response.json();
              const refreshData = data.data || data;

              if (refreshData.access_token) {
                tokens = {
                  ...tokens,
                  access_token: refreshData.access_token,
                  refresh_token:
                    refreshData.refresh_token || tokens.refresh_token,
                  expires_in: refreshData.expires_in,
                  expires_at: refreshData.expires_in
                    ? Date.now() + refreshData.expires_in * 1000
                    : tokens.expires_at,
                };
                isAuthenticated = true;
                await saveToStorage();
                console.log("✅ Token refreshed successfully");
              }
            } else {
              throw new Error(`Token refresh failed: ${response.status}`);
            }
          } catch (refreshError) {
            console.error("❌ Token refresh failed:", refreshError);
            isAuthenticated = false;
            user = null;
            tokens = null;
            await saveToStorage();
          }
        } else {
          console.log("⚠️ Access token expired and no refresh token available");
          isAuthenticated = false;
          user = null;
          tokens = null;
          await saveToStorage();
        }
      }

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

    // Calculate expires_at if not provided
    if (!tokens.expires_at && tokens.expires_in) {
      tokens.expires_at = Date.now() + tokens.expires_in * 1000;
    }

    // Save to secure storage (async, but don't block)
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
    // Check if token is expired or expiring soon (within 5 minutes)
    if (!tokens?.expires_at || !tokens?.refresh_token) {
      return false;
    }

    const bufferTime = 5 * 60 * 1000; // 5 minutes
    const isExpiringSoon = tokens.expires_at < Date.now() + bufferTime;

    if (!isExpiringSoon) {
      return false; // Token is still valid
    }

    // Token is expired or expiring soon, refresh it
    console.log("🔄 Token expiring soon, refreshing proactively...");
    try {
      const { getDeviceInfo } = await import("../lib/deviceInfo");
      const device = getDeviceInfo();
      const API_BASE_URL =
        import.meta.env.MODE === "development"
          ? "http://localhost:1230"
          : "https://lexi-ai-server.onrender.com";

      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          refresh_token: tokens.refresh_token,
          device_name: device.device_name,
          device_type: device.device_type,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const refreshData = data.data || data;

        if (refreshData.access_token) {
          tokens = {
            ...tokens,
            access_token: refreshData.access_token,
            refresh_token: refreshData.refresh_token || tokens.refresh_token,
            expires_in: refreshData.expires_in,
            expires_at: refreshData.expires_in
              ? Date.now() + refreshData.expires_in * 1000
              : tokens.expires_at,
          };
          isAuthenticated = true;
          await saveToStorage();
          notifyListeners();
          console.log("✅ Token refreshed proactively");
          return true;
        }
      } else {
        throw new Error(`Token refresh failed: ${response.status}`);
      }
    } catch (refreshError) {
      console.error("❌ Proactive token refresh failed:", refreshError);
      // Don't clear auth on proactive refresh failure - let it fail on actual API call
      return false;
    }

    return false;
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
