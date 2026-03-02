/**
 * Pill Window Entry Point
 *
 * This is the entry point for the pill overlay window.
 * It renders a minimal React component that displays the current
 * recording/processing status as a small overlay at the bottom of the screen.
 */

import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
// import { playSound } from "./lib/soundUtils";
// Note: Do NOT import index.css here - it adds opaque backgrounds that break transparency

// Window size constants — window matches pill exactly in each state (no extra space)
const IDLE_SIZE = { width: 50, height: 6.6 };
const RECORDING_SIZE = { width: 80, height: 36 };
const MEETING_DETECTED_SIZE = { width: 130, height: 52 }; // Larger pill for meeting prompt
const PROCESSING_SIZE = { width: 100, height: 36 };
const SPEAKING_SIZE = { width: 90, height: 36 }; // Speaking/TTS state
const MEETING_COUNTDOWN_SECONDS = 8;
// Height difference for position adjustment (to make pill grow upward)
const HEIGHT_DIFF = RECORDING_SIZE.height - IDLE_SIZE.height;

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
interface MeetingDetectedPayload {
  platform: string;
}

export const Pill: React.FC = () => {
  const [status, setStatus] = useState<
    "idle" | "recording" | "processing" | "speaking" | "meeting_detected"
  >("idle");
  const [isActionMode, setIsActionMode] = useState(false); // Track if action hotkey is active
  const [isHovered, setIsHovered] = useState(false);
  const [audioLevels, setAudioLevels] = useState<number[]>([]);
  const [smoothedLevels, setSmoothedLevels] = useState<number[]>([]);
  const [meetingContext, setMeetingContext] = useState<MeetingDetectedPayload | null>(null);
  const [meetingCountdown, setMeetingCountdown] = useState(0); // 0 = not in countdown, 1–5 = seconds left
  const isRecordingRef = useRef(false);
  const hasRealAudioRef = useRef(false); // Track if we're receiving real volume data
  const lastVolumeTimeRef = useRef(0); // Track when we last received volume data
  // Single source of truth for idle position - prevents position drift from accumulated rounding errors
  const idlePositionRef = useRef<{ x: number; y: number } | null>(null);
  const startingMeetingRef = useRef(false);

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

    const numBars = 7; // Match WaveformIcon numBars
    // Start with static idle bars at fixed height — no animation
    setAudioLevels(Array(numBars).fill(0.35));

    // Fallback: if we don't receive real audio data, keep bars static
    let animationFrameId: number;
    const idleCheck = () => {
      const timeSinceLastVolume = Date.now() - lastVolumeTimeRef.current;
      if (timeSinceLastVolume > 150) {
        // No recent audio data — keep bars at fixed static height
        setAudioLevels(Array(numBars).fill(0.35));
      }
      animationFrameId = requestAnimationFrame(idleCheck);
    };

    animationFrameId = requestAnimationFrame(idleCheck);

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [status]);

  // Reset pill to idle size and position (used for meeting_detected timeout or after start)
  const resetPillToIdle = React.useCallback(async () => {
    setStatus("idle");
    setMeetingContext(null);
    setMeetingCountdown(0);
    const window = getCurrentWindow();
    try {
      if (!idlePositionRef.current) return;
      await window.setSize(new LogicalSize(IDLE_SIZE.width, IDLE_SIZE.height));
      await window.setPosition(
        new LogicalPosition(idlePositionRef.current.x, idlePositionRef.current.y),
      );
    } catch (e) {
      console.error("Failed to reset pill to idle:", e);
    }
  }, []);

  // 5-second countdown when in meeting_detected: when it hits 0, return to idle
  const meetingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (status !== "meeting_detected") return;
    meetingIntervalRef.current = setInterval(() => {
      setMeetingCountdown((prev) => {
        if (prev <= 1) {
          if (meetingIntervalRef.current) {
            clearInterval(meetingIntervalRef.current);
            meetingIntervalRef.current = null;
          }
          resetPillToIdle();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (meetingIntervalRef.current) {
        clearInterval(meetingIntervalRef.current);
        meetingIntervalRef.current = null;
      }
    };
  }, [status, resetPillToIdle]);

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
        // Listen for recording started
        const unlistenStarted = await listen("recording_started", async () => {
          setStatus("recording");
          // Play sound immediately for instant feedback (non-blocking)
          // playSound("processing");

          // Expand window upward using absolute positioning from idle reference
          const window = getCurrentWindow();
          try {
            if (!idlePositionRef.current) {
              console.error("Idle position not initialized");
              return;
            }

            const idleX = idlePositionRef.current.x;
            const idleY = idlePositionRef.current.y;

            const recX = idleX - (RECORDING_SIZE.width - IDLE_SIZE.width) / 2;
            const recY = idleY - HEIGHT_DIFF;

            console.log(
              `📍 Recording: idle=(${idleX.toFixed(2)}, ${idleY.toFixed(2)}) → rec=(${recX.toFixed(2)}, ${recY.toFixed(2)})`,
            );

            await window.setSize(
              new LogicalSize(RECORDING_SIZE.width, RECORDING_SIZE.height),
            );
            await window.setPosition(new LogicalPosition(recX, recY));
          } catch (e) {
            console.error("Failed to expand window:", e);
          }
        });

        // Listen for action recording started
        const unlistenActionStarted = await listen(
          "action_recording_started",
          async () => {
            setStatus("recording");
            setIsActionMode(true);

            const window = getCurrentWindow();
            try {
              if (!idlePositionRef.current) {
                console.error("Idle position not initialized");
                return;
              }

              const idleX = idlePositionRef.current.x;
              const idleY = idlePositionRef.current.y;

              const recX = idleX - (RECORDING_SIZE.width - IDLE_SIZE.width) / 2;
              const recY = idleY - HEIGHT_DIFF;

              await window.setSize(
                new LogicalSize(RECORDING_SIZE.width, RECORDING_SIZE.height),
              );
              await window.setPosition(new LogicalPosition(recX, recY));
            } catch (e) {
              console.error("Failed to expand window:", e);
            }
          },
        );

        // Listen for recording stopped — resize window to processing size
        const unlistenStopped = await listen("recording_stopped", async () => {
          setStatus("processing");
          const window = getCurrentWindow();
          try {
            if (!idlePositionRef.current) return;
            const idleX = idlePositionRef.current.x;
            const idleY = idlePositionRef.current.y;
            const procX = idleX - (PROCESSING_SIZE.width - IDLE_SIZE.width) / 2;
            const procY = idleY - HEIGHT_DIFF;
            await window.setSize(
              new LogicalSize(PROCESSING_SIZE.width, PROCESSING_SIZE.height),
            );
            await window.setPosition(new LogicalPosition(procX, procY));
          } catch (e) {
            console.error("Failed to resize to processing:", e);
          }
        });

        // Listen for action recording stopped
        const unlistenActionStopped = await listen(
          "action_recording_stopped",
          async () => {
            setStatus("processing");
            const window = getCurrentWindow();
            try {
              if (!idlePositionRef.current) return;
              const idleX = idlePositionRef.current.x;
              const idleY = idlePositionRef.current.y;
              const procX =
                idleX - (PROCESSING_SIZE.width - IDLE_SIZE.width) / 2;
              const procY = idleY - HEIGHT_DIFF;
              await window.setSize(
                new LogicalSize(PROCESSING_SIZE.width, PROCESSING_SIZE.height),
              );
              await window.setPosition(new LogicalPosition(procX, procY));
            } catch (e) {
              console.error("Failed to resize to processing:", e);
            }
          },
        );

        // Listen for processing start — status only; resize is done in
        // recording_stopped/action_recording_stopped to avoid double-resize race.
        const unlistenProcessing = await listen("processing_start", () => {
          setStatus("processing");
        });

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
              const numBars = 7; // Match WaveformIcon numBars
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
            setIsActionMode(false); // Disable action mode indicator

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
          setIsActionMode(false); // Disable action mode indicator

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
            setIsActionMode(false); // Disable action mode indicator

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

        // Listen for TTS speaking — Lexi is speaking back
        const unlistenTtsSpeaking = await listen("tts_speaking", async () => {
          setStatus("speaking");
          const window = getCurrentWindow();
          try {
            if (!idlePositionRef.current) return;
            const idleX = idlePositionRef.current.x;
            const idleY = idlePositionRef.current.y;
            const speakX = idleX - (SPEAKING_SIZE.width - IDLE_SIZE.width) / 2;
            const speakY = idleY - HEIGHT_DIFF;
            await window.setSize(
              new LogicalSize(SPEAKING_SIZE.width, SPEAKING_SIZE.height),
            );
            await window.setPosition(new LogicalPosition(speakX, speakY));
          } catch (e) {
            console.error("Failed to resize for speaking:", e);
          }
        });

        // Listen for TTS success — done speaking, return to idle
        const unlistenTtsSuccess = await listen("tts_success", async () => {
          setStatus("idle");
          setIsActionMode(false);
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
            console.error("Failed to shrink after TTS:", e);
          }
        });

        // Listen for TTS error — done speaking (failed), return to idle
        const unlistenTtsError = await listen("tts_error", async () => {
          setStatus("idle");
          setIsActionMode(false);
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
            console.error("Failed to shrink after TTS error:", e);
          }
        });

        // Listen for meeting detected — show pill with 5s countdown, click to start
        const unlistenMeetingDetected = await listen(
          "meeting-detected",
          async (event: { payload: MeetingDetectedPayload }) => {
            const payload = event.payload as MeetingDetectedPayload;
            setMeetingContext(payload);
            setMeetingCountdown(MEETING_COUNTDOWN_SECONDS);
            setStatus("meeting_detected");

            const window = getCurrentWindow();
            try {
              if (!idlePositionRef.current) return;
              const idleX = idlePositionRef.current.x;
              const idleY = idlePositionRef.current.y;
              const w = MEETING_DETECTED_SIZE.width;
              const h = MEETING_DETECTED_SIZE.height;
              const meetingX = idleX - (w - IDLE_SIZE.width) / 2;
              const meetingY = idleY - (h - IDLE_SIZE.height);
              await window.setSize(new LogicalSize(w, h));
              await window.setPosition(new LogicalPosition(meetingX, meetingY));
            } catch (e) {
              console.error("Failed to expand for meeting prompt:", e);
            }
          },
        );

        // Cleanup function
        return () => {
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
          unlistenActionStarted();
          unlistenActionStopped();
          unlistenActionRecordingError();
          unlistenTtsSpeaking();
          unlistenTtsSuccess();
          unlistenTtsError();
          unlistenMeetingDetected();
        };
      } catch (error) {
        console.error("Failed to set up event listeners:", error);
      }
    };

    setupListeners();
  }, []);

  const startMeetingFromPill = async () => {
    if (startingMeetingRef.current || !meetingContext) return;
    startingMeetingRef.current = true;
    try {
      const platform = meetingContext.platform?.trim() || "Lexi AI";
      const name = platform ? `${platform} Meeting` : "Meeting";
      const meeting = await invoke<{ id: string }>("create_meeting", {
        name,
        platform,
      });
      await invoke("start_meeting_recording", { meetingId: meeting.id });
      await emit("meeting-recording-started", { meetingId: meeting.id });
      await invoke("show_main_window");
      // Backend hides pill on start; reset state so when pill is shown again we're idle
      await resetPillToIdle();
    } catch (e) {
      console.error("Failed to start meeting from pill:", e);
      await resetPillToIdle();
    } finally {
      startingMeetingRef.current = false;
    }
  };

  const handleMouseDown = async (e: React.MouseEvent) => {
    if (status === "meeting_detected") {
      e.preventDefault();
      await startMeetingFromPill();
      return;
    }
    // Start dragging the window when clicking on the pill
    try {
      const window = getCurrentWindow();
      await window.startDragging();
    } catch (error) {
      console.error("Failed to start dragging:", error);
    }
  };

  // Waveform icon SVG - individual bars that respond to audio levels
  // Uses separate width/height so bars fill the pill properly
  const WaveformIcon = ({
    width: svgWidth = 48,
    height: svgHeight = 24,
    audioLevels = [],
  }: {
    width?: number;
    height?: number;
    color?: string;
    audioLevels?: number[];
  }) => {
    const numBars = 7;
    const barWidth = 3;
    const barSpacing = 2.5;
    const maxBarHeight = svgHeight * 0.9;
    const minBarHeight = svgHeight * 0.18;

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

    const barHeights = resampledLevels.map((level, i) => {
      // Natural curve — middle bars taller
      const curveFactor = Math.sin((i / (numBars - 1)) * Math.PI);
      const curvedLevel = level * (0.65 + curveFactor * 0.35);
      return (
        minBarHeight +
        (maxBarHeight - minBarHeight) * Math.max(0.12, curvedLevel)
      );
    });

    const totalBarsWidth = numBars * barWidth + (numBars - 1) * barSpacing;
    const barsStartX = (svgWidth - totalBarsWidth) / 2;

    return (
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        fill="none"
      >
        {barHeights.map((height, index) => {
          const x = barsStartX + index * (barWidth + barSpacing);
          const y = (svgHeight - height) / 2;

          return (
            <rect
              key={index}
              x={x}
              y={y}
              width={barWidth}
              height={height}
              fill="rgba(255, 255, 255, 0.9)"
              rx={barWidth / 2}
              style={{
                transition: hasAudio
                  ? "height 0.08s cubic-bezier(0.4, 0, 0.2, 1), y 0.08s cubic-bezier(0.4, 0, 0.2, 1)"
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
      return "rgba(0, 0, 0, 0.95)";
    }
    return "rgba(0, 0, 0, 0.9)";
  };

  // Build base style object
  const baseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "move",
    // Separate transitions for smooth size + shadow changes
    transition: [
      "width 0.4s cubic-bezier(0.32, 0.72, 0, 1)",
      "height 0.4s cubic-bezier(0.32, 0.72, 0, 1)",
      "border-radius 0.4s cubic-bezier(0.32, 0.72, 0, 1)",
      "box-shadow 0.3s ease-out",
      "border 0.3s ease-out",
      "background-color 0.3s ease-out",
      "transform 0.2s ease-out",
      "opacity 0.3s ease-out",
    ].join(", "),
    transform: isHovered ? "scale(1.02)" : "scale(1)",
    transformOrigin: "center bottom",
    userSelect: "none",
    backgroundColor: getBackgroundColor(),
    pointerEvents: "auto",
    position: "relative",
    overflow: "visible",
    boxSizing: "border-box",
    flexShrink: 0,
  };

  // Apply state-specific styles — pill fills 100% of window (window = pill)
  if (status === "idle") {
    baseStyle.width = "50px";
    baseStyle.height = "6.6px";
    baseStyle.borderRadius = "3.3px";
    baseStyle.border = "none";
    baseStyle.boxShadow = "none";
  } else if (status === "recording") {
    baseStyle.width = "100%";
    baseStyle.height = "100%";
    baseStyle.borderRadius = "18px";
    baseStyle.border = "1px solid rgba(255, 255, 255, 0.1)";
    baseStyle.boxShadow = "none";
  } else if (status === "processing") {
    baseStyle.width = "100%";
    baseStyle.height = "100%";
    baseStyle.borderRadius = "18px";
    baseStyle.border = "1px solid rgba(255, 255, 255, 0.1)";
    baseStyle.boxShadow = "none";
  } else if (status === "speaking") {
    baseStyle.width = "100%";
    baseStyle.height = "100%";
    baseStyle.borderRadius = "18px";
    baseStyle.border = "1px solid rgba(255, 255, 255, 0.1)";
    baseStyle.boxShadow = "none";
  } else if (status === "meeting_detected") {
    baseStyle.width = "100%";
    baseStyle.height = "100%";
    baseStyle.borderRadius = "18px";
    baseStyle.border = "1px solid rgba(255, 255, 255, 0.1)";
    baseStyle.boxShadow = "none";
    baseStyle.cursor = "pointer";
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={baseStyle}
    >
      {/* Chasing border light — color changes based on state */}
      {status !== "idle" &&
        (() => {
          // Pick colors based on state
          let color1: string, color2: string, color3: string, speed: string;
          if (status === "meeting_detected") {
            // Meeting prompt: amber
            color1 = "#f59e0b"; // Amber
            color2 = "#fcd34d"; // Light amber
            color3 = "rgba(245, 158, 11, 0.1)";
            speed = "2s";
          } else if (status === "speaking") {
            // Speaking/TTS: purple
            color1 = "#a855f7"; // Purple
            color2 = "#d8b4fe"; // Light purple
            color3 = "rgba(168, 85, 247, 0.1)";
            speed = "1.8s";
          } else if (status === "processing") {
            // Processing: cool blue/cyan
            color1 = "#3b82f6"; // Blue
            color2 = "#93c5fd"; // Light blue
            color3 = "rgba(59, 130, 246, 0.1)";
            speed = "1.5s";
          } else if (isActionMode) {
            // Smart actions: warm orange
            color1 = "#f97316"; // Orange
            color2 = "#fdba74"; // Light orange
            color3 = "rgba(249, 115, 22, 0.1)";
            speed = "2s";
          } else {
            // Normal recording: green
            color1 = "#22c55e"; // Green
            color2 = "#86efac"; // Light green
            color3 = "rgba(34, 197, 94, 0.1)";
            speed = "2s";
          }

          return (
            <>
              <style>
                {`
                @keyframes borderFlow {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}
              </style>
              {/* Outer glow container */}
              <div
                style={{
                  position: "absolute",
                  inset: "-2px",
                  borderRadius: "20px",
                  overflow: "hidden",
                  pointerEvents: "none",
                }}
              >
                {/* Rotating gradient that creates the chasing effect */}
                <div
                  style={{
                    position: "absolute",
                    inset: "-50%",
                    background: `conic-gradient(from 0deg, transparent 0deg, transparent 30deg, ${color3} 80deg, ${color1} 150deg, ${color2} 180deg, ${color1} 210deg, ${color3} 280deg, transparent 330deg, transparent 360deg)`,
                    animation: `borderFlow ${speed} linear infinite`,
                  }}
                />
              </div>
              {/* Inner black fill to mask center, creating border effect */}
              <div
                style={{
                  position: "absolute",
                  inset: "0",
                  borderRadius: "18px",
                  backgroundColor: "rgba(0, 0, 0, 0.9)",
                  pointerEvents: "none",
                }}
              />
            </>
          );
        })()}

      {/* Icon container - only show for active states */}
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
            gap: "6px",
            padding: "0 4px",
          }}
        >
          {status === "meeting_detected" ? (
            /* Meeting detected: reverse circular loader, click to start */
            (() => {
              const size = 30;
              const stroke = 3;
              const r = (size - stroke) / 2;
              const circumference = 2 * Math.PI * r;
              const secondsLeft = Math.max(0, meetingCountdown);
              const progress = secondsLeft / MEETING_COUNTDOWN_SECONDS;
              const offset = circumference * (1 - progress);
              return (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                  }}
                >
                  <div style={{ position: "relative", width: size, height: size }}>
                    <svg
                      width={size}
                      height={size}
                      viewBox={`0 0 ${size} ${size}`}
                      style={{ transform: "rotate(-90deg)" }}
                    >
                      <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={r}
                        fill="none"
                        stroke="rgba(255,255,255,0.15)"
                        strokeWidth={stroke}
                      />
                      <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={r}
                        fill="none"
                        stroke="rgba(255,255,255,0.95)"
                        strokeWidth={stroke}
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        style={{
                          transition: "stroke-dashoffset 0.35s ease-out",
                        }}
                      />
                    </svg>
                  </div>
                  <span style={{ fontSize: 10, opacity: 0.9 }}>Click to start</span>
                </div>
              );
            })()
          ) : status === "speaking" ? (
            /* Speaking: Lexi is talking — speaker icon with animated sound arcs */
            <>
              <style>
                {`
                  @keyframes speakPulse1 {
                    0%, 100% { opacity: 0.3; transform: scale(0.95); }
                    50% { opacity: 1; transform: scale(1.05); }
                  }
                  @keyframes speakPulse2 {
                    0%, 100% { opacity: 0.2; transform: scale(0.9); }
                    50% { opacity: 0.8; transform: scale(1.1); }
                  }
                `}
              </style>
              <svg width={50} height={26} viewBox="0 0 50 26" fill="none">
                {/* Speaker icon */}
                <path d="M12 8L8 11H5v4h3l4 3V8z" fill="white" opacity={0.9} />
                {/* Sound arc 1 — close */}
                <path
                  d="M18 9.5c1.5 1.2 2.5 3 2.5 5s-1 3.8-2.5 5"
                  stroke="white"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  fill="none"
                  opacity={0.8}
                  style={{
                    animation: "speakPulse1 1.2s ease-in-out infinite",
                    transformOrigin: "16px 13px",
                  }}
                />
                {/* Sound arc 2 — far */}
                <path
                  d="M22 6.5c2.5 2 4 5 4 7.5s-1.5 5.5-4 7.5"
                  stroke="white"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  fill="none"
                  opacity={0.5}
                  style={{
                    animation: "speakPulse2 1.2s ease-in-out 0.3s infinite",
                    transformOrigin: "20px 13px",
                  }}
                />
                {/* Dots that pulse — representing speech */}
                <circle
                  cx="33"
                  cy="10"
                  r="1.5"
                  fill="white"
                  opacity={0.6}
                  style={{ animation: "speakPulse1 0.8s ease-in-out infinite" }}
                />
                <circle
                  cx="37"
                  cy="13"
                  r="1.5"
                  fill="white"
                  opacity={0.8}
                  style={{
                    animation: "speakPulse1 0.8s ease-in-out 0.15s infinite",
                  }}
                />
                <circle
                  cx="41"
                  cy="10"
                  r="1.5"
                  fill="white"
                  opacity={0.6}
                  style={{
                    animation: "speakPulse1 0.8s ease-in-out 0.3s infinite",
                  }}
                />
              </svg>
            </>
          ) : status === "processing" ? (
            <>
              {/* Processing: bars + loader */}
              <WaveformIcon width={52} height={22} audioLevels={[]} />
              <LoaderIcon size={14} color="white" />
            </>
          ) : (
            /* Recording: bars fill the pill */
            <WaveformIcon width={56} height={26} audioLevels={smoothedLevels} />
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
        borderRadius: "18px",
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
