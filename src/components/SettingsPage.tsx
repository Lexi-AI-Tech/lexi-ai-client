import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Monitor, Mic, Power, Keyboard } from "lucide-react";

import {
  LanguageCode,
  getAllLanguageCodes,
  getLanguageName,
} from "../lib/constants";
import type { TauriAppConfig, HotkeyConfig } from "../types";

import { GoogleLoginButton } from "./auth/GoogleLoginButton";
import { HotkeySelector } from "./HotkeySelector";
import { useAuthStore } from "../store/authStore";

// Supported languages for transcription
const SUPPORTED_LANGUAGES = getAllLanguageCodes().map((code) => ({
  value: code,
  label: getLanguageName(code),
}));

export const SettingsPage: React.FC = () => {
  const authStore = useAuthStore();
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

  // Hotkey state
  const [currentHotkeys, setCurrentHotkeys] = useState<HotkeyConfig>({
    hotkeys: [],
  });
  const [selectedHotkeys, setSelectedHotkeys] = useState<HotkeyConfig>({
    hotkeys: [],
  });
  const [isUpdatingHotkeys, setIsUpdatingHotkeys] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [hotkeySuccess, setHotkeySuccess] = useState(false);
  const [activeSection, setActiveSection] = useState<
    "account" | "transcription" | "general" | "hotkeys"
  >("account");

  // Derived values from config - no defaults, rely entirely on backend
  const currentLanguage = config?.languages?.[0] as LanguageCode | undefined;
  const autostartEnabled = config?.launch_on_system_startup;
  const enhanceTranscription = config?.enhance_transcription;
  const vocabulary = config?.vocabulary;
  const configHotkeys = config?.hotkeys || [];

  // Load app config on mount
  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);

      try {
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

  // Load hotkeys on mount
  useEffect(() => {
    const loadHotkeys = async () => {
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
        // If hotkeys are in config, use those
        if (configHotkeys.length > 0) {
          const hotkey: HotkeyConfig = {
            hotkeys: configHotkeys.slice(0, 3),
          };
          setCurrentHotkeys(hotkey);
          setSelectedHotkeys(hotkey);
        }
      }
    };

    if (config) {
      loadHotkeys();
    }
  }, [config, configHotkeys]);

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
          setHotkeySuccess(true);
          setIsUpdatingHotkeys(false);
          setHotkeyError(null);

          // Clear success message after 2 seconds
          setTimeout(() => setHotkeySuccess(false), 2000);
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

    if (!languageChanged && !autostartChanged && !enhanceChanged) {
      return; // No changes needed
    }

    setIsUpdating(true);
    setError(null);
    setSuccess(false);

    try {
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

    return languageChanged || autostartChanged || enhanceChanged;
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

  const handleSaveHotkeys = async () => {
    const hotkeysChanged =
      JSON.stringify(selectedHotkeys.hotkeys) !==
      JSON.stringify(currentHotkeys.hotkeys);

    if (!hotkeysChanged) {
      return; // No changes needed
    }

    setIsUpdatingHotkeys(true);
    setHotkeyError(null);
    setHotkeySuccess(false);

    try {
      // Validate hotkeys
      if (selectedHotkeys.hotkeys.length > 3) {
        setHotkeyError("Maximum of 3 hotkeys allowed");
        setIsUpdatingHotkeys(false);
        return;
      }
      if (selectedHotkeys.hotkeys.length === 0) {
        setHotkeyError("At least one hotkey is required");
        setIsUpdatingHotkeys(false);
        return;
      }

      // Update hotkey configuration
      const configJson = JSON.stringify(selectedHotkeys);
      await invoke("update_hotkey", { configJson });
      setCurrentHotkeys(selectedHotkeys);

      setHotkeySuccess(true);
      setTimeout(() => setHotkeySuccess(false), 2000);
    } catch (err: any) {
      console.error("Failed to update hotkeys:", err);
      setHotkeyError(err?.message || "Failed to update hotkeys");
    } finally {
      setIsUpdatingHotkeys(false);
    }
  };

  const hasHotkeyChanges = () => {
    return (
      JSON.stringify(selectedHotkeys.hotkeys) !==
      JSON.stringify(currentHotkeys.hotkeys)
    );
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
        width: "48px",
        height: "28px",
        borderRadius: "14px",
        border: "none",
        background: enabled
          ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
          : "#e5e7eb",
        cursor: disabled ? "not-allowed" : "pointer",
        position: "relative",
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        opacity: disabled ? 0.5 : 1,
        boxShadow: enabled
          ? "0 2px 8px rgba(16, 185, 129, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)"
          : "inset 0 2px 4px rgba(0, 0, 0, 0.06)",
      }}
      onMouseEnter={(e) => {
        if (!disabled && enabled) {
          e.currentTarget.style.boxShadow =
            "0 4px 12px rgba(16, 185, 129, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)";
        } else if (!disabled && !enabled) {
          e.currentTarget.style.background = "#d1d5db";
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled && enabled) {
          e.currentTarget.style.boxShadow =
            "0 2px 8px rgba(16, 185, 129, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)";
        } else if (!disabled && !enabled) {
          e.currentTarget.style.background = "#e5e7eb";
        }
      }}
    >
      <div
        style={{
          width: "22px",
          height: "22px",
          borderRadius: "50%",
          background: "#ffffff",
          position: "absolute",
          top: "3px",
          left: enabled ? "23px" : "3px",
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          boxShadow: enabled
            ? "0 2px 6px rgba(0, 0, 0, 0.2), 0 1px 2px rgba(0, 0, 0, 0.1)"
            : "0 2px 4px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {enabled && (
          <div
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
            }}
          />
        )}
      </div>
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
            color: "#111827",
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
            color: "#6b7280",
            fontSize: "14px",
          }}
        >
          Loading settings...
        </div>
      </div>
    );
  }

  // Show login prompt if not authenticated
  // This prevents showing cached config when user is logged out
  if (!authStore.isAuthenticated) {
    return (
      <div className="settings-page">
        <h2
          style={{
            margin: 0,
            marginBottom: "32px",
            fontSize: "24px",
            fontWeight: 600,
            color: "#111827",
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
              color: "#111827",
            }}
          >
            Account
          </h3>
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <p className="permission-text" style={{ marginBottom: "16px" }}>
              Sign in to access your settings
            </p>
            <GoogleLoginButton
              onSuccess={() => {
                // Settings will be loaded automatically via useEffect
              }}
              onError={(err) => {
                setError(err || "Authentication failed");
              }}
            />
          </div>
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
            color: "#111827",
          }}
        >
          Settings
        </h2>
        {error && (
          <div
            className="permission-message"
            style={{
              background: "#fef2f2",
              borderColor: "#fecaca",
              color: "#b91c1c",
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
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "calc(100vh - 48px)",
        background: "#ffffff",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Sidebar Navigation */}
      <div
        style={{
          width: "240px",
          background: "#ffffff",
          borderRight: "1px solid #f3f4f6",
          padding: "2rem 1.5rem",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h2
          style={{
            margin: 0,
            marginBottom: "1.5rem",
            fontSize: "1.5rem",
            fontWeight: 600,
            color: "#111827",
            letterSpacing: "-0.025em",
          }}
        >
          Settings
        </h2>
        <nav
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            padding: "0.75rem",
            background: "#f9fafb",
            borderRadius: "0.75rem",
            border: "1px solid #f3f4f6",
          }}
        >
          {[
            { id: "account" as const, label: "Account", icon: Monitor },
            { id: "transcription" as const, label: "Transcription", icon: Mic },
            { id: "general" as const, label: "General", icon: Power },
            { id: "hotkeys" as const, label: "Hotkey Settings", icon: Keyboard },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                padding: "0.625rem 0.75rem",
                borderRadius: "0.5rem",
                border: "none",
                background:
                  activeSection === id ? "#111827" : "transparent",
                color: activeSection === id ? "#ffffff" : "#6b7280",
                cursor: "pointer",
                transition: "all 0.2s ease",
                fontSize: "0.8125rem",
                fontWeight: activeSection === id ? 500 : 400,
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                if (activeSection !== id) {
                  e.currentTarget.style.background = "#ffffff";
                  e.currentTarget.style.color = "#111827";
                }
              }}
              onMouseLeave={(e) => {
                if (activeSection !== id) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#6b7280";
                }
              }}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content Area */}
      <div
        style={{
          flex: 1,
          padding: "2rem 2.5rem",
          overflowY: "auto",
        }}
      >

        {/* Account Section */}
        {activeSection === "account" && (
          <div>
            <h2
              style={{
                margin: 0,
                marginBottom: "0.5rem",
                fontSize: "1.75rem",
                fontWeight: 600,
                color: "#111827",
                letterSpacing: "-0.025em",
              }}
            >
              Account
            </h2>
            <p
              style={{
                margin: 0,
                marginBottom: "2rem",
                fontSize: "0.9375rem",
                color: "#6b7280",
              }}
            >
              Manage your profile and account settings.
            </p>
            <div
              style={{
                padding: "1.5rem",
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "0.75rem",
              }}
            >
              <GoogleLoginButton />
            </div>
          </div>
        )}

        {/* Transcription Section */}
        {activeSection === "transcription" && (
          <div>
            <h2
              style={{
                margin: 0,
                marginBottom: "0.5rem",
                fontSize: "1.75rem",
                fontWeight: 600,
                color: "#111827",
                letterSpacing: "-0.025em",
              }}
            >
              Transcription
            </h2>
            <p
              style={{
                margin: 0,
                marginBottom: "2rem",
                fontSize: "0.9375rem",
                color: "#6b7280",
              }}
            >
              Language and processing configurations.
            </p>

            <div
              style={{
                padding: "1.5rem",
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "0.75rem",
                marginBottom: "1rem",
              }}
            >
              <div
                style={{
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#9ca3af",
                  marginBottom: "0.75rem",
                }}
              >
                Language
              </div>
              <div style={{ position: "relative", marginBottom: "0.5rem" }}>
                <select
                  value={selectedLanguage || ""}
                  onChange={(e) =>
                    setSelectedLanguage(e.target.value as LanguageCode)
                  }
                  disabled={isUpdating || isLoading}
                  style={{
                    width: "100%",
                    padding: "0.875rem 2.5rem 0.875rem 1rem",
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    backgroundColor: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.625rem",
                    color: "#111827",
                    cursor: isUpdating || isLoading ? "not-allowed" : "pointer",
                    opacity: isUpdating || isLoading ? 0.5 : 1,
                    appearance: "none",
                    WebkitAppearance: "none",
                    MozAppearance: "none",
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "right 1rem center",
                    transition: "all 0.2s ease",
                    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
                  }}
                  onFocus={(e) => {
                    if (!isUpdating && !isLoading) {
                      e.currentTarget.style.borderColor = "#6366f1";
                      e.currentTarget.style.boxShadow =
                        "0 0 0 3px rgba(99, 102, 241, 0.1), 0 1px 2px rgba(0, 0, 0, 0.05)";
                    }
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "#e5e7eb";
                    e.currentTarget.style.boxShadow = "0 1px 2px rgba(0, 0, 0, 0.05)";
                  }}
                  onMouseEnter={(e) => {
                    if (!isUpdating && !isLoading) {
                      e.currentTarget.style.borderColor = "#d1d5db";
                      e.currentTarget.style.boxShadow =
                        "0 2px 4px rgba(0, 0, 0, 0.08)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (document.activeElement !== e.currentTarget) {
                      e.currentTarget.style.borderColor = "#e5e7eb";
                      e.currentTarget.style.boxShadow = "0 1px 2px rgba(0, 0, 0, 0.05)";
                    }
                  }}
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.value} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "#9ca3af",
                }}
              >
                {selectedLanguage === "auto"
                  ? "Automatically detected from your audio input."
                  : selectedLanguage
                    ? `Transcription will be limited to ${SUPPORTED_LANGUAGES.find((l) => l.value === selectedLanguage)?.label || selectedLanguage}`
                    : "No language selected"}
              </div>
            </div>

            <div
              style={{
                padding: "1.5rem",
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "0.75rem",
                marginBottom: "1rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: "0.9375rem",
                      color: "#111827",
                      marginBottom: "0.25rem",
                      fontWeight: 500,
                    }}
                  >
                    Enhance Transcription
                  </div>
                  <div
                    style={{
                      fontSize: "0.8125rem",
                      color: "#6b7280",
                    }}
                  >
                    Use AI to improve accuracy and formatting.
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

            <div style={{ marginTop: "1.5rem" }}>
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
                  padding: "0.5rem 1.5rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  background: "#111827",
                  color: "#ffffff",
                  border: "1px solid #111827",
                  borderRadius: "0.5rem",
                  opacity: isUpdating || !hasChanges() || isLoading ? 0.5 : 1,
                  cursor:
                    isUpdating || !hasChanges() || isLoading
                      ? "not-allowed"
                      : "pointer",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  if (!isUpdating && hasChanges() && !isLoading) {
                    e.currentTarget.style.background = "#374151";
                    e.currentTarget.style.borderColor = "#374151";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isUpdating && hasChanges() && !isLoading) {
                    e.currentTarget.style.background = "#111827";
                    e.currentTarget.style.borderColor = "#111827";
                  }
                }}
              >
                {isUpdating ? "Saving..." : "Save Settings"}
              </button>

              {error && (
                <div
                  className="permission-message"
                  style={{
                    background: "#fef2f2",
                    borderColor: "#fecaca",
                    color: "#b91c1c",
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
                    background: "#ecfdf5",
                    borderColor: "#a7f3d0",
                    color: "#047857",
                    fontSize: "11px",
                    padding: "8px",
                    marginTop: "12px",
                  }}
                >
                  Settings saved successfully!
                </div>
              )}
            </div>
          </div>
        )}

        {/* General Section */}
        {activeSection === "general" && (
          <div>
            <h2
              style={{
                margin: 0,
                marginBottom: "0.5rem",
                fontSize: "1.75rem",
                fontWeight: 600,
                color: "#111827",
                letterSpacing: "-0.025em",
              }}
            >
              General
            </h2>
            <p
              style={{
                margin: 0,
                marginBottom: "2rem",
                fontSize: "0.9375rem",
                color: "#6b7280",
              }}
            >
              Manage app behavior and performance.
            </p>

            <div
              style={{
                padding: "1.5rem",
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "0.75rem",
                marginBottom: "1rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: "0.9375rem",
                      color: "#111827",
                      marginBottom: "0.25rem",
                      fontWeight: 500,
                    }}
                  >
                    Start on System Startup
                  </div>
                  <div
                    style={{
                      fontSize: "0.8125rem",
                      color: "#6b7280",
                    }}
                  >
                    Automatically launch when your computer starts.
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
        )}

        {/* Hotkeys Section */}
        {activeSection === "hotkeys" && (
          <div>
            <h2
              style={{
                margin: 0,
                marginBottom: "0.5rem",
                fontSize: "1.75rem",
                fontWeight: 600,
                color: "#111827",
                letterSpacing: "-0.025em",
              }}
            >
              Hotkey Settings
            </h2>
            <p
              style={{
                margin: 0,
                marginBottom: "2rem",
                fontSize: "0.9375rem",
                color: "#6b7280",
              }}
            >
              Configure global triggers to activate the app.
            </p>

            <div
              style={{
                padding: "1.5rem",
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "0.75rem",
                marginBottom: "1.5rem",
              }}
            >
              <div
                style={{
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  color: "#111827",
                  marginBottom: "0.75rem",
                }}
              >
                Global Shortcut
              </div>
              <p
                style={{
                  fontSize: "0.8125rem",
                  color: "#6b7280",
                  margin: "0 0 1rem 0",
                }}
              >
                Press keys to start/stop recording.
              </p>
              {currentHotkeys.hotkeys.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                  }}
                >
                  {currentHotkeys.hotkeys.map((hotkey, index) => (
                    <div
                      key={index}
                      style={{
                        padding: "0.5rem 1rem",
                        background: "#f9fafb",
                        border: "1px solid #e5e7eb",
                        borderRadius: "0.5rem",
                        fontSize: "0.8125rem",
                        fontFamily:
                          'SF Mono, Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
                        color: "#111827",
                      }}
                    >
                      {hotkey}
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    padding: "0.5rem 1rem",
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.5rem",
                    fontSize: "0.8125rem",
                    color: "#9ca3af",
                    display: "inline-block",
                  }}
                >
                  No hotkeys configured
                </div>
              )}
            </div>

            <div
              style={{
                padding: "1.5rem",
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "0.75rem",
                marginBottom: "1.5rem",
              }}
            >
              <div
                style={{
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  color: "#111827",
                  marginBottom: "0.75rem",
                }}
              >
                Configure Hotkeys
              </div>
              <HotkeySelector
                value={selectedHotkeys}
                onChange={handleHotkeySelectorChange}
                maxHotkeys={3}
                disabled={isUpdatingHotkeys}
              />
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "#9ca3af",
                  marginTop: "0.75rem",
                }}
              >
                Note: Fn key is handled separately and works on Mac. Other
                hotkeys use Tauri global shortcuts.
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                marginTop: "1rem",
              }}
            >
              <button
                className="transcript-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!isUpdatingHotkeys && hasHotkeyChanges() && !isLoading) {
                    handleSaveHotkeys();
                  }
                }}
                disabled={isUpdatingHotkeys || !hasHotkeyChanges() || isLoading}
                style={{
                  padding: "0.5rem 1.5rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  background: "#111827",
                  color: "#ffffff",
                  border: "1px solid #111827",
                  borderRadius: "0.5rem",
                  opacity:
                    isUpdatingHotkeys || !hasHotkeyChanges() || isLoading
                      ? 0.5
                      : 1,
                  cursor:
                    isUpdatingHotkeys || !hasHotkeyChanges() || isLoading
                      ? "not-allowed"
                      : "pointer",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  if (
                    !isUpdatingHotkeys &&
                    hasHotkeyChanges() &&
                    !isLoading
                  ) {
                    e.currentTarget.style.background = "#374151";
                    e.currentTarget.style.borderColor = "#374151";
                  }
                }}
                onMouseLeave={(e) => {
                  if (
                    !isUpdatingHotkeys &&
                    hasHotkeyChanges() &&
                    !isLoading
                  ) {
                    e.currentTarget.style.background = "#111827";
                    e.currentTarget.style.borderColor = "#111827";
                  }
                }}
              >
                {isUpdatingHotkeys ? "Saving..." : "Update Hotkey"}
              </button>
              <button
                className="transcript-btn"
                onClick={() => {
                  // Reset to default hotkeys
                  const defaultHotkeys: HotkeyConfig = { hotkeys: ["Fn"] };
                  setSelectedHotkeys(defaultHotkeys);
                }}
                style={{
                  padding: "0.5rem 1.5rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  background: "#ffffff",
                  color: "#6b7280",
                  border: "1px solid #e5e7eb",
                  borderRadius: "0.5rem",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#f9fafb";
                  e.currentTarget.style.borderColor = "#d1d5db";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#ffffff";
                  e.currentTarget.style.borderColor = "#e5e7eb";
                }}
              >
                Reset Default
              </button>
            </div>

        {hotkeyError && (
          <div
            className="permission-message"
            style={{
              background: "#fef2f2",
              borderColor: "#fecaca",
              color: "#b91c1c",
              fontSize: "11px",
              padding: "8px",
              marginBottom: "12px",
            }}
          >
            {hotkeyError}
          </div>
        )}

        {hotkeySuccess && (
          <div
            className="permission-message"
            style={{
              background: "#ecfdf5",
              borderColor: "#a7f3d0",
              color: "#047857",
              fontSize: "11px",
              padding: "8px",
              marginBottom: "12px",
            }}
          >
            Hotkeys saved successfully!
          </div>
        )}
          </div>
        )}
      </div>
    </div>
  );
};
