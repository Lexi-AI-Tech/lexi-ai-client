import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";
import { getAppConfig, updateAppConfig } from "../lib/apiClient";
import { useAuthStore } from "../store/authStore";

// Supported languages for transcription
const SUPPORTED_LANGUAGES = [
  { value: "auto", label: "Auto (Detect Language)" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "ru", label: "Russian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
  { value: "tr", label: "Turkish" },
  { value: "sv", label: "Swedish" },
  { value: "da", label: "Danish" },
  { value: "no", label: "Norwegian" },
  { value: "fi", label: "Finnish" },
];

export const SettingsPage: React.FC = () => {
  const { tokens } = useAuthStore();
  const [currentLanguage, setCurrentLanguage] = useState<string>("en");
  const [selectedLanguage, setSelectedLanguage] = useState<string>("en");
  const [systemType, setSystemType] = useState<"mac" | "windows">("mac");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [autostartEnabled, setAutostartEnabled] = useState<boolean>(false);
  const [isCheckingAutostart, setIsCheckingAutostart] = useState(true);
  const [isTogglingAutostart, setIsTogglingAutostart] = useState(false);

  // Load current config from DB on mount and when auth token changes
  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Detect system type
        const { getDeviceInfo } = await import("../lib/deviceInfo");
        const deviceInfo = getDeviceInfo();
        const detectedSystemType = deviceInfo.system_type || "mac";
        setSystemType(detectedSystemType);

        // Load from DB only if user is authenticated
        if (tokens?.access_token) {
          try {
            const config = await getAppConfig(detectedSystemType);
            if (config.language) {
              setCurrentLanguage(config.language);
              setSelectedLanguage(config.language);
              // Update Rust backend with DB language
              await invoke("set_language", { language: config.language });
            }
          } catch (dbErr: any) {
            console.warn(
              "Failed to load config from DB, using defaults:",
              dbErr,
            );
            if (
              dbErr?.message?.includes("401") ||
              dbErr?.message?.includes("Unauthorized")
            ) {
              setError("Please log in to save your configuration");
            }
          }
        } else {
          console.log("User not authenticated, using default config");
        }
      } catch (err: any) {
        console.error("Failed to load config:", err);
        setError(err?.message || "Failed to load configuration");
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();
  }, [tokens?.access_token]);

  // Load autostart status on mount
  useEffect(() => {
    const checkAutostart = async () => {
      setIsCheckingAutostart(true);
      try {
        const enabled = await invoke<boolean>("is_autostart_enabled");
        setAutostartEnabled(enabled);
      } catch (err: any) {
        console.error("Failed to check autostart status:", err);
      } finally {
        setIsCheckingAutostart(false);
      }
    };

    checkAutostart();
  }, []);

  const handleSaveLanguage = async () => {
    const languageChanged = selectedLanguage !== currentLanguage;

    if (!languageChanged) {
      return; // No change needed
    }

    setIsUpdating(true);
    setError(null);
    setSuccess(false);

    try {
      // Update Rust backend if language changed (works even without auth)
      if (languageChanged) {
        await invoke("set_language", { language: selectedLanguage });
      }

      // Save to DB only if user is authenticated
      if (tokens?.access_token) {
        const updateData: {
          system_type: string;
          language: string;
        } = {
          system_type: systemType,
          language: selectedLanguage,
        };

        await updateAppConfig(updateData);

        // Reload config from DB to get the latest values
        try {
          const updatedConfig = await getAppConfig(systemType);
          if (updatedConfig.language) {
            setCurrentLanguage(updatedConfig.language);
            setSelectedLanguage(updatedConfig.language);
          }
        } catch (reloadErr) {
          console.warn("Failed to reload config after update:", reloadErr);
          // Still update local state even if reload fails
          if (languageChanged) {
            setCurrentLanguage(selectedLanguage);
          }
        }
      } else {
        // If not authenticated, just update local state
        console.log(
          "User not authenticated, saving only to local Rust backend",
        );
        if (languageChanged) {
          setCurrentLanguage(selectedLanguage);
        }
      }

      setSuccess(true);
      setIsUpdating(false);

      // Clear success message after 2 seconds
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      console.error("Failed to update language:", err);
      setError(err?.message || "Failed to update language");
      setIsUpdating(false);
    }
  };

  const isLanguageChanged = selectedLanguage !== currentLanguage;

  const handleToggleAutostart = async () => {
    setIsTogglingAutostart(true);
    setError(null);
    try {
      if (autostartEnabled) {
        await invoke("disable_autostart");
        setAutostartEnabled(false);
        console.log("✅ Auto-startup disabled");
      } else {
        await invoke("enable_autostart");
        setAutostartEnabled(true);
        console.log("✅ Auto-startup enabled");
      }
    } catch (err: any) {
      console.error("Failed to toggle autostart:", err);
      setError(err?.message || "Failed to update auto-startup setting");
    } finally {
      setIsTogglingAutostart(false);
    }
  };

  return (
    <div className="settings-page">
      <h2
        style={{
          margin: 0,
          marginBottom: "32px",
          fontSize: "24px",
          fontWeight: 600,
          color: "#ffffff",
        }}
      >
        Settings
      </h2>

      <div style={{ marginBottom: "32px" }}>
        <h3
          style={{
            margin: 0,
            marginBottom: "16px",
            fontSize: "18px",
            fontWeight: 500,
            color: "#ffffff",
          }}
        >
          Account
        </h3>
        <GoogleLoginButton />
      </div>

      <div>
        <h3
          style={{
            margin: 0,
            marginBottom: "16px",
            fontSize: "18px",
            fontWeight: 500,
            color: "#ffffff",
          }}
        >
          Transcription
        </h3>

        {!tokens?.access_token && (
          <div
            className="permission-message"
            style={{
              background: "rgba(255, 193, 7, 0.1)",
              borderColor: "rgba(255, 193, 7, 0.2)",
              color: "rgba(255, 193, 7, 0.9)",
              fontSize: "11px",
              padding: "8px",
              marginBottom: "12px",
            }}
          >
            Please log in to save your configuration to the cloud. Changes will
            only be saved locally until you log in.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <div
              style={{
                fontSize: "11px",
                color: "rgba(255, 255, 255, 0.6)",
                marginBottom: "8px",
              }}
            >
              Transcription Language
            </div>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              disabled={isUpdating || isLoading}
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: "11px",
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "6px",
                color: "#ffffff",
                cursor: isUpdating || isLoading ? "not-allowed" : "pointer",
                opacity: isUpdating || isLoading ? 0.5 : 1,
              }}
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
            <div
              style={{
                fontSize: "10px",
                color: "rgba(255, 255, 255, 0.5)",
                marginTop: "6px",
              }}
            >
              {selectedLanguage === "auto"
                ? "Language will be automatically detected from audio"
                : `Transcription will be limited to ${SUPPORTED_LANGUAGES.find((l) => l.value === selectedLanguage)?.label || selectedLanguage}`}
            </div>
          </div>

          <button
            className="transcript-btn"
            onClick={handleSaveLanguage}
            disabled={isUpdating || !isLanguageChanged || isLoading}
            style={{
              marginTop: "8px",
              padding: "8px 16px",
              fontSize: "11px",
              width: "100%",
              opacity: isUpdating || !isLanguageChanged || isLoading ? 0.5 : 1,
            }}
          >
            {isUpdating ? "Saving..." : "Save Language"}
          </button>

          {error && (
            <div
              className="permission-message"
              style={{
                background: "rgba(255, 59, 48, 0.1)",
                borderColor: "rgba(255, 59, 48, 0.2)",
                color: "rgba(255, 59, 48, 0.9)",
                fontSize: "11px",
                padding: "8px",
              }}
            >
              {error}
            </div>
          )}

          {success && (
            <div
              className="permission-message"
              style={{
                background: "rgba(52, 199, 89, 0.1)",
                borderColor: "rgba(52, 199, 89, 0.2)",
                color: "rgba(52, 199, 89, 0.9)",
                fontSize: "11px",
                padding: "8px",
              }}
            >
              Language saved successfully!
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: "32px" }}>
        <h3
          style={{
            margin: 0,
            marginBottom: "16px",
            fontSize: "18px",
            fontWeight: 500,
            color: "#ffffff",
          }}
        >
          General
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px",
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "6px",
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: "13px",
                  color: "#ffffff",
                  marginBottom: "4px",
                  fontWeight: 500,
                }}
              >
                Start on System Startup
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "rgba(255, 255, 255, 0.6)",
                }}
              >
                Automatically launch Lexi AI when your computer starts
              </div>
            </div>
            <button
              onClick={handleToggleAutostart}
              disabled={isCheckingAutostart || isTogglingAutostart}
              style={{
                width: "44px",
                height: "24px",
                borderRadius: "12px",
                border: "none",
                backgroundColor: autostartEnabled
                  ? "rgba(52, 199, 89, 1)"
                  : "rgba(255, 255, 255, 0.2)",
                cursor:
                  isCheckingAutostart || isTogglingAutostart
                    ? "not-allowed"
                    : "pointer",
                position: "relative",
                transition: "background-color 0.2s",
                opacity: isCheckingAutostart || isTogglingAutostart ? 0.5 : 1,
              }}
            >
              <div
                style={{
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  backgroundColor: "#ffffff",
                  position: "absolute",
                  top: "2px",
                  left: autostartEnabled ? "22px" : "2px",
                  transition: "left 0.2s",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.3)",
                }}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
