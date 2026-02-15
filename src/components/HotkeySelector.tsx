import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { HotkeyConfig } from "../types";

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
  const [hoveredRemoveIndex, setHoveredRemoveIndex] = useState<number | null>(null);
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

    // Listen to rdev key events (KeyPress events)
    const setupListener = async () => {
      const unlisten = await listen<{ key: string; modifiers: string[] }>(
        "hotkey-recorded",
        (event) => {
          const key = event.payload.key;
          keyBuffer.add(key);
          setCurrentKeys(new Set(keyBuffer));

          // Reset the settle timer — finalize 500ms after the last key press
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

  // Render a single key cap
  const renderKeyCap = (key: string, keyIndex: number, totalKeys: number) => {
    const keyName = key.trim().toLowerCase();
    const keyInfo = KEY_SYMBOLS[keyName];
    return (
      <span key={`${keyIndex}-${key}`} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
        <span
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: "6px 8px",
            minWidth: "54px",
            minHeight: "48px",
            background: "linear-gradient(180deg, #3a3a3c 0%, #2c2c2e 100%)",
            color: "#fff",
            borderRadius: "6px",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
            boxShadow:
              "0 1px 0 1px #1a1a1a, 0 2px 4px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)",
            border: "1px solid #4a4a4c",
            position: "relative",
          }}
        >
          {keyInfo && (
            <span
              style={{
                fontSize: "13px",
                position: "absolute",
                top: "8px",
                right: "10px",
                color: "rgba(255,255,255,0.9)",
              }}
            >
              {keyInfo.symbol}
            </span>
          )}
          <span
            style={{
              fontSize: "10px",
              fontWeight: 400,
              color: "rgba(255,255,255,0.85)",
              marginTop: "auto",
            }}
          >
            {keyInfo ? keyInfo.label : key.trim()}
          </span>
        </span>
        {keyIndex < totalKeys - 1 && (
          <span
            style={{
              color: "#9ca3af",
              fontSize: "14px",
              fontWeight: 400,
              marginLeft: "4px",
            }}
          >
            +
          </span>
        )}
      </span>
    );
  };

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      {/* Label */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <label
          style={{
            fontSize: "11px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "#9ca3af",
          }}
        >
          {label}
        </label>
        <p
          style={{
            fontSize: "12px",
            color: "#6b7280",
            margin: 0,
          }}
        >
          {description}
        </p>
      </div>

      {/* Hotkey chips - inline */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          gap: "12px",
          alignItems: "center",
        }}
      >
        {hotkeys.map((hotkey, index) => {
          const keys = hotkey.split("+");
          return (
            <div
              key={`hotkey-${index}-${hotkey}`}
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  backgroundColor: "#f9fafb",
                  padding: "12px 16px",
                  paddingRight: disabled ? "16px" : "36px",
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                }}
              >
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
                  onMouseEnter={() => setHoveredRemoveIndex(index)}
                  onMouseLeave={() => setHoveredRemoveIndex(null)}
                  aria-label="Remove hotkey"
                  style={{
                    position: "absolute",
                    top: "8px",
                    right: "8px",
                    width: "20px",
                    height: "20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: hoveredRemoveIndex === index ? "#fef2f2" : "transparent",
                    border: "none",
                    borderRadius: "4px",
                    color: hoveredRemoveIndex === index ? "#ef4444" : "#9ca3af",
                    cursor: "pointer",
                    fontSize: "14px",
                    lineHeight: 1,
                    fontWeight: 600,
                    transition: "all 0.2s ease",
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}

        {/* Recording indicator */}
        {isRecording && (
          <div
            style={{
              backgroundColor: "#eff6ff",
              padding: "12px 16px",
              borderRadius: "10px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              border: "2px solid rgba(59, 130, 246, 0.35)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            {currentKeys.size > 0 ? (
              Array.from(currentKeys).map((key, i) =>
                renderKeyCap(key, i, currentKeys.size),
              )
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 0",
                }}
              >
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    background: "#3b82f6",
                    borderRadius: "50%",
                    animation: "pulse 1.5s infinite",
                  }}
                />
                <span
                  style={{
                    fontSize: "13px",
                    color: "#9ca3af",
                  }}
                >
                  Press your desired key combination...
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "8px" }}>
        {!isRecording ? (
          <button
            onClick={startRecording}
            disabled={hotkeys.length >= maxHotkeys || disabled}
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 500,
              borderRadius: "8px",
              cursor:
                hotkeys.length >= maxHotkeys || disabled
                  ? "not-allowed"
                  : "pointer",
              background:
                hotkeys.length >= maxHotkeys || disabled
                  ? "#f3f4f6"
                  : "#111827",
              color:
                hotkeys.length >= maxHotkeys || disabled
                  ? "#9ca3af"
                  : "#ffffff",
              border: "none",
              transition: "all 0.2s ease",
              opacity: hotkeys.length >= maxHotkeys || disabled ? 0.5 : 1,
            }}
          >
            {hotkeys.length === 0 ? "Record Hotkey" : "Add Another"}
          </button>
        ) : (
          <button
            onClick={stopRecording}
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 500,
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              cursor: "pointer",
              background: "#ffffff",
              color: "#111827",
              transition: "all 0.2s ease",
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Count indicator */}
      {hotkeys.length > 0 && (
        <div
          style={{
            fontSize: "11px",
            color: "#9ca3af",
          }}
        >
          {hotkeys.length}/{maxHotkeys} hotkeys configured
        </div>
      )}
    </div>
  );
}
