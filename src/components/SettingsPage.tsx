import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";
import {
  LanguageCode,
  getAllLanguageCodes,
  getLanguageName,
} from "../lib/constants";
import type { TauriAppConfig } from "../types";

// Supported languages for transcription
const SUPPORTED_LANGUAGES = getAllLanguageCodes().map((code) => ({
  value: code,
  label: getLanguageName(code),
}));

export const SettingsPage: React.FC = () => {
  const [currentLanguage, setCurrentLanguage] = useState<LanguageCode>(
    LanguageCode.AUTO,
  );
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode>(
    LanguageCode.AUTO,
  );
  const [autostartEnabled, setAutostartEnabled] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isTogglingAutostart, setIsTogglingAutostart] = useState(false);

  // Load app config on mount
  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const config = await invoke<TauriAppConfig>("get_app_config");

        // Set language
        if (config.languages && config.languages.length > 0) {
          const firstLanguage = config.languages[0] as LanguageCode;
          if (Object.values(LanguageCode).includes(firstLanguage)) {
            setCurrentLanguage(firstLanguage);
            setSelectedLanguage(firstLanguage);
          }
        }

        // Set autostart
        if (
          config.launch_on_system_startup !== null &&
          config.launch_on_system_startup !== undefined
        ) {
          setAutostartEnabled(config.launch_on_system_startup);
        }
      } catch (err: any) {
        console.error("Failed to load app config:", err);
        setError(err?.message || "Failed to load configuration");
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();
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
      // Update app config with new language
      const updatedConfig = await invoke<TauriAppConfig>("update_app_config", {
        config: {
          languages: [selectedLanguage],
        },
      });

      // Update local state
      if (updatedConfig.languages && updatedConfig.languages.length > 0) {
        const firstLanguage = updatedConfig.languages[0] as LanguageCode;
        setCurrentLanguage(firstLanguage);
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
      const newValue = !autostartEnabled;

      // Update app config with new autostart value
      const updatedConfig = await invoke<TauriAppConfig>("update_app_config", {
        config: {
          launch_on_system_startup: newValue,
        },
      });

      // Update local state
      if (
        updatedConfig.launch_on_system_startup !== null &&
        updatedConfig.launch_on_system_startup !== undefined
      ) {
        setAutostartEnabled(updatedConfig.launch_on_system_startup);
        console.log(
          updatedConfig.launch_on_system_startup
            ? "✅ Auto-startup enabled"
            : "❌ Auto-startup disabled",
        );
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
              onChange={(e) =>
                setSelectedLanguage(e.target.value as LanguageCode)
              }
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
              disabled={isTogglingAutostart}
              style={{
                width: "44px",
                height: "24px",
                borderRadius: "12px",
                border: "none",
                backgroundColor: autostartEnabled
                  ? "rgba(52, 199, 89, 1)"
                  : "rgba(255, 255, 255, 0.2)",
                cursor: isTogglingAutostart ? "not-allowed" : "pointer",
                position: "relative",
                transition: "background-color 0.2s",
                opacity: isTogglingAutostart ? 0.5 : 1,
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
