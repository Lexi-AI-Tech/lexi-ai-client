import type React from "react";

import { useState, useRef, useEffect } from "react";

import type { HotkeyConfig } from "../types";

interface Hotkey {
  id: string;
  keys: string[];
  display: string;
}

interface HotkeySelectorProps {
  value?: HotkeyConfig;
  onChange?: (config: HotkeyConfig) => void;
  maxHotkeys?: number;
  disabled?: boolean;
}

export function HotkeySelector({
  value = { hotkeys: [] },
  onChange,
  maxHotkeys = 3,
  disabled = false,
}: HotkeySelectorProps) {
  // Convert HotkeyConfig (string[]) to internal Hotkey[] format
  const configToHotkeys = (config: HotkeyConfig): Hotkey[] => {
    return config.hotkeys.map((hotkeyStr, index) => ({
      id: `hotkey-${index}-${hotkeyStr}`,
      keys: hotkeyStr.split("+"),
      display: hotkeyStr,
    }));
  };

  // Convert internal Hotkey[] format to HotkeyConfig (string[])
  const hotkeysToConfig = (hotkeys: Hotkey[]): HotkeyConfig => {
    return {
      hotkeys: hotkeys.map((h) => h.display),
    };
  };

  const [hotkeys, setHotkeys] = useState<Hotkey[]>(() =>
    configToHotkeys(value),
  );
  const [isRecording, setIsRecording] = useState(false);
  const [currentKeys, setCurrentKeys] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLDivElement>(null);

  // Update local state when value prop changes
  useEffect(() => {
    const newHotkeys = configToHotkeys(value);
    setHotkeys(newHotkeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.hotkeys.join(",")]);

  // Notify parent when hotkeys change
  useEffect(() => {
    if (onChange) {
      onChange(hotkeysToConfig(hotkeys));
    }
  }, [hotkeys, onChange]);

  // Normalize key names for consistent display
  const normalizeKey = (key: string): string => {
    const keyMap: Record<string, string> = {
      Control: "Ctrl",
      Meta:
        typeof navigator !== "undefined" && navigator.platform.includes("Mac")
          ? "Cmd"
          : "Win",
      Alt: "Alt",
      Shift: "Shift",
      " ": "Space", // Handle space key properly
      Enter: "Enter",
      Escape: "Esc",
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
    };
    return keyMap[key] || (key.length === 1 ? key.toUpperCase() : key);
  };

  // Handle key down
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isRecording || disabled) return;

    e.preventDefault();

    const key = e.key;

    if (key === " ") {
      const keys = new Set(currentKeys);
      keys.add("Space");
      const keysArray = Array.from(keys).sort((a, b) => {
        const order = ["Ctrl", "Shift", "Alt", "Cmd", "Win"];
        const aIdx = order.indexOf(a);
        const bIdx = order.indexOf(b);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return 0;
      });
      const display = keysArray.join("+");
      addHotkey(keysArray, display);
      setCurrentKeys(new Set());
      setIsRecording(false);
      return;
    }

    // Skip if it's a modifier key only
    if (["Control", "Meta", "Alt", "Shift"].includes(key)) {
      setCurrentKeys((prev) => new Set(prev).add(normalizeKey(key)));
      return;
    }

    const keys = new Set(currentKeys);
    keys.add(normalizeKey(key));

    const keysArray = Array.from(keys).sort((a, b) => {
      const order = ["Ctrl", "Shift", "Alt", "Cmd", "Win"];
      const aIdx = order.indexOf(a);
      const bIdx = order.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return 0;
    });

    const display = keysArray.join("+");

    // Auto-stop recording after valid combination
    if (keysArray.length > 0) {
      addHotkey(keysArray, display);
      setCurrentKeys(new Set());
      setIsRecording(false);
    }
  };

  // Handle key up
  const handleKeyUp = () => {
    if (!isRecording) {
      setCurrentKeys(new Set());
    }
  };

  // Add a hotkey
  const addHotkey = (keys: string[], display: string) => {
    if (hotkeys.length < maxHotkeys) {
      // Check if this hotkey already exists
      const exists = hotkeys.some((h) => h.display === display);
      if (!exists) {
        const newHotkey: Hotkey = {
          id: Date.now().toString(),
          keys,
          display,
        };
        setHotkeys([...hotkeys, newHotkey]);
      }
    }
  };

  // Remove a hotkey
  const removeHotkey = (id: string) => {
    setHotkeys(hotkeys.filter((hk) => hk.id !== id));
  };

  // Start recording
  const startRecording = () => {
    if (disabled) return;
    setIsRecording(true);
    setCurrentKeys(new Set());
    inputRef.current?.focus();
  };

  // Stop recording
  const stopRecording = () => {
    setIsRecording(false);
    setCurrentKeys(new Set());
  };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "600px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <label
          style={{
            fontSize: "11px",
            fontWeight: 500,
            color: "rgba(255, 255, 255, 0.9)",
          }}
        >
          Hotkeys (Up to {maxHotkeys})
        </label>
        <p
          style={{
            fontSize: "10px",
            color: "rgba(255, 255, 255, 0.6)",
            margin: 0,
          }}
        >
          Select single keys or key combinations
        </p>
      </div>

      {/* Input area with chips */}
      <div
        ref={inputRef}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          alignItems: "center",
          padding: "12px",
          borderRadius: "8px",
          border: isRecording
            ? "2px solid rgba(0, 122, 255, 0.5)"
            : "1px solid rgba(255, 255, 255, 0.2)",
          background: isRecording
            ? "rgba(0, 122, 255, 0.1)"
            : "rgba(255, 255, 255, 0.05)",
          cursor: disabled ? "not-allowed" : "text",
          outline: "none",
          transition: "all 0.2s ease",
          boxShadow: isRecording ? "0 0 0 3px rgba(0, 122, 255, 0.1)" : "none",
          minHeight: "44px",
        }}
        tabIndex={disabled ? -1 : 0}
      >
        {/* Display hotkey chips */}
        {hotkeys.map((hotkey) => (
          <div
            key={hotkey.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 10px",
              background: "rgba(0, 122, 255, 0.2)",
              color: "rgba(255, 255, 255, 0.9)",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 500,
              whiteSpace: "nowrap",
              border: "1px solid rgba(0, 122, 255, 0.3)",
            }}
          >
            <span
              style={{
                fontFamily:
                  'SF Mono, Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
              }}
            >
              {hotkey.display}
            </span>
            <button
              onClick={() => removeHotkey(hotkey.id)}
              disabled={disabled}
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255, 255, 255, 0.7)",
                cursor: disabled ? "not-allowed" : "pointer",
                padding: "2px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "4px",
                transition: "background 0.2s ease",
                fontSize: "12px",
                lineHeight: 1,
              }}
              onMouseEnter={(e) => {
                if (!disabled) {
                  e.currentTarget.style.background = "rgba(255, 59, 48, 0.2)";
                  e.currentTarget.style.color = "rgba(255, 59, 48, 0.9)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
              }}
              aria-label={`Remove ${hotkey.display}`}
            >
              ×
            </button>
          </div>
        ))}

        {/* Recording indicator */}
        {isRecording && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 10px",
              fontSize: "10px",
              color: "rgba(0, 122, 255, 0.9)",
              animation: "pulse 1.5s infinite",
            }}
          >
            <div
              style={{
                width: "8px",
                height: "8px",
                background: "rgba(0, 122, 255, 0.9)",
                borderRadius: "50%",
                animation: "pulse 1.5s infinite",
              }}
            />
            Listening...
          </div>
        )}

        {/* Placeholder text */}
        {hotkeys.length === 0 && !isRecording && (
          <span
            style={{
              fontSize: "11px",
              color: "rgba(255, 255, 255, 0.4)",
            }}
          >
            Press a key combination...
          </span>
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
              fontSize: "11px",
              fontWeight: 500,
              borderRadius: "6px",
              cursor:
                hotkeys.length >= maxHotkeys || disabled
                  ? "not-allowed"
                  : "pointer",
              background:
                hotkeys.length >= maxHotkeys || disabled
                  ? "rgba(255, 255, 255, 0.1)"
                  : "rgba(0, 122, 255, 0.2)",
              color:
                hotkeys.length >= maxHotkeys || disabled
                  ? "rgba(255, 255, 255, 0.4)"
                  : "rgba(255, 255, 255, 0.9)",
              border:
                hotkeys.length >= maxHotkeys || disabled
                  ? "1px solid rgba(255, 255, 255, 0.1)"
                  : "1px solid rgba(0, 122, 255, 0.3)",
              transition: "all 0.2s ease",
              opacity: hotkeys.length >= maxHotkeys || disabled ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (
                !(hotkeys.length >= maxHotkeys || disabled) &&
                e.currentTarget
              ) {
                e.currentTarget.style.background = "rgba(0, 122, 255, 0.3)";
              }
            }}
            onMouseLeave={(e) => {
              if (
                !(hotkeys.length >= maxHotkeys || disabled) &&
                e.currentTarget
              ) {
                e.currentTarget.style.background = "rgba(0, 122, 255, 0.2)";
              }
            }}
          >
            Add Hotkey
          </button>
        ) : (
          <button
            onClick={stopRecording}
            style={{
              padding: "8px 16px",
              fontSize: "11px",
              fontWeight: 500,
              borderRadius: "6px",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              cursor: "pointer",
              background: "rgba(255, 255, 255, 0.1)",
              color: "rgba(255, 255, 255, 0.9)",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Display selected hotkeys info */}
      {hotkeys.length > 0 && (
        <div
          style={{
            fontSize: "10px",
            color: "rgba(255, 255, 255, 0.6)",
            paddingTop: "8px",
            borderTop: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          {hotkeys.length}/{maxHotkeys} hotkeys selected
        </div>
      )}
    </div>
  );
}
