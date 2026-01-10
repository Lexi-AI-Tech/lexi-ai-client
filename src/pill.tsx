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
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
// import { playSound } from "./lib/soundUtils";
// Note: Do NOT import index.css here - it adds opaque backgrounds that break transparency

// Window size constants
const IDLE_SIZE = { width: 40, height: 6.6 };
const EXPANDED_SIZE = { width: 60, height: 40 }; // Recording state
const PROCESSING_SIZE = { width: 80, height: 40 }; // Processing state (wider for bars + loader)
// Height difference for position adjustment (to make pill grow upward)
const HEIGHT_DIFF = EXPANDED_SIZE.height - IDLE_SIZE.height;

/**
 * Pill Component
 *
 * A visual indicator component that displays the current state of the
 * voice-to-text pipeline. It shows different colors and text based on
 * whether the app is idle, recording, or processing audio.
 */

/**
 * Note: Pill window positioning is handled in the setup hook
 * to ensure it's positioned before becoming visible.
 * This prevents the visible repositioning issue.
 */
const Pill: React.FC = () => {
  const [status, setStatus] = useState<"idle" | "recording" | "processing">(
    "idle",
  );
  const [isHovered, setIsHovered] = useState(false);
  const [audioLevels, setAudioLevels] = useState<number[]>([]);
  const [smoothedLevels, setSmoothedLevels] = useState<number[]>([]);
  const isRecordingRef = useRef(false);
  const hasRealAudioRef = useRef(false); // Track if we're receiving real volume data
  const lastVolumeTimeRef = useRef(0); // Track when we last received volume data

  // Smooth audio levels for better visual experience
  useEffect(() => {
    if (audioLevels.length === 0) return;

    const smoothing = 0.35; // Balanced for smooth yet responsive animation
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
      hasRealAudioRef.current = false;
    }
  }, [status]);

  // Initialize static bars when recording starts, and provide fallback animation
  // Real audio data from volume-update events takes priority
  useEffect(() => {
    if (status !== "recording") {
      return;
    }

    const numBars = 5; // Match WaveformIcon numBars
    // Start with static idle bars at moderate height
    setAudioLevels(Array(numBars).fill(0.35));

    // Fallback: if we don't receive real audio data after 500ms, show gentle idle animation
    const fallbackTimeout = setTimeout(() => {
      if (!hasRealAudioRef.current) {
        console.log("No real audio data received, using subtle idle animation");
      }
    }, 500);

    // Gentle idle pulse animation (only used when no voice detected)
    let animationFrameId: number;
    const idleAnimation = () => {
      // Only run idle animation if we haven't received real audio recently
      const timeSinceLastVolume = Date.now() - lastVolumeTimeRef.current;
      if (timeSinceLastVolume > 150) {
        // No recent audio data - show subtle idle bars with gentle breathing
        const time = Date.now() * 0.001;
        const idleLevels = Array(numBars)
          .fill(0)
          .map((_, i) => {
            // Gentle breathing effect for idle state
            const phase = (i / numBars) * Math.PI;
            const breath = Math.sin(time * 0.8 + phase) * 0.05;
            return 0.35 + breath;
          });
        setAudioLevels(idleLevels);
      }
      animationFrameId = requestAnimationFrame(idleAnimation);
    };

    animationFrameId = requestAnimationFrame(idleAnimation);

    return () => {
      clearTimeout(fallbackTimeout);
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
          // Play sound immediately for instant feedback (non-blocking)
          // playSound("processing");

          // Expand window upward: move up by height difference, then resize
          const window = getCurrentWindow();
          try {
            // outerPosition returns PhysicalPosition, we need to convert to logical
            const physicalPos = await window.outerPosition();
            const scaleFactor = await window.scaleFactor();
            const logicalX = physicalPos.x / scaleFactor;
            const logicalY = physicalPos.y / scaleFactor;

            // Move window UP so bottom edge stays in place while expanding
            await window.setPosition(
              new LogicalPosition(
                logicalX - (EXPANDED_SIZE.width - IDLE_SIZE.width) / 2, // Center horizontally
                logicalY - HEIGHT_DIFF, // Move up
              ),
            );
            await window.setSize(
              new LogicalSize(EXPANDED_SIZE.width, EXPANDED_SIZE.height),
            );
          } catch (e) {
            console.error("Failed to expand window:", e);
          }
        });

        // Listen for recording stopped
        const unlistenStopped = await listen("recording_stopped", async () => {
          setStatus("processing");
          // Expand width for processing (to fit bars + loader)
          const window = getCurrentWindow();
          try {
            const physicalPos = await window.outerPosition();
            const scaleFactor = await window.scaleFactor();
            const logicalX = physicalPos.x / scaleFactor;
            // Adjust position to keep centered while expanding width
            await window.setPosition(
              new LogicalPosition(
                logicalX - (PROCESSING_SIZE.width - EXPANDED_SIZE.width) / 2,
                physicalPos.y / scaleFactor,
              ),
            );
            await window.setSize(
              new LogicalSize(PROCESSING_SIZE.width, PROCESSING_SIZE.height),
            );
          } catch (e) {
            console.error("Failed to expand to processing size:", e);
          }
        });

        // Listen for processing start
        const unlistenProcessing = await listen(
          "processing_start",
          async () => {
            setStatus("processing");
            // Expand width for processing (to fit bars + loader)
            const window = getCurrentWindow();
            try {
              const physicalPos = await window.outerPosition();
              const scaleFactor = await window.scaleFactor();
              const logicalX = physicalPos.x / scaleFactor;
              await window.setPosition(
                new LogicalPosition(
                  logicalX - (PROCESSING_SIZE.width - EXPANDED_SIZE.width) / 2,
                  physicalPos.y / scaleFactor,
                ),
              );
              await window.setSize(
                new LogicalSize(PROCESSING_SIZE.width, PROCESSING_SIZE.height),
              );
            } catch (e) {
              console.error("Failed to expand to processing size:", e);
            }
          },
        );

        // Listen for transcription success
        const unlistenSuccess = await listen(
          "transcription_success",
          async () => {
            setStatus("idle");
            // Play done sound immediately for instant feedback
            // playSound("done");

            // Shrink window downward: resize first, then move down
            const window = getCurrentWindow();
            try {
              // outerPosition returns PhysicalPosition, convert to logical
              const physicalPos = await window.outerPosition();
              const scaleFactor = await window.scaleFactor();
              const logicalX = physicalPos.x / scaleFactor;
              const logicalY = physicalPos.y / scaleFactor;

              await window.setSize(
                new LogicalSize(IDLE_SIZE.width, IDLE_SIZE.height),
              );
              // Move window DOWN so bottom edge stays in place while shrinking
              // Use PROCESSING_SIZE since we're coming from processing state
              await window.setPosition(
                new LogicalPosition(
                  logicalX + (PROCESSING_SIZE.width - IDLE_SIZE.width) / 2,
                  logicalY + HEIGHT_DIFF,
                ),
              );
            } catch (e) {
              console.error("Failed to shrink window:", e);
            }
          },
        );

        // Listen for transcription error
        const unlistenError = await listen("transcription_error", async () => {
          setStatus("idle");

          // Shrink window downward: resize first, then move down
          const window = getCurrentWindow();
          try {
            // outerPosition returns PhysicalPosition, convert to logical
            const physicalPos = await window.outerPosition();
            const scaleFactor = await window.scaleFactor();
            const logicalX = physicalPos.x / scaleFactor;
            const logicalY = physicalPos.y / scaleFactor;

            await window.setSize(
              new LogicalSize(IDLE_SIZE.width, IDLE_SIZE.height),
            );
            // Move window DOWN so bottom edge stays in place while shrinking
            // Use PROCESSING_SIZE since we're coming from processing state
            await window.setPosition(
              new LogicalPosition(
                logicalX + (PROCESSING_SIZE.width - IDLE_SIZE.width) / 2,
                logicalY + HEIGHT_DIFF,
              ),
            );
          } catch (e) {
            console.error("Failed to shrink window:", e);
          }
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
              // Mark that we're receiving real audio data
              hasRealAudioRef.current = true;
              lastVolumeTimeRef.current = Date.now();

              // Generate individual bar levels based on real volume
              const numBars = 5; // Match WaveformIcon numBars
              const normalizedVolume = Math.max(0, Math.min(1, volume));

              // Voice detection threshold - adjust based on your mic sensitivity
              const voiceThreshold = 0.08;
              const isVoiceActive = normalizedVolume > voiceThreshold;

              if (isVoiceActive) {
                // Voice detected - create responsive animated waveform
                const timeOffset = Date.now() * 0.015;
                const intensity = Math.min(1, normalizedVolume * 1.8);

                const newLevels = Array(numBars)
                  .fill(0)
                  .map((_, i) => {
                    const phase = (i / numBars) * Math.PI * 2;
                    const freq = 2 + i * 0.8;
                    const wave = Math.sin(phase + timeOffset * freq) * 0.15;
                    const level = Math.max(
                      0.25,
                      Math.min(1, intensity * 0.5 + wave + 0.3),
                    );
                    return level;
                  });
                setAudioLevels(newLevels);
              } else {
                // No voice - idle bars at moderate height
                setAudioLevels(Array(numBars).fill(0.35));
              }
            }
          });
        } catch (error) {
          // Volume updates might not be available, that's okay - will use idle animation
          console.log(
            "Volume update event not available, using idle animation:",
            error,
          );
        }

        // Listen for action success
        const unlistenActionSuccess = await listen(
          "action_success",
          async () => {
            setStatus("idle");

            // Shrink window downward: resize first, then move down
            const window = getCurrentWindow();
            try {
              // outerPosition returns PhysicalPosition, convert to logical
              const physicalPos = await window.outerPosition();
              const scaleFactor = await window.scaleFactor();
              const logicalX = physicalPos.x / scaleFactor;
              const logicalY = physicalPos.y / scaleFactor;

              await window.setSize(
                new LogicalSize(IDLE_SIZE.width, IDLE_SIZE.height),
              );
              // Use PROCESSING_SIZE since we're coming from processing state
              await window.setPosition(
                new LogicalPosition(
                  logicalX + (PROCESSING_SIZE.width - IDLE_SIZE.width) / 2,
                  logicalY + HEIGHT_DIFF,
                ),
              );
            } catch (e) {
              console.error("Failed to shrink window:", e);
            }
          },
        );

        // Listen for action error
        const unlistenActionError = await listen("action_error", async () => {
          setStatus("idle");

          // Shrink window downward: resize first, then move down
          const window = getCurrentWindow();
          try {
            // outerPosition returns PhysicalPosition, convert to logical
            const physicalPos = await window.outerPosition();
            const scaleFactor = await window.scaleFactor();
            const logicalX = physicalPos.x / scaleFactor;
            const logicalY = physicalPos.y / scaleFactor;

            await window.setSize(
              new LogicalSize(IDLE_SIZE.width, IDLE_SIZE.height),
            );
            // Use PROCESSING_SIZE since we're coming from processing state
            await window.setPosition(
              new LogicalPosition(
                logicalX + (PROCESSING_SIZE.width - IDLE_SIZE.width) / 2,
                logicalY + HEIGHT_DIFF,
              ),
            );
          } catch (e) {
            console.error("Failed to shrink window:", e);
          }
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
    // Configuration for balanced bars
    const numBars = 5;
    const barWidth = 2.8;
    const barSpacing = 2;
    const maxBarHeight = size * 0.75;
    const minBarHeight = size * 0.22; // Moderate idle height
    const containerWidth = size * 0.95;
    const containerHeight = size * 0.85;
    const startX = (size - containerWidth) / 2;
    const startY = (size - containerHeight) / 2;

    // Use audio levels if available, otherwise use static default heights
    // hasAudio is true when bars should be actively animating (voice detected)
    const hasAudio =
      audioLevels.length > 0 && audioLevels.some((level) => level > 0.25);

    // Resample audio levels to match numBars if needed
    const resampledLevels =
      audioLevels.length > 0
        ? Array(numBars)
            .fill(0)
            .map((_, i) => {
              const sourceIndex = Math.floor(
                (i / numBars) * audioLevels.length,
              );
              return audioLevels[sourceIndex] || 0.3;
            })
        : Array(numBars).fill(0.35);

    const barHeights = resampledLevels.map((level) => {
      return (
        minBarHeight + (maxBarHeight - minBarHeight) * Math.max(0.2, level)
      );
    });

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
                transition: hasAudio
                  ? "height 0.15s cubic-bezier(0.4, 0, 0.2, 1), y 0.15s cubic-bezier(0.4, 0, 0.2, 1)"
                  : "none",
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

  // Get background color - black background for all states
  const getBackgroundColor = () => {
    if (isHovered) {
      return "rgba(0, 0, 0, 0.95)"; // Slightly lighter black on hover
    }
    // Consistent black background for all states
    return "rgba(0, 0, 0, 0.9)";
  };

  // Build base style object
  const baseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "move",
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", // Smooth, natural easing
    transform: isHovered ? "scale(1.02)" : "scale(1)", // Subtle scale on hover
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
    baseStyle.border = "1px solid rgba(255, 255, 255, 0.2)";
    baseStyle.boxShadow = isHovered
      ? "0 8px 24px -4px rgba(0, 0, 0, 0.5), 0 4px 12px -2px rgba(0, 0, 0, 0.3)"
      : "0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 2px 6px -1px rgba(0, 0, 0, 0.2)";
  } else if (status === "recording") {
    // Recording: expand to bigger rounded rectangle with more width and height
    baseStyle.width = "60px";
    baseStyle.height = "40px";
    baseStyle.minWidth = "60px";
    baseStyle.minHeight = "40px";
    baseStyle.maxWidth = "60px";
    baseStyle.maxHeight = "40px";
    baseStyle.borderRadius = "20px"; // Rounded rectangle
    baseStyle.border = "1px solid rgba(255, 255, 255, 0.15)";
    baseStyle.boxShadow = isHovered
      ? "0 12px 32px -4px rgba(0, 0, 0, 0.6), 0 6px 16px -2px rgba(0, 0, 0, 0.4)"
      : "0 8px 24px -4px rgba(0, 0, 0, 0.5), 0 4px 12px -2px rgba(0, 0, 0, 0.3)";
  } else if (status === "processing") {
    // Processing: wider to fit bars + loader
    baseStyle.width = "80px";
    baseStyle.height = "40px";
    baseStyle.minWidth = "80px";
    baseStyle.minHeight = "40px";
    baseStyle.maxWidth = "80px";
    baseStyle.maxHeight = "40px";
    baseStyle.borderRadius = "20px"; // Rounded rectangle
    baseStyle.border = "1px solid rgba(255, 255, 255, 0.15)";
    baseStyle.boxShadow = isHovered
      ? "0 12px 32px -4px rgba(0, 0, 0, 0.6), 0 6px 16px -2px rgba(0, 0, 0, 0.4)"
      : "0 8px 24px -4px rgba(0, 0, 0, 0.5), 0 4px 12px -2px rgba(0, 0, 0, 0.3)";
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
                size={22}
                color="white"
                audioLevels={[]} // Empty array will show static bars
              />
              {/* Loader next to bars */}
              <LoaderIcon size={14} color="white" />
            </>
          ) : (
            <WaveformIcon
              size={26}
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
        borderRadius: "20px", // Match the pill's maximum border radius
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
