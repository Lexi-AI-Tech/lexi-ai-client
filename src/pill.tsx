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
import "./pill.css";
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
export const Pill: React.FC = () => {
  const [status, setStatus] = useState<"idle" | "recording" | "processing">(
    "idle",
  );
  const [recordingMode, setRecordingMode] = useState<"assistant" | "action">(
    "assistant",
  );
  const [isHovered, setIsHovered] = useState(false);
  const [audioLevels, setAudioLevels] = useState<number[]>([]);
  const [smoothedLevels, setSmoothedLevels] = useState<number[]>([]);
  const isRecordingRef = useRef(false);
  const hasRealAudioRef = useRef(false); // Track if we're receiving real volume data
  const lastVolumeTimeRef = useRef(0); // Track when we last received volume data
  // Single source of truth for idle position - prevents position drift from accumulated rounding errors
  const idlePositionRef = useRef<{ x: number; y: number } | null>(null);

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

  // Initialize idle position reference on mount
  useEffect(() => {
    const initializePosition = async () => {
      try {
        const window = getCurrentWindow();
        const physicalPos = await window.outerPosition();
        const scaleFactor = await window.scaleFactor();
        const logicalX = physicalPos.x / scaleFactor;
        const logicalY = physicalPos.y / scaleFactor;
        idlePositionRef.current = { x: logicalX, y: logicalY };
        console.log(
          "📍 Initialized idle position reference:",
          idlePositionRef.current,
        );
      } catch (e) {
        console.error("Failed to initialize idle position:", e);
      }
    };
    initializePosition();
  }, []);

  useEffect(() => {
    const setupListeners = async () => {
      try {
        // Listen for recording triggered (instant pill animation when key is pressed; mode decided later by backend)
        const expandPillToRecording = async () => {
          const window = getCurrentWindow();
          try {
            if (!idlePositionRef.current) return;
            const idleX = idlePositionRef.current.x;
            const idleY = idlePositionRef.current.y;
            const recordingX =
              idleX - (EXPANDED_SIZE.width - IDLE_SIZE.width) / 2;
            const recordingY = idleY - HEIGHT_DIFF;
            await window.setSize(
              new LogicalSize(EXPANDED_SIZE.width, EXPANDED_SIZE.height),
            );
            await window.setPosition(
              new LogicalPosition(recordingX, recordingY),
            );
          } catch (e) {
            console.error("Failed to expand window:", e);
          }
        };

        const unlistenTriggered = await listen("recording_triggered", async () => {
          setRecordingMode("assistant");
          setStatus("recording");
          await expandPillToRecording();
        });

        const unlistenCancelled = await listen("recording_cancelled", async () => {
          setStatus("idle");
          const window = getCurrentWindow();
          try {
            if (!idlePositionRef.current) return;
            await window.setSize(
              new LogicalSize(IDLE_SIZE.width, IDLE_SIZE.height),
            );
            await window.setPosition(
              new LogicalPosition(
                idlePositionRef.current.x,
                idlePositionRef.current.y,
              ),
            );
          } catch (e) {
            console.error("Failed to shrink window:", e);
          }
        });

        // Listen for recording started (from backend after grace window; pill may already be expanded)
        const unlistenStarted = await listen("recording_started", async () => {
          setRecordingMode("assistant");
          setStatus("recording");
          await expandPillToRecording();
        });

        // Listen for recording mode change (unified flow: real-time switch while holding hotkeys)
        const unlistenModeChanged = await listen(
          "recording_mode_changed",
          (event: { payload?: unknown }) => {
            try {
              const payload = event?.payload;
              if (typeof payload === "string" && (payload === "action" || payload === "assistant")) {
                setRecordingMode(payload);
              }
            } catch (_) {}
          },
        );

        // Listen for action recording started (pill may already be expanded from recording_triggered)
        const unlistenActionStarted = await listen(
          "action_recording_started",
          async () => {
            setRecordingMode("action");
            setStatus("recording");
            await expandPillToRecording();
          },
        );

        // Listen for recording stopped
        const unlistenStopped = await listen("recording_stopped", async () => {
          setStatus("processing");
          // Expand width for processing (to fit bars + loader)
          const window = getCurrentWindow();
          try {
            if (!idlePositionRef.current) {
              console.error("Idle position not initialized");
              return;
            }

            const idleX = idlePositionRef.current.x;
            const idleY = idlePositionRef.current.y;

            // Calculate absolute position for processing state
            const processingX =
              idleX - (PROCESSING_SIZE.width - IDLE_SIZE.width) / 2;
            const processingY = idleY - HEIGHT_DIFF;

            // CRITICAL: Resize FIRST, then position SECOND
            await window.setSize(
              new LogicalSize(PROCESSING_SIZE.width, PROCESSING_SIZE.height),
            );
            await window.setPosition(
              new LogicalPosition(processingX, processingY),
            );
          } catch (e) {
            console.error("Failed to expand to processing size:", e);
          }
        });

        // Listen for action recording stopped (same behavior as regular recording)
        const unlistenActionStopped = await listen(
          "action_recording_stopped",
          async () => {
            setStatus("processing");
            // Expand width for processing (to fit bars + loader)
            const window = getCurrentWindow();
            try {
              if (!idlePositionRef.current) {
                console.error("Idle position not initialized");
                return;
              }

              const idleX = idlePositionRef.current.x;
              const idleY = idlePositionRef.current.y;

              // Calculate absolute position for processing state
              const processingX =
                idleX - (PROCESSING_SIZE.width - IDLE_SIZE.width) / 2;
              const processingY = idleY - HEIGHT_DIFF;

              // CRITICAL: Resize FIRST, then position SECOND
              await window.setSize(
                new LogicalSize(PROCESSING_SIZE.width, PROCESSING_SIZE.height),
              );
              await window.setPosition(
                new LogicalPosition(processingX, processingY),
              );
            } catch (e) {
              console.error("Failed to expand to processing size:", e);
            }
          },
        );

        // Listen for processing start
        const unlistenProcessing = await listen(
          "processing_start",
          async () => {
            setStatus("processing");
            // Expand width for processing (to fit bars + loader)
            const window = getCurrentWindow();
            try {
              if (!idlePositionRef.current) {
                console.error("Idle position not initialized");
                return;
              }

              const idleX = idlePositionRef.current.x;
              const idleY = idlePositionRef.current.y;

              // Calculate absolute position for processing state
              const processingX =
                idleX - (PROCESSING_SIZE.width - IDLE_SIZE.width) / 2;
              const processingY = idleY - HEIGHT_DIFF;

              // CRITICAL: Resize FIRST, then position SECOND
              await window.setSize(
                new LogicalSize(PROCESSING_SIZE.width, PROCESSING_SIZE.height),
              );
              await window.setPosition(
                new LogicalPosition(processingX, processingY),
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

            // Return to exact idle position - no calculations, just restore reference
            const window = getCurrentWindow();
            try {
              if (!idlePositionRef.current) {
                console.error("Idle position not initialized");
                return;
              }

              console.log(
                `📍 Returning to idle: (${idlePositionRef.current.x.toFixed(2)}, ${idlePositionRef.current.y.toFixed(2)})`,
              );

              // CRITICAL: Resize FIRST, then position SECOND
              await window.setSize(
                new LogicalSize(IDLE_SIZE.width, IDLE_SIZE.height),
              );
              await window.setPosition(
                new LogicalPosition(
                  idlePositionRef.current.x,
                  idlePositionRef.current.y,
                ),
              );

              // Verify position after setting and update reference if needed
              const physicalPos = await window.outerPosition();
              const scaleFactor = await window.scaleFactor();
              const actualX = physicalPos.x / scaleFactor;
              const actualY = physicalPos.y / scaleFactor;

              const dx = Math.abs(actualX - idlePositionRef.current.x);
              const dy = Math.abs(actualY - idlePositionRef.current.y);

              if (dx > 0.1 || dy > 0.1) {
                console.warn(
                  `⚠️  Position drift detected: expected=(${idlePositionRef.current.x.toFixed(2)}, ${idlePositionRef.current.y.toFixed(2)}), actual=(${actualX.toFixed(2)}, ${actualY.toFixed(2)}), diff=(${dx.toFixed(2)}, ${dy.toFixed(2)})`,
                );
                // Update reference to actual position to prevent accumulation
                idlePositionRef.current = { x: actualX, y: actualY };
              } else {
                console.log(
                  `✅ Position verified: drift=(${dx.toFixed(3)}, ${dy.toFixed(3)}) px`,
                );
              }
            } catch (e) {
              console.error("Failed to shrink window:", e);
            }
          },
        );

        // Listen for transcription error
        const unlistenError = await listen("transcription_error", async () => {
          setStatus("idle");

          // Return to exact idle position
          const window = getCurrentWindow();
          try {
            if (!idlePositionRef.current) {
              console.error("Idle position not initialized");
              return;
            }

            await window.setSize(
              new LogicalSize(IDLE_SIZE.width, IDLE_SIZE.height),
            );
            // Restore exact idle position from reference
            await window.setPosition(
              new LogicalPosition(
                idlePositionRef.current.x,
                idlePositionRef.current.y,
              ),
            );
          } catch (e) {
            console.error("Failed to shrink window:", e);
          }
        });

        // Listen for recording skipped (e.g. too short) — go back to idle without processing
        const unlistenSkipped = await listen("recording_skipped", async () => {
          setStatus("idle");
          const window = getCurrentWindow();
          try {
            if (!idlePositionRef.current) {
              console.error("Idle position not initialized");
              return;
            }

            await window.setSize(
              new LogicalSize(IDLE_SIZE.width, IDLE_SIZE.height),
            );
            // Restore exact idle position from reference
            await window.setPosition(
              new LogicalPosition(
                idlePositionRef.current.x,
                idlePositionRef.current.y,
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

            // Return to exact idle position
            const window = getCurrentWindow();
            try {
              if (!idlePositionRef.current) {
                console.error("Idle position not initialized");
                return;
              }

              await window.setSize(
                new LogicalSize(IDLE_SIZE.width, IDLE_SIZE.height),
              );
              // Restore exact idle position from reference
              await window.setPosition(
                new LogicalPosition(
                  idlePositionRef.current.x,
                  idlePositionRef.current.y,
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

          // Return to exact idle position
          const window = getCurrentWindow();
          try {
            if (!idlePositionRef.current) {
              console.error("Idle position not initialized");
              return;
            }

            await window.setSize(
              new LogicalSize(IDLE_SIZE.width, IDLE_SIZE.height),
            );
            // Restore exact idle position from reference
            await window.setPosition(
              new LogicalPosition(
                idlePositionRef.current.x,
                idlePositionRef.current.y,
              ),
            );
          } catch (e) {
            console.error("Failed to shrink window:", e);
          }
        });

        // Listen for action recording error (from recording thread)
        const unlistenActionRecordingError = await listen(
          "action_recording_error",
          async () => {
            setStatus("idle");

            // Return to exact idle position
            const window = getCurrentWindow();
            try {
              if (!idlePositionRef.current) {
                console.error("Idle position not initialized");
                return;
              }

              await window.setSize(
                new LogicalSize(IDLE_SIZE.width, IDLE_SIZE.height),
              );
              // Restore exact idle position from reference
              await window.setPosition(
                new LogicalPosition(
                  idlePositionRef.current.x,
                  idlePositionRef.current.y,
                ),
              );
            } catch (e) {
              console.error("Failed to shrink window:", e);
            }
          },
        );

        // Cleanup function
        return () => {
          unlistenTriggered();
          unlistenCancelled();
          unlistenStarted();
          unlistenStopped();
          unlistenProcessing();
          unlistenSuccess();
          unlistenError();
          unlistenSkipped();
          if (unlistenVolume) {
            unlistenVolume();
          }
          unlistenActionSuccess();
          unlistenActionError();
          unlistenModeChanged();
          unlistenActionStarted();
          unlistenActionStopped();
          unlistenActionRecordingError();
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

      // Note: startDragging() is async but returns immediately,
      // it doesn't wait for drag completion. We can't update position here.
      // Instead, we'll update the reference when returning to idle state.
      await window.startDragging();
    } catch (error) {
      console.error("Failed to start dragging:", error);
    }
  };

  // Waveform icon SVG - individual bars that respond to audio levels (color from CSS .pill__icon-wrap)
  const WaveformIcon = ({
    size = 20,
    audioLevels = [],
  }: {
    size?: number;
    audioLevels?: number[];
  }) => {
    const numBars = 5;
    const barWidth = 2.8;
    const barSpacing = 2;
    const maxBarHeight = size * 0.75;
    const minBarHeight = size * 0.22;
    const containerWidth = size * 0.95;
    const containerHeight = size * 0.85;
    const startX = (size - containerWidth) / 2;
    const startY = (size - containerHeight) / 2;

    const hasAudio =
      audioLevels.length > 0 && audioLevels.some((level) => level > 0.25);

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
              fill="currentColor"
              rx={barWidth / 2}
              className={hasAudio ? "pill__waveform-bar--animated" : undefined}
            />
          );
        })}
      </svg>
    );
  };

  // Loader icon SVG (color from CSS .pill__icon-wrap)
  const LoaderIcon = ({ size = 20 }: { size?: number }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pill__loader"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );

  const pillClassName = [
    "pill",
    status === "idle" && "pill--idle",
    status === "recording" && "pill--recording",
    status === "processing" && "pill--processing",
    isHovered && "pill--hovered",
    (status === "recording" || status === "processing") &&
      recordingMode === "action" &&
      "pill--action-mode",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={pillClassName}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {status !== "idle" && (
        <div className="pill__icon-wrap">
          {status === "processing" ? (
            <>
              <WaveformIcon size={22} audioLevels={[]} />
              <LoaderIcon size={14} />
            </>
          ) : (
            <WaveformIcon size={26} audioLevels={smoothedLevels} />
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
    <div className="pill-app">
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
