/**
 * HotkeySettings Component
 *
 * Allows users to configure the hotkey that triggers recording.
 * Supports any key combination including modifiers (Cmd, Shift, Alt, Ctrl).
 */

import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  LanguageCode,
  getAllLanguageCodes,
  getLanguageName,
} from "../lib/constants";
import type { HotkeyConfig, TauriAppConfig } from "../types";

import { HotkeyInput } from "./HotkeyInput";

// Supported languages for transcription
const SUPPORTED_LANGUAGES = getAllLanguageCodes().map((code) => ({
  value: code,
  label: getLanguageName(code),
}));

export const HotkeySettings: React.FC = () => {
  const [currentHotkeys, setCurrentHotkeys] = useState<HotkeyConfig>({
    hotkeys: [],
  });
  const [selectedHotkeys, setSelectedHotkeys] = useState<HotkeyConfig>({
    hotkeys: [],
  });
  const [currentLanguage, setCurrentLanguage] = useState<LanguageCode>(
    LanguageCode.EN,
  );
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode>(
    LanguageCode.EN,
  );
  const [isUpdating, setIsUpdating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load current config on mount
  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Load hotkeys from Tauri Store (server provides defaults)
        const hotkeyJson = await invoke<string>("get_current_hotkey");
        const hotkey: HotkeyConfig = JSON.parse(hotkeyJson);
        // Server should always provide hotkeys
        if (hotkey.hotkeys.length > 3) {
          hotkey.hotkeys = hotkey.hotkeys.slice(0, 3);
        }
        setCurrentHotkeys(hotkey);
        setSelectedHotkeys(hotkey);

        // Load language from app config
        try {
          const config = await invoke<TauriAppConfig>("get_app_config");
          if (config.languages && config.languages.length > 0) {
            const firstLanguage = config.languages[0] as LanguageCode;
            if (Object.values(LanguageCode).includes(firstLanguage)) {
              setCurrentLanguage(firstLanguage);
              setSelectedLanguage(firstLanguage);
            }
          }
        } catch (langErr) {
          console.warn("Failed to load language from app config:", langErr);
        }
      } catch (err: any) {
        console.error("Failed to load config:", err);
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

  const handleSaveConfig = async () => {
    // Check if anything changed
    const hotkeysChanged =
      JSON.stringify(selectedHotkeys.hotkeys) !==
      JSON.stringify(currentHotkeys.hotkeys);
    const languageChanged = selectedLanguage !== currentLanguage;

    if (!hotkeysChanged && !languageChanged) {
      return; // No change needed
    }

    setIsUpdating(true);
    setError(null);
    setSuccess(false);

    try {
      // Validate: maximum 3 hotkeys
      if (selectedHotkeys.hotkeys.length > 3) {
        setError("Maximum of 3 hotkeys allowed");
        setIsUpdating(false);
        return;
      }

      // Validate: at least one hotkey
      if (selectedHotkeys.hotkeys.length === 0) {
        setError("At least one hotkey is required");
        setIsUpdating(false);
        return;
      }

      // Update Rust backend if hotkeys changed (works even without auth)
      if (hotkeysChanged) {
        const configJson = JSON.stringify(selectedHotkeys);
        await invoke("update_hotkey", { configJson });
      }

      // Update app config if language changed
      if (languageChanged) {
        await invoke("update_app_config", {
          config: {
            languages: [selectedLanguage],
          },
        });
        setCurrentLanguage(selectedLanguage);
      }

      // Update local state for hotkeys (hotkeys are already saved via update_hotkey command)
      if (hotkeysChanged) {
        setCurrentHotkeys(selectedHotkeys);
      }

      setSuccess(true);
      setIsUpdating(false);

      // Clear success message after 2 seconds
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      console.error("Failed to update config:", err);
      setError(err?.message || "Failed to update configuration");
      setIsUpdating(false);
    }
  };

  const handleHotkeyInputChange = (index: number, config: HotkeyConfig) => {
    const newHotkeys = [...selectedHotkeys.hotkeys];
    // HotkeyInput returns a HotkeyConfig with hotkeys array
    // Extract the hotkey string (support both old and new format for compatibility)
    const hotkeyStr = config.hotkeys?.[0] || (config as any).hotkey || "";
    if (hotkeyStr && index < newHotkeys.length) {
      newHotkeys[index] = hotkeyStr;
    } else if (hotkeyStr) {
      newHotkeys.push(hotkeyStr);
    }
    // Limit to 3 hotkeys
    if (newHotkeys.length > 3) {
      newHotkeys.splice(3);
    }
    setSelectedHotkeys({ hotkeys: newHotkeys });
  };

  const handleRemoveHotkey = (index: number) => {
    const newHotkeys = selectedHotkeys.hotkeys.filter((_, i) => i !== index);
    // Keep at least one hotkey
    if (newHotkeys.length === 0 && selectedHotkeys.hotkeys.length > 0) {
      return;
    }
    setSelectedHotkeys({ hotkeys: newHotkeys });
  };

  const handleAddHotkey = () => {
    if (selectedHotkeys.hotkeys.length < 3) {
      setSelectedHotkeys({
        hotkeys: [...selectedHotkeys.hotkeys, ""],
      });
    }
  };

  const isHotkeysChanged =
    JSON.stringify(selectedHotkeys.hotkeys) !==
    JSON.stringify(currentHotkeys.hotkeys);
  const isLanguageChanged = selectedLanguage !== currentLanguage;
  const hasChanges = isHotkeysChanged || isLanguageChanged;

  if (isLoading) {
    return (
      <div className="settings">
        <h3>Hotkey Settings</h3>
        <div style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: "11px" }}>
          Loading configuration...
        </div>
      </div>
    );
  }

  return (
    <div className="settings">
      <h3>Hotkey Settings</h3>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
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
          {currentHotkeys.hotkeys.map((hotkey, index) => (
            <div key={index} style={{ marginBottom: "8px" }}>
              <HotkeyInput
                value={{ hotkeys: [hotkey] }}
                onChange={() => {}} // Read-only
                disabled={true}
              />
            </div>
          ))}
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
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>Configure Hotkeys ({selectedHotkeys.hotkeys.length}/3)</span>
            {selectedHotkeys.hotkeys.length < 3 && (
              <button
                onClick={handleAddHotkey}
                disabled={isUpdating}
                style={{
                  fontSize: "10px",
                  padding: "4px 8px",
                  backgroundColor: "rgba(255, 255, 255, 0.1)",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  borderRadius: "4px",
                  color: "#ffffff",
                  cursor: isUpdating ? "not-allowed" : "pointer",
                  opacity: isUpdating ? 0.5 : 1,
                }}
              >
                + Add Hotkey
              </button>
            )}
          </div>
          {selectedHotkeys.hotkeys.map((hotkey, index) => (
            <div
              key={index}
              style={{
                marginBottom: "8px",
                display: "flex",
                gap: "8px",
                alignItems: "center",
              }}
            >
              <div style={{ flex: 1 }}>
                <HotkeyInput
                  value={{ hotkeys: [hotkey] }}
                  onChange={(config) => handleHotkeyInputChange(index, config)}
                  disabled={isUpdating}
                />
              </div>
              {selectedHotkeys.hotkeys.length > 1 && (
                <button
                  onClick={() => handleRemoveHotkey(index)}
                  disabled={isUpdating}
                  style={{
                    fontSize: "10px",
                    padding: "4px 8px",
                    backgroundColor: "rgba(255, 59, 48, 0.2)",
                    border: "1px solid rgba(255, 59, 48, 0.3)",
                    borderRadius: "4px",
                    color: "rgba(255, 59, 48, 0.9)",
                    cursor: isUpdating ? "not-allowed" : "pointer",
                    opacity: isUpdating ? 0.5 : 1,
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
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
            disabled={isUpdating}
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: "11px",
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "6px",
              color: "#ffffff",
              cursor: isUpdating ? "not-allowed" : "pointer",
              opacity: isUpdating ? 0.5 : 1,
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
          onClick={handleSaveConfig}
          disabled={isUpdating || !hasChanges}
          style={{
            marginTop: "8px",
            padding: "8px 16px",
            fontSize: "11px",
            width: "100%",
            opacity: isUpdating || !hasChanges ? 0.5 : 1,
          }}
        >
          {isUpdating ? "Saving..." : "Save Configuration"}
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
            Configuration saved successfully!
          </div>
        )}

        <div
          style={{
            fontSize: "10px",
            color: "rgba(255, 255, 255, 0.4)",
            marginTop: "4px",
            lineHeight: "1.4",
          }}
        >
          The listener will restart automatically when you change the hotkey.
        </div>
      </div>
    </div>
  );
};
