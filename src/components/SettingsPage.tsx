import React, { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Monitor,
  Mic,
  Power,
  Keyboard,
  ChevronDown,
  Check,
} from "lucide-react";

import {
  LanguageCode,
  getAllLanguageCodes,
  getLanguageName,
} from "../lib/constants";
import type { TauriAppConfig, HotkeyConfig } from "../types";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";
import { useAuthStore } from "../store/authStore";
import { HotkeySelector } from "./HotkeySelector";

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
  const [currentActionHotkeys, setCurrentActionHotkeys] = useState<HotkeyConfig>({
    hotkeys: [],
  });
  const [activeSection, setActiveSection] = useState<
    "account" | "transcription" | "general" | "hotkeys"
  >("account");
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const languageDropdownRef = useRef<HTMLDivElement>(null);

  // Derived values from config - no defaults, rely entirely on backend
  const currentLanguage = config?.languages?.[0] as LanguageCode | undefined;
  const autostartEnabled = config?.launch_on_system_startup;
  const enhanceTranscription = config?.enhance_transcription;

  const configHotkeys = config?.hotkeys || [];
  const configActionHotkeys = config?.action_hotkeys || [];

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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        languageDropdownRef.current &&
        !languageDropdownRef.current.contains(event.target as Node)
      ) {
        setIsLanguageDropdownOpen(false);
      }
    };

    if (isLanguageDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isLanguageDropdownOpen]);

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
      } catch (hotkeyErr) {
        console.warn("Failed to load hotkeys:", hotkeyErr);
        // If hotkeys are in config, use those
        if (configHotkeys.length > 0) {
          const hotkey: HotkeyConfig = {
            hotkeys: configHotkeys.slice(0, 3),
          };
          setCurrentHotkeys(hotkey);
        }
      }

      // Load action hotkeys from config
      if (configActionHotkeys.length > 0) {
        setCurrentActionHotkeys({
          hotkeys: configActionHotkeys.slice(0, 3),
        });
      }
    };

    if (config) {
      loadHotkeys();
    }
  }, [config, configHotkeys, configActionHotkeys]);

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

    const hotkeysChanged =
      JSON.stringify(currentHotkeys.hotkeys) !== JSON.stringify(configHotkeys);

    const actionHotkeysChanged =
      JSON.stringify(currentActionHotkeys.hotkeys) !== JSON.stringify(configActionHotkeys);

    if (!languageChanged && !autostartChanged && !enhanceChanged && !hotkeysChanged && !actionHotkeysChanged) {
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
      if (hotkeysChanged) {
        updates.hotkeys = currentHotkeys.hotkeys;
      }
      if (actionHotkeysChanged) {
        updates.action_hotkeys = currentActionHotkeys.hotkeys;
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

      if (updatedConfig.hotkeys) {
        setCurrentHotkeys({ hotkeys: updatedConfig.hotkeys });
      }
      if (updatedConfig.action_hotkeys) {
        setCurrentActionHotkeys({ hotkeys: updatedConfig.action_hotkeys });
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      // Revert hotkeys to the last known good state from the original config
      if (hotkeysChanged) {
        setCurrentHotkeys({ hotkeys: configHotkeys.slice(0, 3) });
      }
      if (actionHotkeysChanged) {
        setCurrentActionHotkeys({ hotkeys: configActionHotkeys.slice(0, 3) });
      }
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

    // Compare autostart
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

    const hotkeysChanged =
      JSON.stringify(currentHotkeys.hotkeys) !== JSON.stringify(configHotkeys);

    const actionHotkeysChanged =
      JSON.stringify(currentActionHotkeys.hotkeys) !== JSON.stringify(configActionHotkeys);

    return languageChanged || autostartChanged || enhanceChanged || hotkeysChanged || actionHotkeysChanged;
  };

  // Removed auto-save useEffect in favor of manual Save Settings button

  const handleToggleAutostart = () => {
    const currentValue = selectedAutostart ?? autostartEnabled ?? false;
    setSelectedAutostart(!currentValue);
  };

  const handleToggleEnhanceTranscription = () => {
    const currentValue =
      selectedEnhanceTranscription ?? enhanceTranscription ?? false;
    setSelectedEnhanceTranscription(!currentValue);
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
      <div style={{ padding: "40px", maxWidth: "800px", margin: "0 auto" }}>
        <div style={{ textAlign: "center", padding: "40px", color: "#666" }}>
          Loading settings...
        </div>
      </div>
    );
  }

  // Show login prompt if not authenticated
  // This prevents showing cached config when user is logged out
  if (!authStore.isAuthenticated) {
    return (
      <div style={{ padding: "40px", maxWidth: "800px", margin: "0 auto" }}>
        <h2
          style={{
            fontSize: "18px",
            fontWeight: 500,
            color: "#111827",
            marginBottom: "16px",
            marginTop: 0,
          }}
        >
          Settings
        </h2>
        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            padding: "40px",
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: "14px",
              color: "#6b7280",
              marginBottom: "20px",
            }}
          >
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
    );
  }

  // Show error state if config failed to load
  if (config === null) {
    return (
      <div style={{ padding: "40px", maxWidth: "800px", margin: "0 auto" }}>
        <h2
          style={{
            fontSize: "18px",
            fontWeight: 500,
            color: "#111827",
            marginBottom: "16px",
            marginTop: 0,
          }}
        >
          Settings
        </h2>
        {error && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#b91c1c",
              fontSize: "13px",
              padding: "12px 16px",
              marginBottom: "24px",
              borderRadius: "8px",
            }}
          >
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: "40px", maxWidth: "800px", margin: "0 auto" }}>
      <h2
        style={{
          fontSize: "18px",
          fontWeight: 500,
          color: "#111827",
          marginBottom: "24px",
          marginTop: 0,
        }}
      >
        Settings
      </h2>

      {/* Section Navigation */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "32px",
          flexWrap: "wrap",
        }}
      >
        {[
          { id: "account" as const, label: "Account", icon: Monitor },
          { id: "transcription" as const, label: "Transcription", icon: Mic },
          { id: "general" as const, label: "General", icon: Power },
          {
            id: "hotkeys" as const,
            label: "Hotkeys",
            icon: Keyboard,
          },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              background: activeSection === id ? "#111827" : "#f3f4f6",
              color: activeSection === id ? "#ffffff" : "#6b7280",
              cursor: "pointer",
              transition: "all 0.2s ease",
              fontSize: "14px",
              fontWeight: activeSection === id ? 500 : 400,
            }}
            onMouseEnter={(e) => {
              if (activeSection !== id) {
                e.currentTarget.style.background = "#e5e7eb";
                e.currentTarget.style.color = "#111827";
              }
            }}
            onMouseLeave={(e) => {
              if (activeSection !== id) {
                e.currentTarget.style.background = "#f3f4f6";
                e.currentTarget.style.color = "#6b7280";
              }
            }}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div>
        {/* Account Section */}
        {activeSection === "account" && (
          <div>
            <div
              style={{
                backgroundColor: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "24px",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#9ca3af",
                  marginBottom: "16px",
                }}
              >
                Account
              </div>
              <GoogleLoginButton />
            </div>
          </div>
        )}

        {/* Transcription Section */}
        {activeSection === "transcription" && (
          <div>
            <div
              style={{
                backgroundColor: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "24px",
                marginBottom: "16px",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#9ca3af",
                  marginBottom: "12px",
                }}
              >
                Language
              </div>
              <div
                ref={languageDropdownRef}
                style={{ position: "relative", marginBottom: "12px" }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!isUpdating && !isLoading) {
                      setIsLanguageDropdownOpen(!isLanguageDropdownOpen);
                    }
                  }}
                  disabled={isUpdating || isLoading}
                  style={{
                    width: "100%",
                    padding: "12px 16px",
                    fontSize: "14px",
                    fontFamily: "inherit",
                    backgroundColor: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    color: "#111827",
                    cursor: isUpdating || isLoading ? "not-allowed" : "pointer",
                    opacity: isUpdating || isLoading ? 0.5 : 1,
                    transition: "all 0.2s ease",
                    outline: "none",
                    fontWeight: 500,
                    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                  onMouseEnter={(e) => {
                    if (!isUpdating && !isLoading) {
                      e.currentTarget.style.borderColor = "#d1d5db";
                      e.currentTarget.style.boxShadow =
                        "0 2px 4px rgba(0, 0, 0, 0.08)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isLanguageDropdownOpen) {
                      e.currentTarget.style.borderColor = "#e5e7eb";
                      e.currentTarget.style.boxShadow =
                        "0 1px 2px rgba(0, 0, 0, 0.05)";
                    }
                  }}
                >
                  <span>
                    {selectedLanguage
                      ? SUPPORTED_LANGUAGES.find(
                        (l) => l.value === selectedLanguage,
                      )?.label || "Select language"
                      : "Auto Detect Language"}
                  </span>
                  <ChevronDown
                    size={18}
                    style={{
                      color: "#6b7280",
                      transform: isLanguageDropdownOpen
                        ? "rotate(180deg)"
                        : "rotate(0deg)",
                      transition: "transform 0.2s ease",
                    }}
                  />
                </button>

                {isLanguageDropdownOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      marginTop: "4px",
                      backgroundColor: "#ffffff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                      zIndex: 1000,
                      maxHeight: "300px",
                      overflowY: "auto",
                      overflowX: "hidden",
                    }}
                  >
                    <div
                      style={{
                        padding: "8px 0",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedLanguage(null);
                          setIsLanguageDropdownOpen(false);
                        }}
                        style={{
                          width: "100%",
                          padding: "10px 16px",
                          backgroundColor: "transparent",
                          border: "none",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          fontSize: "14px",
                          color: "#111827",
                          transition: "background-color 0.15s ease",
                          textAlign: "left",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = "#f3f4f6";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = "transparent";
                        }}
                      >
                        <span>Auto Detect Language</span>
                        {!selectedLanguage && (
                          <Check
                            size={16}
                            style={{ color: "#111827", flexShrink: 0 }}
                          />
                        )}
                      </button>
                      {SUPPORTED_LANGUAGES.filter(
                        (lang) => lang.value !== "auto",
                      ).map((lang) => (
                        <button
                          key={lang.value}
                          type="button"
                          onClick={() => {
                            setSelectedLanguage(lang.value as LanguageCode);
                            setIsLanguageDropdownOpen(false);
                          }}
                          style={{
                            width: "100%",
                            padding: "10px 16px",
                            backgroundColor: "transparent",
                            border: "none",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            fontSize: "14px",
                            color: "#111827",
                            transition: "background-color 0.15s ease",
                            textAlign: "left",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = "#f3f4f6";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor =
                              "transparent";
                          }}
                        >
                          <span>{lang.label}</span>
                          {selectedLanguage === lang.value && (
                            <Check
                              size={16}
                              style={{ color: "#111827", flexShrink: 0 }}
                            />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div
                style={{
                  fontSize: "12px",
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
                backgroundColor: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "24px",
                marginBottom: "24px",
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
                      fontSize: "15px",
                      color: "#111827",
                      marginBottom: "4px",
                      fontWeight: 500,
                    }}
                  >
                    Enhance Transcription
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
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



            {error && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#b91c1c",
                  fontSize: "13px",
                  padding: "12px 16px",
                  marginTop: "16px",
                  borderRadius: "8px",
                }}
              >
                {error}
              </div>
            )}

            {success && (
              <div
                style={{
                  background: "#ecfdf5",
                  border: "1px solid #a7f3d0",
                  color: "#047857",
                  fontSize: "13px",
                  padding: "12px 16px",
                  marginTop: "16px",
                  borderRadius: "8px",
                }}
              >
                Settings saved successfully!
              </div>
            )}
          </div>
        )}

        {/* General Section */}
        {activeSection === "general" && (
          <div>
            <div
              style={{
                backgroundColor: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "24px",
                marginBottom: "24px",
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
                      fontSize: "15px",
                      color: "#111827",
                      marginBottom: "4px",
                      fontWeight: 500,
                    }}
                  >
                    Start on System Startup
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
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


            <div
              style={{
                backgroundColor: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                padding: "24px",
                marginBottom: "24px",
              }}
            >
              <div style={{ marginBottom: "32px" }}>
                <HotkeySelector
                  label="Transcription Hotkeys"
                  description="Hold to record audio for transcription"
                  value={currentHotkeys}
                  onChange={setCurrentHotkeys}
                  maxHotkeys={3}
                  disabled={isLoading || isUpdating}
                />
              </div>

              <div style={{ marginBottom: "24px" }}>
                <HotkeySelector
                  label="Action Hotkeys"
                  description="Hold to record a voice command for actions"
                  value={currentActionHotkeys}
                  onChange={setCurrentActionHotkeys}
                  maxHotkeys={3}
                  disabled={isLoading || isUpdating}
                />
              </div>



              {error && (
                <div
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    color: "#b91c1c",
                    fontSize: "13px",
                    padding: "12px 16px",
                    marginTop: "16px",
                    borderRadius: "8px",
                  }}
                >
                  {error}
                </div>
              )}

              {success && (
                <div
                  style={{
                    background: "#ecfdf5",
                    border: "1px solid #a7f3d0",
                    color: "#047857",
                    fontSize: "13px",
                    padding: "12px 16px",
                    marginTop: "16px",
                    borderRadius: "8px",
                  }}
                >
                  Settings saved successfully!
                </div>
              )}
            </div>
          </div>
        )}

        {/* Global Save Button Area */}
        {hasChanges() && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: "32px",
              borderTop: "1px solid #e5e7eb",
              paddingTop: "24px",
            }}
          >
            <button
              onClick={handleSaveSettings}
              disabled={isUpdating}
              style={{
                backgroundColor: isUpdating ? "#9ca3af" : "#000000",
                color: "#ffffff",
                padding: "10px 24px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: 500,
                border: "none",
                cursor: isUpdating ? "not-allowed" : "pointer",
                transition: "all 0.2s ease",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {isUpdating ? (
                <>
                  <div className="spinner-small" style={{ width: "16px", height: "16px", border: "2px solid #ffffff", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                  Saving...
                </>
              ) : (
                "Save Settings"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
