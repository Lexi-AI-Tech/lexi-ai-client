/**
 * Pill Window Entry Point
 *
 * This is the entry point for the pill overlay window.
 * It renders a minimal React component that displays the current
 * recording/processing status as a small overlay at the bottom of the screen.
 */

import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/window";
import { playSound } from "./lib/soundUtils";
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
    "idle"
  );
  const [isHovered, setIsHovered] = useState(false);
  const [audioLevels, setAudioLevels] = useState<number[]>([]);
  const [smoothedLevels, setSmoothedLevels] = useState<number[]>([]);
  const isRecordingRef = useRef(false);

  // Smooth audio levels for better visual experience (faster response)
  useEffect(() => {
    if (audioLevels.length === 0) return;

    const smoothing = 0.5; // Increased for faster response
    setSmoothedLevels((prev) => {
      if (prev.length !== audioLevels.length) {
        return audioLevels;
      }
      return audioLevels.map((level, i) => {
        const prevLevel = prev[i] || 0.15;
        return prevLevel * (1 - smoothing) + level * smoothing;
      });
    });
  }, [audioLevels]);

  // Reset audio levels when not recording
  useEffect(() => {
    isRecordingRef.current = status === "recording";
    if (status !== "recording") {
      setAudioLevels([]);
      setSmoothedLevels([]);
    }
  }, [status]);

  // Simulate audio levels when recording (fallback if volume-update events aren't available)
  useEffect(() => {
    if (status !== "recording") {
      return;
    }

    let animationFrameId: number;
    let startTime = Date.now();
    let lastVoiceChange = Date.now();
    let isVoiceActive = false;
    let voiceDuration = 0; // How long voice has been active/inactive
    let voiceIntensity = 0; // Current voice intensity (0-1)

    const simulateAudioLevels = () => {
      const elapsed = (Date.now() - startTime) / 1000;
      const timeSinceLastChange = (Date.now() - lastVoiceChange) / 1000;
      const numBars = 12;

      // Simulate voice detection - randomly switch between voice and silence
      // Voice periods: 0.5-3 seconds, Silence periods: 0.3-2 seconds
      const shouldSwitch = isVoiceActive
        ? timeSinceLastChange > 0.5 + Math.random() * 2.5 // Voice: 0.5-3s
        : timeSinceLastChange > 0.3 + Math.random() * 1.7; // Silence: 0.3-2s

      if (shouldSwitch) {
        isVoiceActive = !isVoiceActive;
        lastVoiceChange = Date.now();
        voiceDuration = 0;
        if (isVoiceActive) {
          voiceIntensity = 0.4 + Math.random() * 0.6; // Random intensity 0.4-1.0
        }
      }

      voiceDuration += 0.016; // ~60fps

      if (isVoiceActive) {
        // Voice is active - create realistic animated waveform
        // Vary intensity slightly over time
        const intensityVariation = Math.sin(elapsed * 2) * 0.15;
        const currentIntensity = Math.max(
          0.3,
          Math.min(1, voiceIntensity + intensityVariation),
        );

        const newLevels = Array(numBars)
          .fill(0)
          .map((_, i) => {
            // Each bar has different characteristics for realism
            const baseFreq = 3 + (i % 4) * 1.5; // Faster frequencies: 3-9 Hz
            const phase = (i / numBars) * Math.PI * 2;
            const timeOffset = elapsed * baseFreq;

            // Create multiple overlapping waves for natural voice pattern
            const wave1 = Math.sin(timeOffset + phase) * 0.5;
            const wave2 = Math.sin(timeOffset * 2.1 + phase * 1.5) * 0.3;
            const wave3 = Math.sin(timeOffset * 3.2 + phase * 0.8) * 0.2;

            // Add some randomness for natural variation
            const randomVariation = (Math.random() - 0.5) * 0.15;

            // Combine waves and apply intensity
            const combined =
              (wave1 + wave2 + wave3 + randomVariation) * currentIntensity;
            const level = Math.max(
              0.2,
              Math.min(1, (combined + 1) * 0.35 + 0.3),
            );

            return level;
          });

        setAudioLevels(newLevels);
      } else {
        // Silence - show static bars at moderate height
        const staticLevels = Array(numBars).fill(0.3);
        setAudioLevels(staticLevels);
      }

      animationFrameId = requestAnimationFrame(simulateAudioLevels);
    };

    // Start simulation
    animationFrameId = requestAnimationFrame(simulateAudioLevels);

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [status]);

  useEffect(() => {
    const setupListeners = async () => {
      try {
        // Listen for recording started
        const unlistenStarted = await listen("recording_started", async () => {
          setStatus("recording");
          // Resize window to expanded size
          const window = getCurrentWindow();
          await window.setSize(new LogicalSize(60, 40));

          playSound("processing");
        });

        // Listen for recording stopped
        const unlistenStopped = await listen("recording_stopped", async () => {
          setStatus("processing");
          // Keep expanded size for processing
          const window = getCurrentWindow();
          await window.setSize(new LogicalSize(60, 40));
        });

        // Listen for processing start
        const unlistenProcessing = await listen(
          "processing_start",
          async () => {
            setStatus("processing");
            // Keep expanded size for processing
            const window = getCurrentWindow();
            await window.setSize(new LogicalSize(60, 40));
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
            // Play done sound
            playSound("done");
          },
        );

        // Listen for transcription error
        const unlistenError = await listen("transcription_error", async () => {
          setStatus("idle");
          // Resize window to thin rectangular size
          const window = getCurrentWindow();
          await window.setSize(new LogicalSize(40, 6.6));
        });

        // Listen for volume updates (audio levels) - real audio data takes priority
        let unlistenVolume: (() => void) | undefined;
        try {
          unlistenVolume = await listen("volume-update", (event: any) => {
            const volume = event.payload as number;
            if (
              isRecordingRef.current &&
              volume !== undefined &&
              volume !== null
            ) {
              // Generate individual bar levels based on real volume
              const numBars = 12;
              const normalizedVolume = Math.max(0, Math.min(1, volume));

              // Only animate if there's actual sound (volume > threshold)
              const isVoiceActive = normalizedVolume > 0.15;

              if (isVoiceActive) {
                // Voice detected - create fast, responsive waveform
                const timeOffset = Date.now() * 0.015; // Faster animation
                const newLevels = Array(numBars)
                  .fill(0)
                  .map((_, i) => {
                    // Each bar responds differently with faster frequencies
                    const phase = (i / numBars) * Math.PI * 2;
                    const freq = 4 + (i % 3) * 2; // Faster: 4-8 Hz
                    const waveOffset =
                      Math.sin(phase + timeOffset * freq) * 0.3;
                    const level = Math.max(
                      0.2,
                      Math.min(1, normalizedVolume * 0.75 + waveOffset + 0.25),
                    );
                    return level;
                  });
                setAudioLevels(newLevels);
              } else {
                // Silence - static bars at moderate height
                setAudioLevels(Array(numBars).fill(0.3));
              }
            }
          });
        } catch (error) {
          // Volume updates might not be available, that's okay - will use simulation
          console.log(
            "Volume update event not available, using simulation:",
            error,
          );
        }

        // Listen for action success
        const unlistenActionSuccess = await listen(
          "action_success",
          async () => {
            setStatus("idle");
            // Resize window to thin rectangular size
            const window = getCurrentWindow();
            await window.setSize(new LogicalSize(40, 6.6));
          },
        );

        // Listen for action error
        const unlistenActionError = await listen("action_error", async () => {
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
          if (unlistenVolume) {
            unlistenVolume();
          }
          unlistenActionSuccess();
          unlistenActionError();
        };
      } catch (error) {
        console.error("Failed to set up event listeners:", error);
      }
    };

    setupListeners();
  }, []);

  const handleMouseDown = async () => {
    // Start dragging the window when clicking on the pill
    try {
      const window = getCurrentWindow();
      await window.startDragging();
    } catch (error) {
      console.error("Failed to start dragging:", error);
    }
  };


  // Waveform icon SVG - individual bars that respond to audio levels
  const WaveformIcon = ({
    size = 20,
    color = "white",
    audioLevels = [],
  }: {
    size?: number;
    color?: string;
    audioLevels?: number[];
  }) => {
    const barWidth = 2.5;
    const barSpacing = 3;
    const maxBarHeight = size * 0.8;
    const minBarHeight = size * 0.15;
    const numBars = 12;
    const containerWidth = size * 0.98;
    const containerHeight = size * 0.9;
    const startX = (size - containerWidth) / 2;
    const startY = (size - containerHeight) / 2;

    // Use audio levels if available, otherwise use static default heights
    const hasAudio =
      audioLevels.length > 0 && audioLevels.some((level) => level > 0.2);
    const barHeights = hasAudio
      ? audioLevels.map((level) => {
          // Map audio level (0-1) to bar height
          return minBarHeight + (maxBarHeight - minBarHeight) * level;
        })
      : // Static bars when silent
        Array(numBars)
          .fill(0)
          .map(() => minBarHeight * 1.5);

    const totalBarsWidth = numBars * barWidth + (numBars - 1) * barSpacing;
    const barsStartX = startX + (containerWidth - totalBarsWidth) / 2;

    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
      >
        {/* Individual vertical bars */}
        {barHeights.map((height, index) => {
          const x = barsStartX + index * (barWidth + barSpacing);
          const y = startY + (containerHeight - height) / 2;
          return (
            <rect
              key={index}
              x={x}
              y={y}
              width={barWidth}
              height={height}
              fill={color}
              rx={barWidth / 2}
              style={{
                transition: hasAudio ? "height 0.1s ease-out" : "none",
              }}
            />
          );
        })}
      </svg>
    );
  };

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

  // Get background color - transparent when recording/processing, gray when hovered or idle
  const getBackgroundColor = () => {
    if (isHovered) {
      return "#6b7280"; // Gray-500 for hover state
    }
    if (status === "idle") {
      return "rgba(31, 41, 55, 0.4)"; // Transparent gray for idle
    }
    // Recording and processing: fully transparent
    return "transparent";
  };

  // Build base style object
  const baseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "move",
    transition: "all 0.1s ease-out", // Super fast transition for responsiveness
    transform: isHovered ? "scale(1.05)" : "scale(1)",
    transformOrigin: "center bottom", // Expand from bottom to top
    userSelect: "none",
    backgroundColor: getBackgroundColor(),
    pointerEvents: "auto",
    position: "relative",
    overflow: "visible",
    boxSizing: "border-box",
    flexShrink: 0,
  };

  // Apply state-specific styles
  if (status === "idle") {
    // Idle: tiny and small pill shape
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
    // Recording: expand to bigger rounded rectangle with more width and height
    baseStyle.width = "60px";
    baseStyle.height = "40px";
    baseStyle.minWidth = "60px";
    baseStyle.minHeight = "40px";
    baseStyle.maxWidth = "60px";
    baseStyle.maxHeight = "40px";
    baseStyle.borderRadius = "20px"; // Rounded rectangle
    baseStyle.border = "1px solid rgba(255, 255, 255, 0.1)";
    baseStyle.boxShadow = isHovered
      ? "0 8px 16px -4px rgba(0, 0, 0, 0.2), 0 4px 8px -2px rgba(0, 0, 0, 0.1)"
      : "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)";
  } else if (status === "processing") {
    // Processing: keep expanded size
    baseStyle.width = "60px";
    baseStyle.height = "40px";
    baseStyle.minWidth = "60px";
    baseStyle.minHeight = "40px";
    baseStyle.maxWidth = "60px";
    baseStyle.maxHeight = "40px";
    baseStyle.borderRadius = "20px"; // Rounded rectangle
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
      {/* No rippling effects - clean design */}

      {/* Processing spinner - no rings, just the loader icon */}

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
            width: "100%",
            height: "100%",
            gap: "8px", // Space between bars and loader
          }}
        >
          {status === "processing" ? (
            <>
              {/* Static bars during processing */}
              <WaveformIcon
                size={20}
                color="white"
                audioLevels={[]} // Empty array will show static bars
              />
              {/* Loader next to bars */}
              <LoaderIcon size={16} color="white" />
            </>
          ) : (
            <WaveformIcon
              size={24}
              color="white"
              audioLevels={smoothedLevels}
            />
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
  // Set body and html to transparent when component mounts
  useEffect(() => {
    document.body.style.background = "transparent";
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.documentElement.style.background = "transparent";
    document.documentElement.style.margin = "0";
    document.documentElement.style.padding = "0";
  }, []);

  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        background: "transparent",
        height: "100%",
        width: "100%",
        display: "flex",
        alignItems: "flex-end", // Align to bottom so pill expands upward
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
    </React.StrictMode>
  );
} else {
  console.error("Root element not found");
}
