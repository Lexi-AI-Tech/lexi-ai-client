import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { HotkeyConfig } from "../types";
import { HotkeySelector } from "./HotkeySelector";

export const ShortcutsPage: React.FC = () => {
  const [currentHotkeys, setCurrentHotkeys] = useState<HotkeyConfig>({
    hotkeys: [],
  });
  const [selectedHotkeys, setSelectedHotkeys] = useState<HotkeyConfig>({
    hotkeys: [],
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load hotkeys on mount
  useEffect(() => {
    const loadHotkeys = async () => {
      setIsLoading(true);
      setError(null);

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
        setError("Failed to load hotkeys");
      } finally {
        setIsLoading(false);
      }
    };

    loadHotkeys();
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

  const handleSaveHotkeys = async () => {
    const hotkeysChanged =
      JSON.stringify(selectedHotkeys.hotkeys) !==
      JSON.stringify(currentHotkeys.hotkeys);

    if (!hotkeysChanged) {
      return; // No changes needed
    }

    setIsUpdating(true);
    setError(null);
    setSuccess(false);

    try {
      // Validate hotkeys
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

      // Update Rust backend
      const configJson = JSON.stringify(selectedHotkeys);
      await invoke("update_hotkey", { configJson });
      setCurrentHotkeys(selectedHotkeys);

      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      console.error("Failed to update hotkeys:", err);
      setError(err?.message || "Failed to update hotkeys");
    } finally {
      setIsUpdating(false);
    }
  };

  const hasChanges = () => {
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

  if (isLoading) {
    return (
      <div className="shortcuts-page">
        <h2
          style={{
            margin: 0,
            marginBottom: "32px",
            fontSize: "24px",
            fontWeight: 600,
            color: "#ffffff",
          }}
        >
          Shortcuts
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
          Loading shortcuts...
        </div>
      </div>
    );
  }

  return (
    <div className="shortcuts-page">
      <h2
        style={{
          margin: 0,
          marginBottom: "32px",
          fontSize: "24px",
          fontWeight: 600,
          color: "#ffffff",
        }}
      >
        Shortcuts
      </h2>

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

      <div style={{ marginTop: "32px" }}>
        <button
          className="transcript-btn"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isUpdating && hasChanges() && !isLoading) {
              handleSaveHotkeys();
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
          {isUpdating ? "Saving..." : "Save Shortcuts"}
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
            Shortcuts saved successfully!
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
