import React, { useState } from "react";
import { useOnboardingStore } from "../../store/onboardingStore";
import { GoogleLoginButton } from "../auth/GoogleLoginButton";
import { useAuthStore } from "../../store/authStore";
import {
  clearAllStorage,
  clearAuthStorage,
  clearOnboardingStorage,
} from "../../lib/storageUtils";
import "./onboarding.css";

export const WelcomeScreen: React.FC = () => {
  const { nextStep, resetOnboarding } = useOnboardingStore();
  const { isAuthenticated, error, clearAuth } = useAuthStore();
  const [showDebugMenu, setShowDebugMenu] = useState(false);

  const handleClearAll = () => {
    if (
      confirm("Clear all app data? This will log you out and reset onboarding.")
    ) {
      clearAllStorage();
      clearAuth();
      resetOnboarding();
      setShowDebugMenu(false);
      alert("All data cleared! Page will refresh.");
      window.location.reload();
    }
  };

  const handleClearAuth = () => {
    if (confirm("Clear authentication data? You will be logged out.")) {
      clearAuthStorage();
      clearAuth();
      setShowDebugMenu(false);
      alert("Auth data cleared!");
    }
  };

  const handleClearOnboarding = () => {
    if (confirm("Reset onboarding? You will need to go through setup again.")) {
      clearOnboardingStorage();
      resetOnboarding();
      setShowDebugMenu(false);
      alert("Onboarding reset!");
    }
  };

  return (
    <div className="flex flex-row h-full w-full bg-background">
      <div className="flex flex-col w-[45%] justify-center items-start px-24">
        <div className="flex flex-col h-full min-h-[400px] justify-between py-12">
          <div className="mt-8">
            <h1 className="text-3xl mb-4 mt-12">Welcome to Lexi AI</h1>
            <p className="text-base text-muted-foreground mb-8 max-w-md">
              Your voice-to-text assistant that works anywhere on your Mac
            </p>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⌨️</span>
                <span className="text-base">Press Fn key to record</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl">🎙️</span>
                <span className="text-base">Speak naturally</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl">✨</span>
                <span className="text-base">Text appears instantly</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-start mb-8 gap-4 w-full">
            {!isAuthenticated && (
              <div className="flex flex-col gap-3 w-full">
                <p className="text-sm text-muted-foreground mb-2">
                  Sign in to sync your preferences (optional)
                </p>
                <GoogleLoginButton
                  onSuccess={() => {
                    console.log("Login successful");
                  }}
                  onError={(err) => {
                    console.error("Login error:", err);
                  }}
                />
                {error && <div className="auth-error">{error}</div>}
                <div className="flex items-center gap-2 my-2 w-full">
                  <div className="flex-1 h-px bg-border"></div>
                  <span className="text-xs text-muted-foreground px-2">or</span>
                  <div className="flex-1 h-px bg-border"></div>
                </div>
              </div>
            )}
            <button className="onboarding-button primary" onClick={nextStep}>
              {isAuthenticated ? "Continue" : "Get Started"}
            </button>

            {/* Debug Menu - Hold Shift and click to show */}
            <div className="mt-4">
              <button
                className="text-xs text-muted-foreground hover:text-foreground underline"
                onClick={() => setShowDebugMenu(!showDebugMenu)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setShowDebugMenu(!showDebugMenu);
                }}
              >
                {showDebugMenu ? "▼" : "▶"} Debug Menu
              </button>

              {showDebugMenu && (
                <div className="mt-2 p-3 bg-muted rounded border border-border text-xs space-y-2">
                  <p className="font-semibold mb-2">Clear Storage:</p>
                  <button
                    className="block w-full text-left px-2 py-1 hover:bg-background rounded"
                    onClick={handleClearAuth}
                  >
                    Clear Auth Data
                  </button>
                  <button
                    className="block w-full text-left px-2 py-1 hover:bg-background rounded"
                    onClick={handleClearOnboarding}
                  >
                    Clear Onboarding Data
                  </button>
                  <button
                    className="block w-full text-left px-2 py-1 hover:bg-background rounded text-red-500"
                    onClick={handleClearAll}
                  >
                    Clear All Data
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="flex w-[55%] items-center justify-center bg-gradient-to-b from-purple-50/10 to-purple-100 border-l-2 border-purple-100">
        <div className="text-center">
          <div className="text-9xl mb-8">🎤</div>
        </div>
      </div>
    </div>
  );
};
