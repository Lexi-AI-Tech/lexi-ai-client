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
import { useToast } from "./toast/useToast";
import { PageLoader } from "./ui/PageLoader";

// Supported languages for transcription
const SUPPORTED_LANGUAGES = getAllLanguageCodes().map((code) => ({
  value: code,
  label: getLanguageName(code),
}));

export const SettingsPage: React.FC = () => {
  const authStore = useAuthStore();
  const toast = useToast();
  const [config, setConfig] = useState<TauriAppConfig | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode | null>(
    null,
  );
  const [selectedAutostart, setSelectedAutostart] = useState<boolean | null>(
    null,
  );
  const [selectedEnhanceTranscription, setSelectedEnhanceTranscription] =
    useState<boolean | null>(null);
  const [selectedShowIcon, setSelectedShowIcon] = useState<boolean | null>(
    null,
  );
  const [isUpdating, setIsUpdating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  // Hotkey state
  const [currentHotkeys, setCurrentHotkeys] = useState<HotkeyConfig>({
    hotkeys: [],
  });
  const [currentActionHotkeys, setCurrentActionHotkeys] =
    useState<HotkeyConfig>({
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
  const showIconEnabled = config?.show_icon;

  const configHotkeys = config?.hotkeys || [];
  const configActionHotkeys = config?.action_hotkeys || [];

  // Load app config on mount
  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);

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
        setSelectedShowIcon(loadedConfig.show_icon ?? null);
      } catch (err: any) {
        console.error("Failed to load app config:", err);
        toast.error(err?.message || "Failed to load configuration");
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
    try {
      const updatedConfig = await invoke<TauriAppConfig>("update_app_config", {
        config: updates,
      });
      setConfig(updatedConfig);
      return updatedConfig;
    } catch (err: any) {
      console.error("Failed to update config:", err);
      toast.error(err?.message || "Failed to update setting");
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

    const currentShowIcon = showIconEnabled ?? true;
    const showIconChanged =
      selectedShowIcon !== null &&
      selectedShowIcon !== undefined &&
      selectedShowIcon !== currentShowIcon;

    const hotkeysChanged =
      JSON.stringify(currentHotkeys.hotkeys) !== JSON.stringify(configHotkeys);

    const actionHotkeysChanged =
      JSON.stringify(currentActionHotkeys.hotkeys) !==
      JSON.stringify(configActionHotkeys);

    if (
      !languageChanged &&
      !autostartChanged &&
      !enhanceChanged &&
      !showIconChanged &&
      !hotkeysChanged &&
      !actionHotkeysChanged
    ) {
      return; // No changes needed
    }

    setIsUpdating(true);

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
      if (showIconChanged && selectedShowIcon !== null) {
        updates.show_icon = selectedShowIcon;
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
      if (showIconChanged && updatedConfig.show_icon !== undefined) {
        setSelectedShowIcon(updatedConfig.show_icon);
      }

      if (updatedConfig.hotkeys) {
        setCurrentHotkeys({ hotkeys: updatedConfig.hotkeys });
      }
      if (updatedConfig.action_hotkeys) {
        setCurrentActionHotkeys({ hotkeys: updatedConfig.action_hotkeys });
      }

      toast.success("Settings saved");
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

    const currentShowIcon = showIconEnabled ?? true;
    const showIconChanged =
      selectedShowIcon !== null &&
      selectedShowIcon !== undefined &&
      selectedShowIcon !== currentShowIcon;

    const hotkeysChanged =
      JSON.stringify(currentHotkeys.hotkeys) !== JSON.stringify(configHotkeys);

    const actionHotkeysChanged =
      JSON.stringify(currentActionHotkeys.hotkeys) !==
      JSON.stringify(configActionHotkeys);

    return (
      languageChanged ||
      autostartChanged ||
      enhanceChanged ||
      showIconChanged ||
      hotkeysChanged ||
      actionHotkeysChanged
    );
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

  const handleToggleShowIcon = () => {
    const currentValue = selectedShowIcon ?? showIconEnabled ?? true;
    setSelectedShowIcon(!currentValue);
  };

  const ToggleSwitch: React.FC<{
    enabled: boolean;
    onToggle: () => void;
    disabled?: boolean;
  }> = ({ enabled, onToggle, disabled = false }) => (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`toggle-switch ${enabled ? "on" : ""}`}
    >
      <div className="toggle-switch__thumb">
        {enabled && <div className="toggle-switch__dot" />}
      </div>
    </button>
  );

  // Don't render settings content until config is loaded to prevent flash of defaults
  if (isLoading) {
    return (
      <div className="page">
        <h2 className="page__title">Settings</h2>
        <PageLoader className="page__empty" />
      </div>
    );
  }

  if (!authStore.isAuthenticated) {
    return (
      <div className="page">
        <h2 className="page__title">Settings</h2>
        <div className="panel panel--center">
          <p className="panel__message">Sign in to access your settings</p>
          <GoogleLoginButton onSuccess={() => { }} onError={() => { }} />
        </div>
      </div>
    );
  }

  if (config === null) {
    return (
      <div className="page">
        <h2 className="page__title">Settings</h2>
      </div>
    );
  }

  return (
    <div className="page">
      <h2 className="page__title">Settings</h2>

      <div className="section-tabs">
        {[
          { id: "account" as const, label: "Account", icon: Monitor },
          { id: "transcription" as const, label: "Transcription", icon: Mic },
          { id: "general" as const, label: "General", icon: Power },
          { id: "hotkeys" as const, label: "Hotkeys", icon: Keyboard },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveSection(id)}
            className={`section-tab ${activeSection === id ? "active" : ""}`}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div>
        {activeSection === "account" && (
          <div>
            <div className="panel panel--lg">
              <div className="panel__label panel__label--spaced">Account</div>
              <GoogleLoginButton />
            </div>
          </div>
        )}

        {activeSection === "transcription" && (
          <div>
            <div className="panel panel--lg mb-16">
              <div className="panel__label panel__label--spaced">Language</div>
              <div ref={languageDropdownRef} className="rel mb-12">
                <button
                  type="button"
                  onClick={() =>
                    !isUpdating &&
                    !isLoading &&
                    setIsLanguageDropdownOpen(!isLanguageDropdownOpen)
                  }
                  disabled={isUpdating || isLoading}
                  className="select-trigger"
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
                    className={`dropdown-chevron ${isLanguageDropdownOpen ? "open" : ""}`}
                  />
                </button>
                {isLanguageDropdownOpen && (
                  <div className="select-dropdown">
                    <div className="select-dropdown__list">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedLanguage(null);
                          setIsLanguageDropdownOpen(false);
                        }}
                        className="select-option"
                      >
                        <span>Auto Detect Language</span>
                        {!selectedLanguage && (
                          <Check size={16} className="check flex-shrink-0" />
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
                          className="select-option"
                        >
                          <span>{lang.label}</span>
                          {selectedLanguage === lang.value && (
                            <Check size={16} className="check flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="settings-hint">
                {selectedLanguage === "auto"
                  ? "Automatically detected from your audio input."
                  : selectedLanguage
                    ? `Transcription will be limited to ${SUPPORTED_LANGUAGES.find((l) => l.value === selectedLanguage)?.label || selectedLanguage}`
                    : "No language selected"}
              </div>
            </div>

            <div className="panel panel--lg mb-24">
              <div className="settings-row">
                <div className="settings-row__content">
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
          </div>
        )}

        {activeSection === "general" && (
          <div>
            <div className="panel panel--lg mb-16">
              <div className="settings-row">
                <div className="settings-row__content">
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
            {navigator.userAgent.toLowerCase().includes("mac") && (
              <div className="panel panel--lg mb-24">
                <div className="settings-row">
                  <div className="settings-row__content">
                    <div className="settings-row__title">
                      Show App Icon in Dock
                    </div>
                    <div className="settings-row__desc">
                      Display Lexi in the macOS Dock.
                    </div>
                  </div>
                  <ToggleSwitch
                    enabled={
                      (selectedShowIcon ?? showIconEnabled ?? true) === true
                    }
                    onToggle={handleToggleShowIcon}
                    disabled={isLoading || isUpdating}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {activeSection === "hotkeys" && (
          <div>
            <div className="panel panel--lg mb-24">
              <div className="mb-32">
                <HotkeySelector
                  label="Transcription Hotkeys"
                  description={`Hold ${currentHotkeys.hotkeys.length > 0 && !currentHotkeys.hotkeys[0].includes("+") ? "this key" : "this hotkey combination"} to record audio for transcription`}
                  value={currentHotkeys}
                  onChange={setCurrentHotkeys}
                  maxHotkeys={3}
                  disabled={isLoading || isUpdating}
                />
              </div>
              <div className="mb-24">
                <HotkeySelector
                  label="Action Hotkeys"
                  description={`Hold ${currentActionHotkeys.hotkeys.length > 0 && !currentActionHotkeys.hotkeys[0].includes("+") ? "this key" : "this hotkey combination"} to record a voice command for actions`}
                  value={currentActionHotkeys}
                  onChange={setCurrentActionHotkeys}
                  maxHotkeys={3}
                  disabled={isLoading || isUpdating}
                />
              </div>
            </div>
          </div>
        )}

        <div className="settings-save-bar">
          <button
            type="button"
            onClick={handleSaveSettings}
            disabled={isUpdating || !hasChanges()}
            className="btn-save"
          >
            {isUpdating ? (
              <>
                <div className="spinner-small" />
                Saving...
              </>
            ) : (
              "Save Settings"
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
