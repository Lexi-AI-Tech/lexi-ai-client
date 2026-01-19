import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAuthStore, authStore } from "../../store/authStore";
import type { GoogleLoginButtonProps } from "../../types";

import "./auth.css";

export const GoogleLoginButton: React.FC<GoogleLoginButtonProps> = ({
  onSuccess,
  onError,
}) => {
  const {
    clearAuth,
    setLoading,
    setError,
    user,
    isAuthenticated,
  } = useAuthStore();
  const [loading, setLocalLoading] = useState(false);

  // Listen for OAuth events from Rust backend
  useEffect(() => {
    let unlistenFunctions: (() => void)[] = [];
    let isMounted = true;

    const setupEventListeners = async () => {
      // Listen for OAuth completion
      const oauthCompletedUnlisten = await listen<{
        id: string;
        email: string;
        name: string;
        picture?: string;
      }>("oauth-completed", async (event) => {
        if (!isMounted) return;
        console.log("✅ OAuth completed event received:", event.payload);

        // Reload auth state from Rust backend (already stored by WebSocket handler)
        await authStore.checkAuth();

        setLoading(false);
        setLocalLoading(false);

        if (onSuccess) {
          onSuccess(event.payload);
        }
      });

      // Listen for OAuth errors
      const oauthErrorUnlisten = await listen<string>(
        "oauth-error",
        (event) => {
          if (!isMounted) return;
          console.error("❌ OAuth error event received:", event.payload);

          const errorMsg = event.payload || "Authentication failed";
          setError(errorMsg);
          setLoading(false);
          setLocalLoading(false);

          if (onError) {
            onError(errorMsg);
          }
        },
      );

      // Listen for OAuth timeout
      const oauthTimeoutUnlisten = await listen<string>("oauth-timeout", () => {
        if (!isMounted) return;
        console.log("⏱️  OAuth timeout event received");

        setError("Authentication timed out. Please try again.");
        setLoading(false);
        setLocalLoading(false);

        if (onError) {
          onError("Authentication timed out");
        }
      });

      if (isMounted) {
        unlistenFunctions = [
          oauthCompletedUnlisten,
          oauthErrorUnlisten,
          oauthTimeoutUnlisten,
        ];
      } else {
        oauthCompletedUnlisten();
        oauthErrorUnlisten();
        oauthTimeoutUnlisten();
      }
    };

    setupEventListeners().catch(console.error);

    return () => {
      isMounted = false;
      unlistenFunctions.forEach((unlisten) => unlisten());
    };
  }, [onSuccess, onError, setError, setLoading]);

  // Cleanup WebSocket connection on unmount
  useEffect(() => {
    return () => {
      invoke("stop_oauth_websocket").catch(console.error);
    };
  }, []);

  const handleGoogleLogin = async () => {
    setLocalLoading(true);
    setLoading(true);
    setError(null);

    try {
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

      if (!clientId) {
        throw new Error(
          "Google OAuth credentials not configured. " +
          "Please set VITE_GOOGLE_CLIENT_ID in your .env file.",
        );
      }

      // Start OAuth flow - Rust handles everything
      const pkceData = await invoke<{
        challenge: string;
        verifier: string;
        state: string;
        auth_url: string;
      }>("start_google_login", { clientId });

      console.log("OAuth started, state:", pkceData.state.slice(0, 10) + "...");

      // Start WebSocket connection to receive OAuth result
      await invoke("start_oauth_websocket", { state: pkceData.state });
      console.log("WebSocket connection started");
    } catch (error: any) {
      const errorMessage = error?.message || "Google login failed";
      console.error("Google Login Failed:", error);
      setError(errorMessage);
      setLocalLoading(false);
      setLoading(false);

      await invoke("stop_oauth_websocket").catch(console.error);

      if (onError) {
        onError(errorMessage);
      }
    }
  };

  const handleLogout = async () => {
    try {
      setLocalLoading(true);
      setLoading(true);

      // Logout from backend (revokes sessions) and clear local state
      await invoke("logout");
      clearAuth();

      console.log("✅ Logout successful");
    } catch (error) {
      console.error("Logout Failed:", error);
      clearAuth();
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
