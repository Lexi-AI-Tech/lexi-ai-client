/**
 * Pill Window Entry Point
 *
 * This is the entry point for the pill overlay window.
 * It renders a minimal React component that displays the current
 * recording/processing status as a small overlay at the bottom of the screen.
 */

import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/window";
import "./index.css";

/**
 * Pill Component
 *
 * A visual indicator component that displays the current state of the
 * voice-to-text pipeline. It shows different colors and text based on
 * whether the app is idle, recording, or processing audio.
 */

/**
 * Note: Pill window positioning is handled in the Rust setup hook
 * (main.rs setup function) to ensure it's positioned before becoming visible.
 * This prevents the visible repositioning issue.
 */
const Pill: React.FC = () => {
  const [status, setStatus] = useState<"idle" | "recording" | "processing">(
    "idle",
  );
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const setupListeners = async () => {
      try {
        // Listen for recording started
        const unlistenStarted = await listen("recording_started", async () => {
          setStatus("recording");
          // Resize window to circular size
          const window = getCurrentWindow();
          await window.setSize(new LogicalSize(40, 40));
        });

        // Listen for recording stopped
        const unlistenStopped = await listen("recording_stopped", async () => {
          setStatus("processing");
          // Keep circular size for processing
          const window = getCurrentWindow();
          await window.setSize(new LogicalSize(40, 40));
        });

        // Listen for processing start
        const unlistenProcessing = await listen(
          "processing_start",
          async () => {
            setStatus("processing");
            // Keep circular size for processing
            const window = getCurrentWindow();
            await window.setSize(new LogicalSize(40, 40));
          },
        );

        // Listen for transcription success
        const unlistenSuccess = await listen(
          "transcription_success",
          async () => {
            setStatus("idle");
            // Resize window to thin rectangular size
            const window = getCurrentWindow();
            await window.setSize(new LogicalSize(40, 6.6));
          },
        );

        // Listen for transcription error
        const unlistenError = await listen("transcription_error", async () => {
          setStatus("idle");
          // Resize window to thin rectangular size
          const window = getCurrentWindow();
          await window.setSize(new LogicalSize(40, 6.6));
        });

        // Cleanup function
        return () => {
          unlistenStarted();
          unlistenStopped();
          unlistenProcessing();
          unlistenSuccess();
          unlistenError();
        };
      } catch (error) {
        console.error("Failed to set up event listeners:", error);
      }
    };

    setupListeners();
  }, []);

  /**
   * Returns the background color based on the current status
   */
  const getStatusColor = () => {
    switch (status) {
      case "recording":
        return "#ef4444"; // Red - indicates active recording
      case "processing":
        return "#3b82f6"; // Blue - indicates processing/transcription
      default:
        return "#1f2937"; // Gray-800 - indicates idle/ready state
    }
  };

  const handleMouseDown = async () => {
    // Start dragging the window when clicking on the pill
    try {
      const window = getCurrentWindow();
      await window.startDragging();
    } catch (error) {
      console.error("Failed to start dragging:", error);
    }
  };

  // Mic icon SVG
  const MicIcon = ({
    size = 20,
    color = "white",
  }: {
    size?: number;
    color?: string;
  }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );

  // Loader icon SVG (spinning)
  const LoaderIcon = ({
    size = 20,
    color = "white",
  }: {
    size?: number;
    color?: string;
  }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        animation: "spin 1s linear infinite",
      }}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );

  // Get background color - gray when hovered, otherwise status color
  const getBackgroundColor = () => {
    if (isHovered) {
      return "#6b7280"; // Gray-500 for hover state
    }
    if (status === "idle") {
      return "rgba(31, 41, 55, 0.4)"; // Transparent gray for idle
    }
    return getStatusColor();
  };

  // Build base style object
  const baseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "move",
    transition: "all 0.5s ease-in-out", // Longer transition like AudioRecorder
    transform: isHovered ? "scale(1.05)" : "scale(1)",
    userSelect: "none",
    backgroundColor: getBackgroundColor(),
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    pointerEvents: "auto",
    position: "relative",
    overflow: "visible",
    boxSizing: "border-box",
    flexShrink: 0,
  };

  // Apply state-specific styles (following AudioRecorder pattern)
  if (status === "idle") {
    // Idle: thin pill shape
    baseStyle.width = "40px";
    baseStyle.height = "6.6px";
    baseStyle.minWidth = "40px";
    baseStyle.minHeight = "6.6px";
    baseStyle.maxWidth = "40px";
    baseStyle.maxHeight = "6.6px";
    baseStyle.borderRadius = "3.3px";
    baseStyle.border = "1px solid rgba(255, 255, 255, 0.15)";
    baseStyle.boxShadow = isHovered
      ? "0 8px 16px -4px rgba(0, 0, 0, 0.2), 0 4px 8px -2px rgba(0, 0, 0, 0.1)"
      : "0 2px 4px -1px rgba(0, 0, 0, 0.1)";
  } else if (status === "recording") {
    // Recording: expand to circle - MUST be perfect square
    baseStyle.width = "40px";
    baseStyle.height = "40px";
    baseStyle.minWidth = "40px";
    baseStyle.minHeight = "40px";
    baseStyle.maxWidth = "40px";
    baseStyle.maxHeight = "40px";
    baseStyle.borderRadius = "50%"; // Perfect circle
    baseStyle.border = "1px solid rgba(255, 255, 255, 0.1)";
    baseStyle.boxShadow = isHovered
      ? "0 8px 16px -4px rgba(0, 0, 0, 0.2), 0 4px 8px -2px rgba(0, 0, 0, 0.1)"
      : "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)";
  } else if (status === "processing") {
    // Processing: circle - MUST be perfect square
    baseStyle.width = "40px";
    baseStyle.height = "40px";
    baseStyle.minWidth = "40px";
    baseStyle.minHeight = "40px";
    baseStyle.maxWidth = "40px";
    baseStyle.maxHeight = "40px";
    baseStyle.borderRadius = "50%"; // Perfect circle
    baseStyle.border = "1px solid rgba(255, 255, 255, 0.1)";
    baseStyle.boxShadow = isHovered
      ? "0 8px 16px -4px rgba(0, 0, 0, 0.2), 0 4px 8px -2px rgba(0, 0, 0, 0.1)"
      : "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)";
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={baseStyle}
    >
      {/* Rippling effect rings when recording */}
      {status === "recording" && (
        <>
          <div
            style={{
              position: "absolute",
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              backgroundColor: "rgba(239, 68, 68, 0.2)",
              animation: "ripple 2s ease-out infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              backgroundColor: "rgba(239, 68, 68, 0.25)",
              animation: "ripple 2s ease-out infinite",
              animationDelay: "0.3s",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              backgroundColor: "rgba(239, 68, 68, 0.3)",
              animation: "ripple 2s ease-out infinite",
              animationDelay: "0.6s",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              backgroundColor: "rgba(239, 68, 68, 0.35)",
              animation: "pulse 2s ease-in-out infinite",
            }}
          />
        </>
      )}

      {/* Processing spinner rings */}
      {status === "processing" && (
        <>
          <div
            style={{
              position: "absolute",
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              border: "2px solid rgba(59, 130, 246, 0.2)",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              border: "2px solid transparent",
              borderTopColor: "rgba(255, 255, 255, 0.8)",
              animation: "spin 1s linear infinite",
            }}
          />
        </>
      )}

      {/* Icon container - only show for recording/processing */}
      {status !== "idle" && (
        <div
          style={{
            position: "relative",
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
          }}
        >
          {status === "processing" ? (
            <LoaderIcon size={16} color="white" />
          ) : (
            <MicIcon size={16} color="white" />
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Root component for the pill window
 * Sets up the transparent background and centers the pill
 */
const PillApp: React.FC = () => {
  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        background: "transparent",
        height: "100%",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
        overflow: "hidden",
        pointerEvents: "none",
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      <Pill />
    </div>
  );
};

// Render the pill app
const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <PillApp />
    </React.StrictMode>,
  );
} else {
  console.error("Root element not found");
}
