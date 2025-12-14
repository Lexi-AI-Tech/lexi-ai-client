/**
 * Auth Store
 * 
 * Manages authentication state for Lexi AI.
 * Stores user info, tokens, and authentication status.
 */

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

// Load from localStorage on initialization
const loadFromStorage = () => {
  try {
    const stored = localStorage.getItem('lexi-auth');
    if (stored) {
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
        saveToStorage();
      }
    }
  } catch (e) {
    console.error('Failed to load auth state:', e);
  }
};

// Save to localStorage
const saveToStorage = () => {
  try {
    localStorage.setItem('lexi-auth', JSON.stringify({
      isAuthenticated,
      user,
      tokens
    }));
  } catch (e) {
    console.error('Failed to save auth state:', e);
  }
};

// Initialize from storage
loadFromStorage();

// Listeners for state changes
const listeners: Set<() => void> = new Set();

const notifyListeners = () => {
  listeners.forEach(listener => listener());
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
  setAuthData: (newTokens: AuthTokens, newUser: AuthUser) => {
    tokens = newTokens;
    user = newUser;
    isAuthenticated = true;
    error = null;
    
    // Calculate expires_at if not provided
    if (!tokens.expires_at && tokens.expires_in) {
      tokens.expires_at = Date.now() + tokens.expires_in * 1000;
    }
    
    saveToStorage();
    notifyListeners();
  },
  clearAuth: () => {
    isAuthenticated = false;
    user = null;
    tokens = null;
    error = null;
    saveToStorage();
    notifyListeners();
  },
  setLoading: (loading: boolean) => {
    isLoading = loading;
    notifyListeners();
  },
  setError: (err: string | null) => {
    error = err;
    notifyListeners();
  }
};

// Import React for the hook
import React from 'react';

// React hook to subscribe to store changes
export const useAuthStore = () => {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  
  React.useEffect(() => {
    const listener = () => forceUpdate();
    listeners.add(listener);
    
    // Listen for auth expiration events from API client
    const handleAuthExpired = () => {
      authStore.clearAuth();
    };
    window.addEventListener('auth-expired', handleAuthExpired);
    
    return () => {
      listeners.delete(listener);
      window.removeEventListener('auth-expired', handleAuthExpired);
    };
  }, []);
  
  return authStore;
};
