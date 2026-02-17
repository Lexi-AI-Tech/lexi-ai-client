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
import { HotkeySelector } from "./HotkeySelector";
import { useAuthStore } from "../store/authStore";
import "../styles/pages/shared.css";
import "../styles/pages/settings.css";
import "../styles/components/hotkey-selector.css";

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
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [hotkeySectionKey, setHotkeySectionKey] = useState(0);
  const [activeSection, setActiveSection] = useState<
    "account" | "transcription" | "general" | "hotkeys"
  >("account");
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const languageDropdownRef = useRef<HTMLDivElement>(null);

  // Derived values from config - no defaults, rely entirely on backend
  const autostartEnabled = config?.launch_on_system_startup;
  const enhanceTranscription = config?.enhance_transcription;

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

  const handleToggleAutostart = async () => {
    const currentValue = selectedAutostart ?? autostartEnabled ?? false;
    const newValue = !currentValue;
    setSelectedAutostart(newValue);
    setIsUpdating(true);
    setError(null);
    setSuccess(false);
    try {
      await updateConfig({ launch_on_system_startup: newValue });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch {
      setSelectedAutostart(currentValue);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggleEnhanceTranscription = async () => {
    const currentValue =
      selectedEnhanceTranscription ?? enhanceTranscription ?? false;
    const newValue = !currentValue;
    setSelectedEnhanceTranscription(newValue);
    setIsUpdating(true);
    setError(null);
    setSuccess(false);
    try {
      await updateConfig({ enhance_transcription: newValue });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch {
      setSelectedEnhanceTranscription(currentValue);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleLanguageSelect = async (newLanguage: LanguageCode | null) => {
    const valueToSave = newLanguage ?? LanguageCode.AUTO;
    const previousLanguage = selectedLanguage;
    setSelectedLanguage(newLanguage);
    setIsLanguageDropdownOpen(false);
    setIsUpdating(true);
    setError(null);
    setSuccess(false);
    try {
      await updateConfig({ languages: [valueToSave] });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch {
      setSelectedLanguage(previousLanguage);
    } finally {
      setIsUpdating(false);
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
      className={`toggle-switch${enabled ? " toggle-switch--on" : ""}`}
    >
      <div className="toggle-switch__knob">
        {enabled && <div className="toggle-switch__dot" />}
      </div>
    </button>
  );

  // Don't render settings content until config is loaded to prevent flash of defaults
  if (isLoading) {
    return (
      <div className="page-layout">
        <h2 className="page-layout__title">Settings</h2>
        <div className="settings-loading">Loading settings...</div>
      </div>
    );
  }

  // Show login prompt if not authenticated
  // This prevents showing cached config when user is logged out
  if (!authStore.isAuthenticated) {
    return (
      <div className="page-layout">
        <h2 className="page-layout__title">Settings</h2>
        <div className="settings-auth-prompt">
          <p className="settings-auth-prompt__text">
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
      <div className="page-layout">
        <h2 className="page-layout__title">Settings</h2>
        {error && (
          <div className="settings-msg settings-msg--error">{error}</div>
        )}
      </div>
    );
  }

  return (
    <div className="page-layout">
      <h2 className="page-layout__title">Settings</h2>

      {/* Section Navigation */}
      <div className="settings-nav">
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
            className={`settings-nav__btn${activeSection === id ? " settings-nav__btn--active" : ""}`}
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
            <div className="settings-card">
              <div className="settings-label">Account</div>
              <GoogleLoginButton />
            </div>
          </div>
        )}

        {/* Transcription Section */}
        {activeSection === "transcription" && (
          <div>
            <div className="settings-card settings-card--mb">
              <div className="settings-label settings-label--sm">Language</div>
              <div ref={languageDropdownRef} className="lang-dropdown">
                <button
                  type="button"
                  onClick={() => {
                    if (!isUpdating && !isLoading) {
                      setIsLanguageDropdownOpen(!isLanguageDropdownOpen);
                    }
                  }}
                  disabled={isUpdating || isLoading}
                  className="lang-dropdown__trigger"
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
                    className={`lang-dropdown__chevron${isLanguageDropdownOpen ? " lang-dropdown__chevron--open" : ""}`}
                  />
                </button>

                {isLanguageDropdownOpen && (
                  <div className="lang-dropdown__menu">
                    <div className="lang-dropdown__list">
                      <button
                        type="button"
                        onClick={() => handleLanguageSelect(null)}
                        className="lang-dropdown__option"
                      >
                        <span>Auto Detect Language</span>
                        {!selectedLanguage && (
                          <Check size={16} className="lang-dropdown__check" />
                        )}
                      </button>
                      {SUPPORTED_LANGUAGES.filter(
                        (lang) => lang.value !== "auto",
                      ).map((lang) => (
                        <button
                          key={lang.value}
                          type="button"
                          onClick={() =>
                            handleLanguageSelect(lang.value as LanguageCode)
                          }
                          className="lang-dropdown__option"
                        >
                          <span>{lang.label}</span>
                          {selectedLanguage === lang.value && (
                            <Check size={16} className="lang-dropdown__check" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="settings-row__hint">
                {selectedLanguage === "auto"
                  ? "Automatically detected from your audio input."
                  : selectedLanguage
                    ? `Transcription will be limited to ${SUPPORTED_LANGUAGES.find((l) => l.value === selectedLanguage)?.label || selectedLanguage}`
                    : "No language selected"}
              </div>
            </div>

            <div className="settings-card settings-card--mb-lg">
              <div className="settings-row">
                <div className="settings-row__text">
                  <div className="settings-row__title">
                    Enhance Transcription
                  </div>
                  <div className="settings-row__desc">
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
              <div className="settings-msg settings-msg--error">{error}</div>
            )}

            {success && (
              <div className="settings-msg settings-msg--success">
                Settings saved successfully!
              </div>
            )}
          </div>
        )}

        {/* General Section */}
        {activeSection === "general" && (
          <div>
            <div className="settings-card settings-card--mb-lg">
              <div className="settings-row">
                <div className="settings-row__text">
                  <div className="settings-row__title">
                    Start on System Startup
                  </div>
                  <div className="settings-row__desc">
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

            {error && (
              <div className="settings-msg settings-msg--error">{error}</div>
            )}

            {success && (
              <div className="settings-msg settings-msg--success">
                Settings saved successfully!
              </div>
            )}
          </div>
        )}

        {/* Hotkeys Section */}
        {activeSection === "hotkeys" && (
          <div>
            {hotkeyError && (
              <div className="settings-msg--error-block">{hotkeyError}</div>
            )}
            <div className="settings-card settings-card--mb">
              {/* Hotkeys */}
              <HotkeySelector
                key={`hotkeys-${hotkeySectionKey}`}
                label="Transcription Hotkeys"
                description="Hold to record audio for transcription"
                value={currentHotkeys}
                onChange={async (newConfig) => {
                  setHotkeyError(null);
                  try {
                    await invoke("update_hotkey", {
                      configJson: JSON.stringify(newConfig),
                    });
                    setCurrentHotkeys(newConfig);
                  } catch (err: unknown) {
                    console.error("Failed to update transcription hotkeys:", err);
                    const message =
                      typeof err === "string"
                        ? err
                        : (err as Error)?.message ||
                        "Failed to update transcription hotkeys";
                    setHotkeyError(message);
                    try {
                      const fresh = await invoke<TauriAppConfig>("get_app_config");
                      setConfig(fresh);
                      if (fresh.hotkeys) setCurrentHotkeys({ hotkeys: fresh.hotkeys });
                      setHotkeySectionKey((k) => k + 1);
                    } catch (_) {
                      // ignore refetch failure
                    }
                  }
                }}
                onValidationError={setHotkeyError}
                maxHotkeys={3}
              />
            </div>

            <div className="settings-card settings-card--mb">
              {/* Action Hotkeys */}
              <HotkeySelector
                key={`action-hotkeys-${hotkeySectionKey}`}
                label="Action Hotkeys"
                description="Hold to record a voice command for actions"
                value={{ hotkeys: config?.action_hotkeys || [] }}
                onChange={async (newConfig) => {
                  setHotkeyError(null);
                  try {
                    await invoke("update_action_hotkey", {
                      configJson: JSON.stringify(newConfig),
                    });
                    setConfig((prev) =>
                      prev ? { ...prev, action_hotkeys: newConfig.hotkeys } : prev,
                    );
                  } catch (err: unknown) {
                    console.error("Failed to update action hotkeys:", err);
                    const message =
                      typeof err === "string"
                        ? err
                        : (err as Error)?.message ||
                        "Failed to update action hotkeys";
                    setHotkeyError(message);
                    try {
                      const fresh = await invoke<TauriAppConfig>("get_app_config");
                      setConfig(fresh);
                      setHotkeySectionKey((k) => k + 1);
                    } catch (_) {
                      // ignore refetch failure
                    }
                  }
                }}
                onValidationError={setHotkeyError}
                maxHotkeys={3}
              />
            </div>

            {/* Reset to Defaults */}
            <div className="settings-card">
              <div className="settings-row">
                <div>
                  <div className="settings-reset__title">Reset Hotkeys</div>
                  <div className="settings-reset__desc">
                    Restore default hotkeys (Fn for transcription, Fn+Control
                    for actions)
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      // Reset hotkeys to default
                      const defaultHotkeys = { hotkeys: ["Fn"] };
                      await invoke("update_hotkey", {
                        configJson: JSON.stringify(defaultHotkeys),
                      });
                      setCurrentHotkeys(defaultHotkeys);

                      // Reset action hotkeys to default
                      const defaultAction = { hotkeys: ["Fn+Control"] };
                      await invoke("update_action_hotkey", {
                        configJson: JSON.stringify(defaultAction),
                      });
                      setConfig((prev) =>
                        prev
                          ? { ...prev, action_hotkeys: defaultAction.hotkeys }
                          : prev,
                      );
                    } catch (err) {
                      console.error("Failed to reset hotkeys:", err);
                    }
                  }}
                  className="hotkey-selector__btn hotkey-selector__btn--primary"
                >
                  Reset to Defaults
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
