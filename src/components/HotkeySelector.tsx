import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { HotkeyConfig } from "../types";
import "../styles/components/hotkey-selector.css";

interface HotkeySelectorProps {
  value?: HotkeyConfig;
  onChange?: (config: HotkeyConfig) => void;
  maxHotkeys?: number;
  disabled?: boolean;
  label?: string;
  description?: string;
  /** Called when the user records a shortcut that is reserved by macOS */
  onValidationError?: (message: string) => void;
}

// Mac key symbols for display
const KEY_SYMBOLS: Record<string, { symbol: string; label: string }> = {
  fn: { symbol: "fn", label: "🌐" },
  control: { symbol: "^", label: "control" },
  ctrl: { symbol: "^", label: "control" },
  command: { symbol: "⌘", label: "command" },
  cmd: { symbol: "⌘", label: "command" },
  option: { symbol: "⌥", label: "option" },
  alt: { symbol: "⌥", label: "option" },
  shift: { symbol: "⇧", label: "shift" },
};

/** Canonical modifier order for storage (Control+Option+Command+Shift+Key, Fn first when present) */
const MODIFIER_ORDER = ["Fn", "Control", "Option", "Command", "Shift"];

export function HotkeySelector({
  value = { hotkeys: [] },
  onChange,
  maxHotkeys = 3,
  disabled = false,
  label = "Hotkeys",
  description = "Press keys to record a hotkey combination",
  onValidationError,
}: HotkeySelectorProps) {
  const [hotkeys, setHotkeys] = useState<string[]>(value.hotkeys);
  const [isRecording, setIsRecording] = useState(false);
  const [currentKeys, setCurrentKeys] = useState<Set<string>>(new Set());
  const lastPropValue = useRef<string>(JSON.stringify(value.hotkeys));
  const lastNotified = useRef<string>(JSON.stringify(value.hotkeys));
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from props
  useEffect(() => {
    const propStr = JSON.stringify(value.hotkeys);
    if (propStr !== lastPropValue.current) {
      setHotkeys(value.hotkeys);
      lastPropValue.current = propStr;
      lastNotified.current = propStr;
    }
  }, [value.hotkeys]);

  // Notify parent of changes
  useEffect(() => {
    if (onChange) {
      const currentStr = JSON.stringify(hotkeys);
      const propStr = JSON.stringify(value.hotkeys);
      if (currentStr !== propStr && currentStr !== lastNotified.current) {
        lastNotified.current = currentStr;
        onChange({ hotkeys });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotkeys]);

  // Finalize current keys into a hotkey string (canonical: Control+Option+Command+Shift+Key)
  const finalizeRecording = useCallback(
    async (keys: Set<string>) => {
      if (keys.size === 0) return;
      const keysArray = Array.from(keys);

      keysArray.sort((a, b) => {
        const aIdx = MODIFIER_ORDER.indexOf(a);
        const bIdx = MODIFIER_ORDER.indexOf(b);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return 0;
      });

      const display = keysArray.join("+");

      try {
        const canonical = await invoke<string>("validate_hotkey_for_ui", {
          hotkey: display,
        });
        if (!hotkeys.includes(canonical) && hotkeys.length < maxHotkeys) {
          setHotkeys((prev) => [...prev, canonical]);
        }
      } catch (err) {
        const message =
          typeof err === "string" ? err : (err as Error)?.message || "Invalid shortcut";
        onValidationError?.(message);
      }

      setCurrentKeys(new Set());
      stopRecording();
    },
    [hotkeys, maxHotkeys, onValidationError],
  );

  // Start recording mode — tells the rdev listener to emit key events
  const startRecording = useCallback(async () => {
    if (disabled || hotkeys.length >= maxHotkeys) return;
    try {
      await invoke("start_hotkey_recording");
      setIsRecording(true);
      setCurrentKeys(new Set());
    } catch (err) {
      console.error("Failed to start hotkey recording:", err);
    }
  }, [disabled, hotkeys.length, maxHotkeys]);

  // Stop recording mode
  const stopRecording = useCallback(async () => {
    setIsRecording(false);
    setCurrentKeys(new Set());
    if (recordingTimer.current) {
      clearTimeout(recordingTimer.current);
      recordingTimer.current = null;
    }
    try {
      await invoke("stop_hotkey_recording");
    } catch (err) {
      console.error("Failed to stop hotkey recording:", err);
    }
  }, []);

  // Listen for rdev key events while recording
  useEffect(() => {
    if (!isRecording) return;

    let keyBuffer = new Set<string>();
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const setupListener = async () => {
      const unlisten = await listen<{ key: string; modifiers: string[] }>(
        "hotkey-recorded",
        (event) => {
          const key = event.payload.key;
          keyBuffer.add(key);
          setCurrentKeys(new Set(keyBuffer));

          if (settleTimer) clearTimeout(settleTimer);
          settleTimer = setTimeout(() => {
            finalizeRecording(new Set(keyBuffer));
            keyBuffer = new Set();
          }, 500);
        },
      );

      return unlisten;
    };

    let unlistenFn: (() => void) | undefined;
    setupListener().then((fn) => {
      unlistenFn = fn;
    });

    return () => {
      if (unlistenFn) unlistenFn();
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [isRecording, finalizeRecording]);

  const removeHotkey = (index: number) => {
    setHotkeys((prev) => prev.filter((_, i) => i !== index));
  };

  const renderKeyCap = (key: string, keyIndex: number, totalKeys: number) => {
    const keyName = key.trim().toLowerCase();
    const keyInfo = KEY_SYMBOLS[keyName];
    return (
      <span key={`${keyIndex}-${key}`} className="hotkey-selector__key-row">
        <span className="hotkey-selector__key-cap">
          {keyInfo && (
            <span className="hotkey-selector__key-symbol">{keyInfo.symbol}</span>
          )}
          <span className="hotkey-selector__key-label">
            {keyInfo ? keyInfo.label : key.trim()}
          </span>
        </span>
        {keyIndex < totalKeys - 1 && <span className="hotkey-selector__plus">+</span>}
      </span>
    );
  };

  const atMax = hotkeys.length >= maxHotkeys || disabled;

  return (
    <div className="hotkey-selector">
      <div className="hotkey-selector__header">
        <label className="hotkey-selector__label">{label}</label>
        <p className="hotkey-selector__description">{description}</p>
      </div>

      <div className="hotkey-selector__chips">
        {hotkeys.map((hotkey, index) => {
          const keys = hotkey.split("+");
          return (
            <div key={`hotkey-${index}-${hotkey}`} className="hotkey-selector__chip-wrapper">
              <div className="hotkey-selector__chip">
                {keys.map((key, keyIndex) =>
                  renderKeyCap(key, keyIndex, keys.length),
                )}
              </div>
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    removeHotkey(index);
                  }}
                  aria-label="Remove hotkey"
                  className="hotkey-selector__remove-btn"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}

        {isRecording && (
          <div className="hotkey-selector__recording">
            {currentKeys.size > 0 ? (
              Array.from(currentKeys).map((key, i) =>
                renderKeyCap(key, i, currentKeys.size),
              )
            ) : (
              <div className="hotkey-selector__recording-placeholder">
                <div className="hotkey-selector__recording-dot" />
                <span className="hotkey-selector__recording-hint">
                  Press your desired key combination...
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="hotkey-selector__actions">
        {!isRecording ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={atMax}
            className="hotkey-selector__btn hotkey-selector__btn--primary"
          >
            {hotkeys.length === 0 ? "Record Hotkey" : "Add Another"}
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="hotkey-selector__btn hotkey-selector__btn--secondary"
          >
            Cancel
          </button>
        )}
      </div>

      {hotkeys.length > 0 && (
        <div className="hotkey-selector__count">
          {hotkeys.length}/{maxHotkeys} hotkeys configured
        </div>
      )}
    </div>
  );
}
