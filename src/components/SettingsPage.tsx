import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  LanguageCode,
  getAllLanguageCodes,
  getLanguageName,
} from "../lib/constants";
import type { TauriAppConfig } from "../types";

import { GoogleLoginButton } from "./auth/GoogleLoginButton";

// Supported languages for transcription
const SUPPORTED_LANGUAGES = getAllLanguageCodes().map((code) => ({
  value: code,
  label: getLanguageName(code),
}));

export const SettingsPage: React.FC = () => {
  const [config, setConfig] = useState<TauriAppConfig | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode | null>(
    null,
  );
  const [isUpdating, setIsUpdating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Derived values from config - no defaults, rely entirely on backend
  const currentLanguage = config?.languages?.[0] as LanguageCode | undefined;
  const autostartEnabled = config?.launch_on_system_startup;
  const enhanceTranscription = config?.enhance_transcription;
  const transcribeWithCursorContext = config?.transcribe_with_cursor_context;
  const transcriptionHotkeys = config?.transcription_hotkeys;
  const vocabulary = config?.vocabulary;

  // Load app config on mount
  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const loadedConfig = await invoke<TauriAppConfig>("get_app_config");
        setConfig(loadedConfig);

        // Set selected language for the dropdown (only if backend provides it)
        if (loadedConfig.languages && loadedConfig.languages.length > 0) {
          const firstLanguage = loadedConfig.languages[0] as LanguageCode;
          if (Object.values(LanguageCode).includes(firstLanguage)) {
            setSelectedLanguage(firstLanguage);
          }
        } else {
          // Backend didn't provide a language, keep it null
          setSelectedLanguage(null);
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

  // Generic update function for app config
  const updateConfig = async (updates: Partial<TauriAppConfig>) => {
    setError(null);
    try {
      const updatedConfig = await invoke<TauriAppConfig>("update_app_config", {
        config: updates,
      });
      setConfig(updatedConfig);
      return updatedConfig;
    } catch (err: any) {
      console.error("Failed to update config:", err);
      setError(err?.message || "Failed to update setting");
      throw err;
    }
  };

  const handleSaveLanguage = async () => {
    if (selectedLanguage === null) {
      return; // No language selected
    }

    const languageChanged = selectedLanguage !== currentLanguage;

    if (!languageChanged) {
      return; // No change needed
    }

    setIsUpdating(true);
    setError(null);
    setSuccess(false);

    try {
      await updateConfig({ languages: [selectedLanguage] });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      // Error already set by updateConfig
    } finally {
      setIsUpdating(false);
    }
  };

  const isLanguageChanged =
    selectedLanguage !== null && selectedLanguage !== currentLanguage;

  const handleToggleAutostart = async () => {
    try {
      const updatedConfig = await updateConfig({
        launch_on_system_startup: autostartEnabled === true ? false : true,
      });
      console.log(
        updatedConfig.launch_on_system_startup
          ? "✅ Auto-startup enabled"
          : "❌ Auto-startup disabled",
      );
    } catch (err: any) {
      // Error already set by updateConfig
    }
  };

  const handleToggleEnhanceTranscription = async () => {
    try {
      await updateConfig({
        enhance_transcription: enhanceTranscription === true ? false : true,
      });
    } catch (err: any) {
      // Error already set by updateConfig
    }
  };

  const handleToggleCursorContext = async () => {
    try {
      await updateConfig({
        transcribe_with_cursor_context:
          transcribeWithCursorContext === true ? false : true,
      });
    } catch (err: any) {
      // Error already set by updateConfig
    }
  };

  const ToggleSwitch: React.FC<{
    enabled: boolean;
    onToggle: () => void;
    disabled?: boolean;
  }> = ({ enabled, onToggle, disabled = false }) => (
    <button
      onClick={onToggle}
      disabled={disabled}
      style={{
        width: "44px",
        height: "24px",
        borderRadius: "12px",
        border: "none",
        backgroundColor: enabled
          ? "rgba(52, 199, 89, 1)"
          : "rgba(255, 255, 255, 0.2)",
        cursor: disabled ? "not-allowed" : "pointer",
        position: "relative",
        transition: "background-color 0.2s",
        opacity: disabled ? 0.5 : 1,
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
          left: enabled ? "22px" : "2px",
          transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.3)",
        }}
      />
    </button>
  );

  // Don't render settings content until config is loaded to prevent flash of defaults
  if (isLoading) {
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
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "40px",
            color: "rgba(255, 255, 255, 0.6)",
            fontSize: "14px",
          }}
        >
          Loading settings...
        </div>
      </div>
    );
  }

  // Show error state if config failed to load
  if (config === null) {
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
        {error && (
          <div
            className="permission-message"
            style={{
              background: "rgba(255, 59, 48, 0.1)",
              borderColor: "rgba(255, 59, 48, 0.2)",
              color: "rgba(255, 59, 48, 0.9)",
              fontSize: "11px",
              padding: "12px",
              marginBottom: "16px",
            }}
          >
            {error}
          </div>
        )}
      </div>
    );
  }

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
              value={selectedLanguage || ""}
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
                : selectedLanguage
                  ? `Transcription will be limited to ${SUPPORTED_LANGUAGES.find((l) => l.value === selectedLanguage)?.label || selectedLanguage}`
                  : "No language selected"}
            </div>
          </div>

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
                Enhance Transcription
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "rgba(255, 255, 255, 0.6)",
                }}
              >
                Use AI to improve transcription accuracy and formatting
              </div>
            </div>
            <ToggleSwitch
              enabled={enhanceTranscription === true}
              onToggle={handleToggleEnhanceTranscription}
              disabled={isLoading}
            />
          </div>

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
                Transcribe with Cursor Context
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "rgba(255, 255, 255, 0.6)",
                }}
              >
                Use surrounding text context to improve transcription accuracy
              </div>
            </div>
            <ToggleSwitch
              enabled={transcribeWithCursorContext === true}
              onToggle={handleToggleCursorContext}
              disabled={isLoading}
            />
          </div>

          {transcriptionHotkeys && transcriptionHotkeys.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: "11px",
                  color: "rgba(255, 255, 255, 0.6)",
                  marginBottom: "8px",
                }}
              >
                Transcription Hotkeys
              </div>
              <div
                style={{
                  padding: "12px",
                  backgroundColor: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "6px",
                  fontSize: "11px",
                  color: "rgba(255, 255, 255, 0.9)",
                }}
              >
                {transcriptionHotkeys.join(", ")}
              </div>
              <div
                style={{
                  fontSize: "10px",
                  color: "rgba(255, 255, 255, 0.5)",
                  marginTop: "6px",
                }}
              >
                Configure hotkeys in the Hotkey Settings section
              </div>
            </div>
          )}

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
            <ToggleSwitch
              enabled={autostartEnabled === true}
              onToggle={handleToggleAutostart}
              disabled={isLoading}
            />
          </div>
        </div>
      </div>

      {vocabulary && vocabulary.length > 0 && (
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
            Vocabulary
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {vocabulary
              .filter((item) => !item.hidden)
              .map((item, index) => (
                <div
                  key={index}
                  style={{
                    padding: "12px",
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "6px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: "13px",
                        color: "#ffffff",
                        fontWeight: 500,
                      }}
                    >
                      {item.value}
                    </div>
                    {item.is_system_generated && (
                      <div
                        style={{
                          fontSize: "10px",
                          color: "rgba(255, 255, 255, 0.5)",
                          marginTop: "4px",
                        }}
                      >
                        System generated
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};
