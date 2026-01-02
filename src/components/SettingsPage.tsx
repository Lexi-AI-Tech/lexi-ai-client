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
  const [currentLanguage, setCurrentLanguage] = useState<LanguageCode>(
    LanguageCode.AUTO,
  );
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode>(
    LanguageCode.AUTO,
  );
  const [autostartEnabled, setAutostartEnabled] = useState<boolean>(false);
  const [enhanceTranscription, setEnhanceTranscription] = useState<boolean>(false);
  const [transcribeWithCursorContext, setTranscribeWithCursorContext] = useState<boolean>(false);
  const [transcriptionHotkeys, setTranscriptionHotkeys] = useState<string[]>([]);
  const [vocabulary, setVocabulary] = useState<Array<{value: string; is_system_generated: boolean; hidden: boolean}>>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isTogglingAutostart, setIsTogglingAutostart] = useState(false);
  const [isTogglingEnhance, setIsTogglingEnhance] = useState(false);
  const [isTogglingCursorContext, setIsTogglingCursorContext] = useState(false);
  const [fullConfig, setFullConfig] = useState<TauriAppConfig | null>(null);
  const [showFullConfig, setShowFullConfig] = useState(false);

  // Load app config on mount
  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const config = await invoke<TauriAppConfig>("get_app_config");
        
        // Store full config
        setFullConfig(config);

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

        // Set enhance transcription
        if (
          config.enhance_transcription !== null &&
          config.enhance_transcription !== undefined
        ) {
          setEnhanceTranscription(config.enhance_transcription);
        }

        // Set transcribe with cursor context
        if (
          config.transcribe_with_cursor_context !== null &&
          config.transcribe_with_cursor_context !== undefined
        ) {
          setTranscribeWithCursorContext(config.transcribe_with_cursor_context);
        }

        // Set transcription hotkeys
        if (config.transcription_hotkeys) {
          setTranscriptionHotkeys(config.transcription_hotkeys);
        }

        // Set vocabulary
        if (config.vocabulary) {
          setVocabulary(config.vocabulary);
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
      
      // Update full config
      setFullConfig(updatedConfig);

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
      
      // Update full config
      setFullConfig(updatedConfig);
    } catch (err: any) {
      console.error("Failed to toggle autostart:", err);
      setError(err?.message || "Failed to update auto-startup setting");
    } finally {
      setIsTogglingAutostart(false);
    }
  };

  const handleToggleEnhanceTranscription = async () => {
    setIsTogglingEnhance(true);
    setError(null);
    try {
      const newValue = !enhanceTranscription;

      const updatedConfig = await invoke<TauriAppConfig>("update_app_config", {
        config: {
          enhance_transcription: newValue,
        },
      });

      if (
        updatedConfig.enhance_transcription !== null &&
        updatedConfig.enhance_transcription !== undefined
      ) {
        setEnhanceTranscription(updatedConfig.enhance_transcription);
      }
      
      setFullConfig(updatedConfig);
    } catch (err: any) {
      console.error("Failed to toggle enhance transcription:", err);
      setError(err?.message || "Failed to update enhance transcription setting");
    } finally {
      setIsTogglingEnhance(false);
    }
  };

  const handleToggleCursorContext = async () => {
    setIsTogglingCursorContext(true);
    setError(null);
    try {
      const newValue = !transcribeWithCursorContext;

      const updatedConfig = await invoke<TauriAppConfig>("update_app_config", {
        config: {
          transcribe_with_cursor_context: newValue,
        },
      });

      if (
        updatedConfig.transcribe_with_cursor_context !== null &&
        updatedConfig.transcribe_with_cursor_context !== undefined
      ) {
        setTranscribeWithCursorContext(updatedConfig.transcribe_with_cursor_context);
      }
      
      setFullConfig(updatedConfig);
    } catch (err: any) {
      console.error("Failed to toggle cursor context:", err);
      setError(err?.message || "Failed to update cursor context setting");
    } finally {
      setIsTogglingCursorContext(false);
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
              enabled={enhanceTranscription}
              onToggle={handleToggleEnhanceTranscription}
              disabled={isTogglingEnhance || isLoading}
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
              enabled={transcribeWithCursorContext}
              onToggle={handleToggleCursorContext}
              disabled={isTogglingCursorContext || isLoading}
            />
          </div>

          {transcriptionHotkeys.length > 0 && (
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
              enabled={autostartEnabled}
              onToggle={handleToggleAutostart}
              disabled={isTogglingAutostart || isLoading}
            />
          </div>
        </div>
      </div>

      {vocabulary.length > 0 && (
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
          Advanced
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <button
            onClick={() => setShowFullConfig(!showFullConfig)}
            style={{
              padding: "8px 16px",
              fontSize: "11px",
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "6px",
              color: "#ffffff",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            {showFullConfig ? "▼ Hide" : "▶ Show"} Raw Configuration (JSON)
          </button>

          {showFullConfig && fullConfig && (
            <div
              style={{
                padding: "16px",
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "6px",
                fontSize: "11px",
                fontFamily: "monospace",
                color: "rgba(255, 255, 255, 0.9)",
                whiteSpace: "pre-wrap",
                overflowX: "auto",
                maxHeight: "400px",
                overflowY: "auto",
              }}
            >
              {JSON.stringify(fullConfig, null, 2)}
            </div>
          )}

          {showFullConfig && !fullConfig && !isLoading && (
            <div
              style={{
                padding: "12px",
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "6px",
                fontSize: "11px",
                color: "rgba(255, 255, 255, 0.6)",
              }}
            >
              No configuration loaded
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
