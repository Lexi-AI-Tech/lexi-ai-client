import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  LanguageCode,
  getAllLanguageCodes,
  getLanguageName,
} from "../lib/constants";
import type { HotkeyConfig, TauriAppConfig } from "../types";

import { GoogleLoginButton } from "./auth/GoogleLoginButton";
import { HotkeySelector } from "./HotkeySelector";
import { ModelsSection } from "./ModelsSection";

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
  const [selectedAutostart, setSelectedAutostart] = useState<boolean | null>(
    null,
  );
  const [selectedEnhanceTranscription, setSelectedEnhanceTranscription] =
    useState<boolean | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [currentHotkeys, setCurrentHotkeys] = useState<HotkeyConfig>({
    hotkeys: [],
  });
  const [selectedHotkeys, setSelectedHotkeys] = useState<HotkeyConfig>({
    hotkeys: [],
  });

  // Derived values from config - no defaults, rely entirely on backend
  const currentLanguage = config?.languages?.[0] as LanguageCode | undefined;
  const autostartEnabled = config?.launch_on_system_startup;
  const enhanceTranscription = config?.enhance_transcription;
  const vocabulary = config?.vocabulary;

  // Load app config on mount
  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Load hotkeys from Tauri Store
        try {
          const hotkeyJson = await invoke<string>("get_current_hotkey");
          const hotkey: HotkeyConfig = JSON.parse(hotkeyJson);
          if (hotkey.hotkeys.length > 3) {
            hotkey.hotkeys = hotkey.hotkeys.slice(0, 3);
          }
          setCurrentHotkeys(hotkey);
          setSelectedHotkeys(hotkey);
        } catch (hotkeyErr) {
          console.warn("Failed to load hotkeys:", hotkeyErr);
        }

        const loadedConfig = await invoke<TauriAppConfig>("get_app_config");
        setConfig(loadedConfig);

        // Set selected values for all settings (only if backend provides them)
        if (loadedConfig.languages && loadedConfig.languages.length > 0) {
          const firstLanguage = loadedConfig.languages[0] as LanguageCode;
          if (Object.values(LanguageCode).includes(firstLanguage)) {
            setSelectedLanguage(firstLanguage);
          }
        } else {
          // Backend didn't provide a language, keep it null
          setSelectedLanguage(null);
        }
        setSelectedAutostart(loadedConfig.launch_on_system_startup ?? null);
        setSelectedEnhanceTranscription(
          loadedConfig.enhance_transcription ?? null,
        );
      } catch (err: any) {
        console.error("Failed to load app config:", err);
        setError(err?.message || "Failed to load configuration");
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();
  }, []);

  // Listen for hotkey updates from backend
  useEffect(() => {
    const setupListener = async () => {
      const unlisten = await listen<string>("hotkey-updated", (event) => {
        try {
          const hotkey: HotkeyConfig = JSON.parse(event.payload);
          if (hotkey.hotkeys.length > 3) {
            hotkey.hotkeys = hotkey.hotkeys.slice(0, 3);
          }
          setCurrentHotkeys(hotkey);
          setSelectedHotkeys(hotkey);
          setSuccess(true);
          setIsUpdating(false);
          setError(null);

          // Clear success message after 2 seconds
          setTimeout(() => setSuccess(false), 2000);
        } catch (err) {
          console.error("Failed to parse hotkey update:", err);
        }
      });

      return unlisten;
    };

    let unlistenFn: (() => void) | undefined;
    setupListener().then((unlisten) => {
      unlistenFn = unlisten;
    });

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
    };
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

  const handleSaveSettings = async () => {
    // Check if anything changed using the same logic as hasChanges
    const hotkeysChanged =
      JSON.stringify(selectedHotkeys.hotkeys) !==
      JSON.stringify(currentHotkeys.hotkeys);
    const languageChanged =
      selectedLanguage !== null &&
      selectedLanguage !== undefined &&
      selectedLanguage !== currentLanguage;

    const currentAutostart = autostartEnabled ?? false;
    const autostartChanged =
      selectedAutostart !== null &&
      selectedAutostart !== undefined &&
      selectedAutostart !== currentAutostart;

    const currentEnhance = enhanceTranscription ?? false;
    const enhanceChanged =
      selectedEnhanceTranscription !== null &&
      selectedEnhanceTranscription !== undefined &&
      selectedEnhanceTranscription !== currentEnhance;

    if (
      !hotkeysChanged &&
      !languageChanged &&
      !autostartChanged &&
      !enhanceChanged
    ) {
      return; // No changes needed
    }

    setIsUpdating(true);
    setError(null);
    setSuccess(false);

    try {
      // Validate hotkeys if changed
      if (hotkeysChanged) {
        if (selectedHotkeys.hotkeys.length > 3) {
          setError("Maximum of 3 hotkeys allowed");
          setIsUpdating(false);
          return;
        }
        if (selectedHotkeys.hotkeys.length === 0) {
          setError("At least one hotkey is required");
          setIsUpdating(false);
          return;
        }
      }

      // Update Rust backend if hotkeys changed
      if (hotkeysChanged) {
        const configJson = JSON.stringify(selectedHotkeys);
        await invoke("update_hotkey", { configJson });
        setCurrentHotkeys(selectedHotkeys);
      }

      const updates: Partial<TauriAppConfig> = {};

      if (languageChanged && selectedLanguage !== null) {
        updates.languages = [selectedLanguage];
      }
      if (autostartChanged && selectedAutostart !== null) {
        updates.launch_on_system_startup = selectedAutostart;
      }
      if (enhanceChanged && selectedEnhanceTranscription !== null) {
        updates.enhance_transcription = selectedEnhanceTranscription;
      }
      const updatedConfig = await updateConfig(updates);

      // Update selected values to match the saved config
      if (
        languageChanged &&
        updatedConfig.languages &&
        updatedConfig.languages.length > 0
      ) {
        setSelectedLanguage(updatedConfig.languages[0] as LanguageCode);
      }
      if (
        autostartChanged &&
        updatedConfig.launch_on_system_startup !== undefined
      ) {
        setSelectedAutostart(updatedConfig.launch_on_system_startup);
      }
      if (enhanceChanged && updatedConfig.enhance_transcription !== undefined) {
        setSelectedEnhanceTranscription(updatedConfig.enhance_transcription);
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      // Error already set by updateConfig
    } finally {
      setIsUpdating(false);
    }
  };

  const hasChanges = () => {
    // Compare hotkeys
    const hotkeysChanged =
      JSON.stringify(selectedHotkeys.hotkeys) !==
      JSON.stringify(currentHotkeys.hotkeys);

    // Compare language
    const languageChanged =
      selectedLanguage !== null &&
      selectedLanguage !== undefined &&
      selectedLanguage !== currentLanguage;

    // Compare autostart (handle null/undefined properly)
    // If selectedAutostart is null, it means unchanged, so no change
    // If selectedAutostart is a boolean, compare it to current value
    const currentAutostart = autostartEnabled ?? false;
    const autostartChanged =
      selectedAutostart !== null &&
      selectedAutostart !== undefined &&
      selectedAutostart !== currentAutostart;

    // Compare enhance transcription
    const currentEnhance = enhanceTranscription ?? false;
    const enhanceChanged =
      selectedEnhanceTranscription !== null &&
      selectedEnhanceTranscription !== undefined &&
      selectedEnhanceTranscription !== currentEnhance;

    // Compare cursor context
    return (
      hotkeysChanged ||
      languageChanged ||
      autostartChanged ||
      enhanceChanged
    );
  };

  const handleToggleAutostart = () => {
    const currentValue = selectedAutostart ?? autostartEnabled ?? false;
    setSelectedAutostart(!currentValue);
  };

  const handleToggleEnhanceTranscription = () => {
    const currentValue =
      selectedEnhanceTranscription ?? enhanceTranscription ?? false;
    setSelectedEnhanceTranscription(!currentValue);
  };

  const handleHotkeySelectorChange = (config: HotkeyConfig) => {
    // Limit to 3 hotkeys
    const limitedHotkeys = config.hotkeys.slice(0, 3);
    setSelectedHotkeys({ hotkeys: limitedHotkeys });
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
          Hotkeys
        </h3>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            marginBottom: "32px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "11px",
                color: "rgba(255, 255, 255, 0.6)",
                marginBottom: "8px",
              }}
            >
              Current Hotkeys ({currentHotkeys.hotkeys.length}/3)
            </div>
            {currentHotkeys.hotkeys.length > 0 ? (
              <div
                style={{
                  padding: "12px",
                  backgroundColor: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "6px",
                  marginBottom: "8px",
                }}
              >
                {currentHotkeys.hotkeys.map((hotkey, index) => (
                  <div
                    key={index}
                    style={{
                      fontSize: "11px",
                      fontFamily:
                        'SF Mono, Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
                      color: "rgba(255, 255, 255, 0.9)",
                      padding: "4px 0",
                    }}
                  >
                    {hotkey}
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  fontSize: "11px",
                  color: "rgba(255, 255, 255, 0.4)",
                  padding: "12px",
                  backgroundColor: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "6px",
                  marginBottom: "8px",
                }}
              >
                No hotkeys configured
              </div>
            )}
            <div
              style={{
                fontSize: "10px",
                color: "rgba(255, 255, 255, 0.5)",
                marginTop: "6px",
              }}
            >
              Press any of these combinations to start/stop recording
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: "11px",
                color: "rgba(255, 255, 255, 0.6)",
                marginBottom: "8px",
              }}
            >
              Configure Hotkeys
            </div>
            <HotkeySelector
              value={selectedHotkeys}
              onChange={handleHotkeySelectorChange}
              maxHotkeys={3}
              disabled={isUpdating}
            />
            <div
              style={{
                fontSize: "10px",
                color: "rgba(255, 255, 255, 0.5)",
                marginTop: "6px",
              }}
            >
              Note: Fn key is handled separately and works on Mac. Other hotkeys
              use Tauri global shortcuts.
            </div>
          </div>
        </div>
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
              enabled={
                (selectedEnhanceTranscription ??
                  enhanceTranscription ??
                  false) === true
              }
              onToggle={handleToggleEnhanceTranscription}
              disabled={isLoading || isUpdating}
            />
          </div>
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
              enabled={
                (selectedAutostart ?? autostartEnabled ?? false) === true
              }
              onToggle={handleToggleAutostart}
              disabled={isLoading || isUpdating}
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
      {/* 
      <div style={{ marginTop: "32px" }}>
        <ModelsSection />
      </div> */}

      <div style={{ marginTop: "32px" }}>
        <button
          className="transcript-btn"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isUpdating && hasChanges() && !isLoading) {
              handleSaveSettings();
            }
          }}
          disabled={isUpdating || !hasChanges() || isLoading}
          style={{
            padding: "8px 16px",
            fontSize: "11px",
            width: "100%",
            opacity: isUpdating || !hasChanges() || isLoading ? 0.5 : 1,
            cursor:
              isUpdating || !hasChanges() || isLoading
                ? "not-allowed"
                : "pointer",
            transition: "opacity 0.2s",
          }}
        >
          {isUpdating ? "Saving..." : "Save Settings"}
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
              marginTop: "12px",
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
              marginTop: "12px",
            }}
          >
            Settings saved successfully!
          </div>
        )}

        <div
          style={{
            fontSize: "10px",
            color: "rgba(255, 255, 255, 0.4)",
            marginTop: "8px",
            lineHeight: "1.4",
          }}
        >
          The listener will restart automatically when you change the hotkey.
        </div>
      </div>
    </div>
  );
};
