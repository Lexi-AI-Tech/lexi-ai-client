import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../../store/authStore";
import {
  logout as backendLogout,
  checkOAuthStatus,
} from "../../lib/apiClient";
import "./auth.css";

interface GoogleLoginButtonProps {
  onSuccess?: (user: any) => void;
  onError?: (error: string) => void;
}

export const GoogleLoginButton: React.FC<GoogleLoginButtonProps> = ({
  onSuccess,
  onError,
}) => {
  const {
    clearAuth,
    setLoading,
    setError,
    setAuthData,
    user,
    isAuthenticated,
  } = useAuthStore();
  const [loading, setLocalLoading] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const oauthPollingRef = useRef<{
    isPolling: boolean;
    interval: NodeJS.Timeout | null;
  }>({ isPolling: false, interval: null });

  // Check persistent storage for tokens (in case callback page stored them)
  const checkStoredAuth = React.useCallback(() => {
    try {
      // Use sync version for immediate checks (falls back to localStorage)
      // The authStore will handle async Tauri Store loading on initialization
      const { getStorageItemSync } = require("../lib/persistentStorage");
      const stored = getStorageItemSync("lexi-auth");
      console.log(
        "Checking persistent storage for auth:",
        stored ? "found" : "not found",
      );
      if (stored) {
        const parsed = JSON.parse(stored);
        console.log("Parsed auth data:", {
          hasTokens: !!parsed.tokens,
          hasUser: !!parsed.user,
          tokenKeys: parsed.tokens ? Object.keys(parsed.tokens) : [],
          userKeys: parsed.user ? Object.keys(parsed.user) : [],
        });

        // Handle both formats: { tokens, user } and { isAuthenticated, tokens, user }
        const tokens = parsed.tokens || parsed;
        const user = parsed.user;

        if (tokens?.access_token && user) {
          console.log("✅ Found stored auth in persistent storage, using it");
          // Found stored auth, use it
          setAuthData(tokens, user);
          setLoading(false);
          setLocalLoading(false);

          // Clear timeout if it exists
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }

          // Note: We don't remove the stored auth here since authStore manages it
          // The authStore will persist it properly using Tauri Store

          if (onSuccess) {
            onSuccess(user);
          }
          return true;
        } else {
          console.log("❌ Stored auth missing required fields:", {
            hasAccessToken: !!tokens?.access_token,
            hasUser: !!user,
          });
        }
      }
    } catch (e) {
      console.error("Error checking stored auth:", e);
    }
    return false;
  }, [setAuthData, setLoading, onSuccess]);

  // Listen for OAuth callback messages from the callback page
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      console.log("Received postMessage:", event.data);
      // Only accept messages from our backend
      if (event.data?.type === "oauth-success") {
        const {
          access_token,
          refresh_token,
          user: authUser,
          expires_in,
        } = event.data;

        const authTokens = {
          access_token,
          refresh_token,
          expires_in,
          expires_at: expires_in ? Date.now() + expires_in * 1000 : undefined,
        };

        setAuthData(authTokens, authUser);
        setLoading(false);
        setLocalLoading(false);

        if (onSuccess) {
          onSuccess(authUser);
        }
      } else if (event.data?.type === "oauth-error") {
        const errorMsg = event.data.error || "Authentication failed";
        setError(errorMsg);
        setLoading(false);
        setLocalLoading(false);

        if (onError) {
          onError(errorMsg);
        }
      }
    };

    // Listen for postMessage (when opened from web)
    window.addEventListener("message", handleMessage);

    // Listen for storage events (when callback page stores in localStorage)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "lexi-auth" && e.newValue) {
        console.log("Storage event detected for lexi-auth");
        checkStoredAuth();
      }
    };
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [setAuthData, setError, setLoading, onSuccess, onError, checkStoredAuth]);

  // Poll localStorage when loading (for when opened externally)
  useEffect(() => {
    if (!loading) {
      // Stop polling when not loading
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    console.log("Starting to poll localStorage, loading:", loading);

    // Check immediately
    if (checkStoredAuth()) {
      console.log("Auth found immediately, stopping");
      return; // Already found, no need to poll
    }

    // Clear any existing interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    // Poll every 200ms (more frequent) until we find tokens
    console.log("Starting polling interval");
    pollIntervalRef.current = setInterval(() => {
      console.log("Polling localStorage...");
      if (checkStoredAuth()) {
        console.log("Auth found via polling, stopping");
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
    }, 200); // Check every 200ms for faster detection

    return () => {
      console.log("Cleaning up polling");
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [loading, checkStoredAuth]);

  const handleGoogleLogin = async () => {
    setLocalLoading(true);
    setLoading(true);
    setError(null);

    try {
      // Get client ID from environment
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

      if (!clientId) {
        throw new Error(
          "Google OAuth credentials not configured. " +
            "Please set VITE_GOOGLE_CLIENT_ID in your .env file.",
        );
      }

      // Start OAuth flow with PKCE via Rust backend
      // This generates PKCE challenge/verifier, builds auth URL, and opens browser
      // The browser will redirect to the callback page
      const pkceData = await invoke<{
        challenge: string;
        verifier: string;
        state: string;
        auth_url: string;
      }>("start_google_login", { clientId });

      console.log("PKCE challenge generated, browser opened:", {
        state: pkceData.state,
        stateLength: pkceData.state.length,
        verifierLength: pkceData.verifier.length,
        authUrl: pkceData.auth_url,
      });

      // Store verifier on backend (Redis) so callback page can retrieve it
      // This works even when callback opens in external browser
      try {
        const { storePkceVerifier } = await import("../../lib/apiClient");
        await storePkceVerifier(pkceData.state, pkceData.verifier);
        console.log("Stored PKCE verifier on backend (Redis):", {
          state: pkceData.state,
          stateLength: pkceData.state.length,
          verifierLength: pkceData.verifier.length,
        });
      } catch (error) {
        console.error("Failed to store verifier on backend:", error);
        throw new Error("Failed to store OAuth verifier. Please try again.");
      }

      console.log("Waiting for OAuth callback...");

      // Poll backend for OAuth completion (instead of localStorage)
      // This works across different browser contexts
      // Use ref to track polling state across async operations
      oauthPollingRef.current.isPolling = true;
      oauthPollingRef.current.interval = null;

      const pollOAuthStatus = async (): Promise<boolean> => {
        if (!oauthPollingRef.current.isPolling) {
          console.log("Polling already stopped, skipping");
          return true; // Already stopped
        }

        try {
          const status = await checkOAuthStatus(pkceData.state);
          console.log("OAuth status check:", {
            status: status.status,
            hasAccessToken: !!status.access_token,
            hasUser: !!status.user,
            fullResponse: status,
          });

          if (
            status.status === "completed" &&
            status.access_token &&
            status.user
          ) {
            console.log("✅ OAuth completed, tokens received from backend");

            // Stop polling immediately BEFORE processing to prevent race conditions
            oauthPollingRef.current.isPolling = false;
            if (oauthPollingRef.current.interval) {
              clearInterval(oauthPollingRef.current.interval);
              oauthPollingRef.current.interval = null;
            }
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }

            // Process tokens
            const authTokens = {
              access_token: status.access_token,
              refresh_token: status.refresh_token || "",
              expires_in: status.expires_in,
              expires_at: status.expires_in
                ? Date.now() + status.expires_in * 1000
                : undefined,
            };

            console.log("Setting auth data:", {
              hasAccessToken: !!authTokens.access_token,
              hasRefreshToken: !!authTokens.refresh_token,
              userEmail: status.user?.email,
            });

            setAuthData(authTokens, status.user);
            setLoading(false);
            setLocalLoading(false);

            if (onSuccess) {
              onSuccess(status.user);
            }
            return true; // Stop polling
          } else if (status.status === "pending") {
            // Still pending, continue polling
            return false;
          } else {
            // Unexpected status
            console.warn("Unexpected OAuth status:", status);
            return false;
          }
        } catch (error) {
          console.error("Error checking OAuth status:", error);
          // Don't stop polling on error - might be temporary network issue
          return false;
        }
      };

      // Poll immediately, then every 500ms
      if (await pollOAuthStatus()) {
        return; // Already completed
      }

      oauthPollingRef.current.interval = setInterval(async () => {
        if (await pollOAuthStatus()) {
          // Polling stopped, interval already cleared in pollOAuthStatus
        }
      }, 500);

      // Set a timeout to stop polling after 5 minutes
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(
        () => {
          oauthPollingRef.current.isPolling = false;
          if (oauthPollingRef.current.interval) {
            clearInterval(oauthPollingRef.current.interval);
            oauthPollingRef.current.interval = null;
          }
          console.log("OAuth timeout - no tokens detected");
          setLocalLoading(false);
          setLoading(false);
          setError("Authentication timed out. Please try again.");
          if (onError) {
            onError("Authentication timed out");
          }
        },
        5 * 60 * 1000,
      ); // 5 minutes
    } catch (error: any) {
      const errorMessage = error?.message || "Google login failed";
      console.error("Google Login Failed:", error);
      setError(errorMessage);
      setLocalLoading(false);
      setLoading(false);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (onError) {
        onError(errorMessage);
      }
    }
  };

  const handleLogout = async () => {
    try {
      setLocalLoading(true);
      setLoading(true);

      // Logout from backend first (revokes all sessions)
      await backendLogout();

      // Clear Rust backend auth token
      try {
        await invoke("set_auth_token", { token: null });
        console.log("✅ Auth token cleared from Rust backend");
      } catch (error) {
        console.warn("Failed to clear Rust backend token:", error);
        // Continue with logout even if this fails
      }

      // Clear local auth state
      clearAuth();

      console.log("✅ Logout successful");
    } catch (error) {
      console.error("Logout Failed:", error);
      // Still clear local auth even if logout fails
      clearAuth();

      // Still try to clear Rust backend token
      try {
        await invoke("set_auth_token", { token: null });
      } catch (rustError) {
        console.warn("Failed to clear Rust backend token:", rustError);
      }
    } finally {
      setLocalLoading(false);
      setLoading(false);
    }
  };

  if (isAuthenticated && user) {
    return (
      <div className="auth-user-info">
        <div className="auth-user-details">
          {user.picture && (
            <img
              src={user.picture}
              alt="Profile"
              className="auth-user-avatar"
            />
          )}
          <div className="auth-user-text">
            <p className="auth-user-name">{user.name}</p>
            <p className="auth-user-email">{user.email}</p>
          </div>
        </div>
        <div className="auth-actions">
          <button
            onClick={handleLogout}
            disabled={loading}
            className="auth-button secondary"
          >
            {loading ? (
              <>
                <span className="auth-spinner">⏳</span>
                Signing out...
              </>
            ) : (
              "Sign Out"
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={handleGoogleLogin}
      disabled={loading}
      className="auth-button google-login"
    >
      {loading ? (
        <>
          <span className="auth-spinner">⏳</span>
          Signing in...
        </>
      ) : (
        <>
          <svg
            className="google-icon"
            viewBox="0 0 24 24"
            width="20"
            height="20"
          >
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Sign in with Google
        </>
      )}
    </button>
  );
};
