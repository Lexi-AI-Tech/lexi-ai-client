import React, { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Monitor,
  Mic,
  Power,
  Keyboard,
  Atom,
  Sparkles,
  ChevronDown,
  Check,
  RefreshCw,
  Settings as SettingsIcon,
} from "lucide-react";

import {
  LanguageCode,
  getAllLanguageCodes,
  getLanguageName,
} from "../lib/constants";
import type { TauriAppConfig, HotkeyConfig } from "../types";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";
import { useAuthStore } from "../store/authStore";
import { useUpdaterStore } from "../store/updaterStore";
import { HotkeySelector } from "./HotkeySelector";
import { useToast } from "./toast/useToast";
import { ScreenSkeleton } from "./ui/ScreenSkeleton";
import { check } from "@tauri-apps/plugin-updater";
import { checkUpdateDetails } from "../hooks/useAutoUpdater";
import { UpgradeModal } from "./UpgradeModal";

type CurrentSubscriptionResponse = {
  plan_type: string;
  subscription_status: string | null;
  cancel_at_period_end: boolean;
  next_billing_date: string | null;
};

const TERMS_URL = "https://www.speaklexi.com/terms";
const PRIVACY_URL = "https://www.speaklexi.com/privacy";

type DefaultHotkeysResponse = {
  hotkeys: string[];
  action_hotkeys: string[];
};

export type SettingsPageInitialSection =
  | "general"
  | "account"
  | "transcription"
  | "hotkeys";

export type SettingsPageProps = {
  initialSection?: SettingsPageInitialSection | null;
  onInitialSectionConsumed?: () => void;
};

// Supported languages for transcription
const SUPPORTED_LANGUAGES = getAllLanguageCodes().map((code) => ({
  value: code,
  label: getLanguageName(code),
}));

const LANGUAGE_FLAGS: Record<string, string> = {
  en: "🇺🇸",
  es: "🇪🇸",
  fr: "🇫🇷",
  de: "🇩🇪",
  it: "🇮🇹",
  pt: "🇵🇹",
  ru: "🇷🇺",
  ja: "🇯🇵",
  ko: "🇰🇷",
  zh: "🇨🇳",
  ar: "🇸🇦",
  hi: "🇮🇳",
  nl: "🇳🇱",
  pl: "🇵🇱",
  tr: "🇹🇷",
  sv: "🇸🇪",
  da: "🇩🇰",
  no: "🇳🇴",
  fi: "🇫🇮",
};

const getLanguageFlag = (code: string): string | null => {
  const c = (code || "").trim().toLowerCase();
  if (!c || c === "auto") return null;
  return LANGUAGE_FLAGS[c] ?? null;
};

const normalizeLanguage = (
  value: LanguageCode | null | undefined,
): LanguageCode => (value ?? LanguageCode.AUTO) as LanguageCode;

export const SettingsPage: React.FC<SettingsPageProps> = ({
  initialSection = null,
  onInitialSectionConsumed,
}) => {
  const authStore = useAuthStore();
  const toast = useToast();
  const [subscription, setSubscription] =
    useState<CurrentSubscriptionResponse | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [confirmCancelSub, setConfirmCancelSub] = useState(false);
  const [isCancelingSub, setIsCancelingSub] = useState(false);
  const [config, setConfig] = useState<TauriAppConfig | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode>(
    LanguageCode.AUTO,
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

  // Updater state
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string>("");
  // Hotkey state
  const [currentHotkeys, setCurrentHotkeys] = useState<HotkeyConfig>({
    hotkeys: [],
  });
  const [currentActionHotkeys, setCurrentActionHotkeys] =
    useState<HotkeyConfig>({
      hotkeys: [],
    });
  const [activeSection, setActiveSection] = useState<
    "general" | "account" | "transcription" | "hotkeys"
  >("general");
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const [dockOrTaskbarIconPlatform, setDockOrTaskbarIconPlatform] = useState<
    "mac" | "windows" | null
  >(null);

  useEffect(() => {
    if (!initialSection) return;
    setActiveSection(initialSection);
    onInitialSectionConsumed?.();
    // Intentionally only follow `initialSection` so a changing callback ref does not re-open tabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSection]);

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
            setSelectedLanguage(normalizeLanguage(firstLanguage));
          }
        } else {
          // Backend didn't provide a language, default to auto
          setSelectedLanguage(LanguageCode.AUTO);
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

  useEffect(() => {
    let cancelled = false;
    void invoke<string>("get_system_type")
      .then((t) => {
        if (cancelled) return;
        if (t === "mac" || t === "windows") {
          setDockOrTaskbarIconPlatform(t);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const isProPlan = (planType: string | undefined | null): boolean =>
    (planType ?? "").trim().toLowerCase() === "pro";

  const refreshSubscription = async () => {
    if (!authStore.isAuthenticated) return;
    try {
      setBillingLoading(true);
      const s = await invoke<CurrentSubscriptionResponse>(
        "get_current_subscription",
      );
      setSubscription(s);
    } catch (err) {
      setSubscription(null);
    } finally {
      setBillingLoading(false);
    }
  };

  // Fetch billing usage when Settings opens and when switching to Account tab.
  useEffect(() => {
    if (!authStore.isAuthenticated) return;
    if (activeSection !== "account") return;
    refreshSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, authStore.isAuthenticated]);

  const isProActive = (sub: CurrentSubscriptionResponse | null) => {
    if (!sub) return false;
    if (!isProPlan(sub.plan_type)) return false;
    if (sub.cancel_at_period_end) return false;
    // Some older users may not have dodo_subscription_status populated; treat as active.
    const s = (sub.subscription_status ?? "").trim().toLowerCase();
    return s === "" || s === "active";
  };

  const isFreePlan = (planType: string | undefined | null): boolean =>
    (planType ?? "").trim().toLowerCase() === "free";

  const handleCancelSubscription = async () => {
    try {
      setIsCancelingSub(true);
      await invoke("cancel_billing_subscription");
      toast.success(
        "Cancellation scheduled. You'll keep Pro until period end.",
      );
      await refreshSubscription();
      setConfirmCancelSub(false);
    } catch (err) {
      console.error("Failed to cancel subscription:", err);
      toast.error("Failed to cancel subscription");
    } finally {
      setIsCancelingSub(false);
    }
  };

  // If UpgradeModal completes an upgrade, it dispatches `lexi:plan-updated`.
  useEffect(() => {
    if (!authStore.isAuthenticated) return;
    const onPlanUpdated = () => {
      if (activeSection === "account") {
        refreshSubscription();
      }
    };
    window.addEventListener("lexi:plan-updated", onPlanUpdated);
    return () => {
      window.removeEventListener("lexi:plan-updated", onPlanUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, authStore.isAuthenticated]);

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
        } else {
          toast.error("Failed to load hotkeys");
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
      normalizeLanguage(selectedLanguage) !==
      normalizeLanguage(currentLanguage);

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

      if (languageChanged) {
        updates.languages = [normalizeLanguage(selectedLanguage)];
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
        setSelectedLanguage(
          normalizeLanguage(updatedConfig.languages[0] as LanguageCode),
        );
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

  const handleResetHotkeys = async () => {
    try {
      setIsUpdating(true);

      const defaults = await invoke<DefaultHotkeysResponse>(
        "get_default_hotkeys",
      );

      const updates: Partial<TauriAppConfig> = {
        hotkeys: defaults.hotkeys.slice(0, 3),
        action_hotkeys: defaults.action_hotkeys.slice(0, 3),
      };

      const updatedConfig = await updateConfig(updates);

      setCurrentHotkeys({
        hotkeys: (updatedConfig.hotkeys ?? defaults.hotkeys).slice(0, 3),
      });
      setCurrentActionHotkeys({
        hotkeys: (
          updatedConfig.action_hotkeys ?? defaults.action_hotkeys
        ).slice(0, 3),
      });

      toast.success("Hotkeys reset to defaults");
    } catch (err: any) {
      console.error("Failed to reset hotkeys:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  const hasChanges = () => {
    // Compare language
    const languageChanged =
      normalizeLanguage(selectedLanguage) !==
      normalizeLanguage(currentLanguage);

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

  const handleToggleEnhanceTranscription = () => {
    const currentValue =
      selectedEnhanceTranscription ?? enhanceTranscription ?? false;
    setSelectedEnhanceTranscription(!currentValue);
  };

  const handleToggleShowIcon = () => {
    const currentValue = selectedShowIcon ?? showIconEnabled ?? true;
    setSelectedShowIcon(!currentValue);
  };

  const handleCheckUpdate = async () => {
    try {
      setIsCheckingUpdate(true);
      setUpdateStatus("Checking for updates...");

      const update = await check();

      if (update) {
        const details = await checkUpdateDetails();
        useUpdaterStore.getState().setUpdate(update, details);
        useUpdaterStore.getState().openModal();
        setUpdateStatus(""); // Reset text
      } else {
        setUpdateStatus("You are on the latest version.");
        toast.info("Lexi AI is up to date");
        setTimeout(() => setUpdateStatus(""), 3000);
      }
    } catch (error: any) {
      console.error("Update failed:", error);
      setUpdateStatus("");
      toast.error(`Update failed: ${error?.message || "Unknown error"}`);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const openExternal = async (url: string) => {
    try {
      await invoke("open_external_url", { url });
    } catch (e) {
      console.error("Failed to open external url:", e);
    }
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
        <h2 className="page__title page__title--with-icon">
          <SettingsIcon
            className="page__title__icon"
            size={22}
            strokeWidth={2}
            aria-hidden
          />
          Settings
        </h2>
        <ScreenSkeleton variant="settings" className="page__empty" />
      </div>
    );
  }

  if (!authStore.isAuthenticated) {
    return (
      <div className="page">
        <h2 className="page__title page__title--with-icon">
          <SettingsIcon
            className="page__title__icon"
            size={22}
            strokeWidth={2}
            aria-hidden
          />
          Settings
        </h2>
        <div className="panel panel--center">
          <p className="panel__message">Sign in to access your settings</p>
          <GoogleLoginButton onSuccess={() => {}} onError={() => {}} />
        </div>
      </div>
    );
  }

  if (config === null) {
    return (
      <div className="page">
        <h2 className="page__title page__title--with-icon">
          <SettingsIcon
            className="page__title__icon"
            size={22}
            strokeWidth={2}
            aria-hidden
          />
          Settings
        </h2>
      </div>
    );
  }

  return (
    <div className="page">
      <h2 className="page__title page__title--with-icon">
        <SettingsIcon
          className="page__title__icon"
          size={22}
          strokeWidth={2}
          aria-hidden
        />
        Settings
      </h2>

      <div className="section-tabs">
        {[
          { id: "general" as const, label: "General", icon: Power },
          { id: "account" as const, label: "Account", icon: Monitor },
          { id: "transcription" as const, label: "Transcription", icon: Mic },
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
      <div className="settings-layout">
        {activeSection === "account" && (
          <div>
            {showUpgradeModal && (
              <UpgradeModal onClose={() => setShowUpgradeModal(false)} />
            )}
            <div className="panel panel--lg">
              <div className="panel__label panel__label--spaced">Account</div>
              <GoogleLoginButton />

              {authStore.isAuthenticated && (
                <div style={{ marginTop: 14 }}>
                  <div
                    className="panel"
                    style={{
                      marginTop: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>Subscription</span>
                        <span
                          className="docs-editor-toolbar-pill docs-editor-toolbar-pill--muted"
                          style={{
                            textTransform: "capitalize",
                            fontSize: 12,
                          }}
                        >
                          {billingLoading
                            ? "Loading…"
                            : (subscription?.plan_type ?? "—")}
                        </span>
                      </div>
                      <div className="settings-hint" style={{ marginTop: 0 }}>
                        {isFreePlan(subscription?.plan_type)
                          ? "You're on the Free plan."
                          : isProPlan(subscription?.plan_type)
                            ? "You're on the Pro plan."
                            : "Plan information unavailable."}
                      </div>
                      {subscription?.cancel_at_period_end &&
                        subscription?.next_billing_date && (
                          <div
                            className="settings-hint"
                            style={{ marginTop: 0 }}
                          >
                            Pro remains active until{" "}
                            {new Date(
                              subscription.next_billing_date,
                            ).toLocaleDateString()}
                            .
                          </div>
                        )}
                    </div>

                    <div className="btn-row" style={{ marginTop: 0 }}>
                      {!billingLoading &&
                        isFreePlan(subscription?.plan_type) && (
                          <button
                            type="button"
                            className="btn btn--primary"
                            onClick={() => setShowUpgradeModal(true)}
                          >
                            Upgrade
                          </button>
                        )}
                      {!billingLoading && isProActive(subscription) && (
                        <>
                          {!confirmCancelSub ? (
                            <button
                              type="button"
                              className="btn btn--outline"
                              onClick={() => setConfirmCancelSub(true)}
                              disabled={isCancelingSub}
                            >
                              Cancel subscription
                            </button>
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                flexWrap: "wrap",
                                justifyContent: "flex-end",
                              }}
                            >
                              <span
                                className="settings-hint"
                                style={{ margin: 0, maxWidth: 260 }}
                              >
                                Cancel at the end of your current billing
                                period?
                              </span>
                              <button
                                type="button"
                                className="btn btn--outline"
                                onClick={() => setConfirmCancelSub(false)}
                                disabled={isCancelingSub}
                              >
                                Keep
                              </button>
                              <button
                                type="button"
                                className="btn btn--primary"
                                onClick={handleCancelSubscription}
                                disabled={isCancelingSub}
                              >
                                {isCancelingSub
                                  ? "Canceling…"
                                  : "Confirm cancel"}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
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
                  <span className="select-trigger__left">
                    <span>
                      {selectedLanguage === LanguageCode.AUTO
                        ? "Auto Detect Language"
                        : SUPPORTED_LANGUAGES.find(
                            (l) => l.value === selectedLanguage,
                          )?.label || "Select language"}
                    </span>
                    <span
                      className="select-trigger__indicator"
                      aria-hidden="true"
                    >
                      {selectedLanguage !== LanguageCode.AUTO ? (
                        <span className="lang-flag">
                          {getLanguageFlag(selectedLanguage) ?? ""}
                        </span>
                      ) : (
                        <Sparkles size={16} className="lang-auto-icon" />
                      )}
                    </span>
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
                          setSelectedLanguage(LanguageCode.AUTO);
                          setIsLanguageDropdownOpen(false);
                        }}
                        className="select-option"
                      >
                        <span>Auto Detect Language</span>
                        <span className="select-option__right">
                          <Sparkles
                            size={16}
                            className="lang-auto-icon flex-shrink-0"
                            aria-hidden="true"
                          />
                          {selectedLanguage === LanguageCode.AUTO && (
                            <Check size={16} className="check flex-shrink-0" />
                          )}
                        </span>
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
                          <span className="select-option__right">
                            <span className="lang-flag" aria-hidden="true">
                              {getLanguageFlag(lang.value) ?? ""}
                            </span>
                            {selectedLanguage === lang.value && (
                              <Check
                                size={16}
                                className="check flex-shrink-0"
                              />
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="settings-hint">
                {selectedLanguage === LanguageCode.AUTO
                  ? "Automatically detected from your audio input."
                  : `Transcription will be limited to ${SUPPORTED_LANGUAGES.find((l) => l.value === selectedLanguage)?.label || selectedLanguage}`}
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
            {/*
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
            */}
            {dockOrTaskbarIconPlatform && (
              <div className="panel panel--lg mb-24">
                <div className="settings-row">
                  <div className="settings-row__content">
                    <div className="settings-row__title">
                      {dockOrTaskbarIconPlatform === "mac"
                        ? "Show App Icon in Dock"
                        : "Show App Icon in Taskbar"}
                    </div>
                    <div className="settings-row__desc">
                      {dockOrTaskbarIconPlatform === "mac"
                        ? "Display Lexi in the macOS Dock."
                        : "Display Lexi in the Windows taskbar."}
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

            <div className="panel panel--lg mb-24">
              <div className="settings-row">
                <div className="settings-row__content">
                  <div className="settings-row__title">Updates</div>
                  <div className="settings-row__desc">
                    {updateStatus ||
                      "Check if a newer version of Lexi AI is available."}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCheckUpdate}
                  disabled={isCheckingUpdate || isLoading}
                  className="sidebar-update-banner"
                  style={{
                    margin: 0,
                    padding: "8px 14px",
                    width: "fit-content",
                  }}
                >
                  {isCheckingUpdate ? (
                    <RefreshCw size={16} className="spinner-small" />
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  )}
                  <div className="sidebar-update-banner__text">
                    <span className="sidebar-update-banner__title">
                      {isCheckingUpdate ? "Checking..." : "Check for Updates"}
                    </span>
                  </div>
                </button>
              </div>
            </div>
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
              <div className="mb-16">
                <HotkeySelector
                  label="Action Hotkeys"
                  titleIcon={<Atom size={16} strokeWidth={2} />}
                  description={`Hold ${currentActionHotkeys.hotkeys.length > 0 && !currentActionHotkeys.hotkeys[0].includes("+") ? "this key" : "this hotkey combination"} to record a voice command for actions`}
                  value={currentActionHotkeys}
                  onChange={setCurrentActionHotkeys}
                  maxHotkeys={3}
                  disabled={isLoading || isUpdating}
                />
              </div>
              <div className="btn-row" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  onClick={handleResetHotkeys}
                  disabled={isLoading || isUpdating}
                  className="btn btn--outline"
                >
                  Reset to defaults
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="settings-footer-area">
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

          <div className="settings-legal-footer" aria-label="Legal links">
            <span>By using Lexi AI, you agree to our </span>
            <button
              type="button"
              className="settings-legal-link"
              onClick={() => openExternal(TERMS_URL)}
            >
              Terms
            </button>
            <span> and </span>
            <button
              type="button"
              className="settings-legal-link"
              onClick={() => openExternal(PRIVACY_URL)}
            >
              Privacy Policy
            </button>
            <span>.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
