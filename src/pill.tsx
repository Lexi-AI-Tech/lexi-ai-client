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
import { useUpdaterStore } from "./store/updaterStore";
import { relaunch } from "@tauri-apps/plugin-process";
import { AlertCircle } from "lucide-react";
// import { playSound } from "./lib/soundUtils";
// Note: Do NOT import index.css here - it adds opaque backgrounds that break transparency
import "./pill.css";

// Window size constants — window matches pill exactly in each state (no extra space)
// Sized to fit the "Glass Frosted" design's text labels + larger meeting card.
const IDLE_SIZE = { width: 50, height: 6.6 };
const RECORDING_SIZE = { width: 158, height: 46 };
const MEETING_DETECTED_SIZE = { width: 248, height: 138 }; // Larger card for meeting prompt
const PROCESSING_SIZE = { width: 148, height: 46 };
const SPEAKING_SIZE = { width: 138, height: 46 }; // Speaking/TTS state
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
  const [isPressed, setIsPressed] = useState(false); // Subtle press-down feedback on click
  const [audioLevels, setAudioLevels] = useState<number[]>([]);
  const [smoothedLevels, setSmoothedLevels] = useState<number[]>([]);
  const [meetingContext, setMeetingContext] =
    useState<MeetingDetectedPayload | null>(null);
  const [meetingCountdown, setMeetingCountdown] = useState(0); // 0 = not in countdown, 1–5 = seconds left
  const isRecordingRef = useRef(false);
  const statusRef = useRef(status); // Live status snapshot for listeners set up once on mount
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

  // Reset audio levels when not recording, and sync idle status to the global updater
  useEffect(() => {
    statusRef.current = status;
    isRecordingRef.current = status === "recording";

    // Tell the global updater whether the app is currently in use (so it doesn't forcefully restart)
    useUpdaterStore.getState().setIsAppBusy(status !== "idle");

    if (status === "idle") {
      // If we just became idle and a patch update finished downloading in the background, reboot now!
      if (useUpdaterStore.getState().isPatchRebootPending) {
        console.log(
          "🔄 App has returned to idle and a patch update is waiting. Restarting now...",
        );
        setTimeout(() => relaunch(), 1500); // 1.5s visual delay before jarring restart so animations have time to settle
      }
    }

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
        new LogicalPosition(
          idlePositionRef.current.x,
          idlePositionRef.current.y,
        ),
      );
    } catch (e) {
      console.error("Failed to reset pill to idle:", e);
    }
  }, []);

  // 5-second countdown when in meeting_detected: when it hits 0, return to idle
  const meetingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
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

  // Keep idlePositionRef in sync while the user drags the pill around.
  // Without this, dragging the idle pill to a new spot and then starting a
  // recording would snap it back to the position captured at mount time —
  // our own programmatic setPosition calls also fire onMoved, but those only
  // happen while status is already non-idle (or moving back to the same idle
  // spot), so gating on statusRef.current === "idle" only picks up real drags.
  useEffect(() => {
    let unlistenMoved: (() => void) | undefined;
    const setupMoveTracking = async () => {
      try {
        const window = getCurrentWindow();
        const scaleFactor = await window.scaleFactor();
        unlistenMoved = await window.onMoved(({ payload: position }) => {
          if (statusRef.current !== "idle") return;
          idlePositionRef.current = {
            x: position.x / scaleFactor,
            y: position.y / scaleFactor,
          };
        });
      } catch (e) {
        console.error("Failed to set up move tracking:", e);
      }
    };
    setupMoveTracking();
    return () => {
      if (unlistenMoved) unlistenMoved();
    };
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

        // WebView2 can stop painting the transparent pill after OS sleep until the surface is nudged.
        const unlistenPostResume = await listen(
          "pill_post_resume_refresh",
          () => {
            requestAnimationFrame(() => {
              const root = document.getElementById("root");
              if (!root) return;
              const prev = root.style.opacity;
              root.style.opacity = "0.999";
              requestAnimationFrame(() => {
                root.style.opacity = prev;
              });
            });
          },
        );

        // Meeting detected — show pill with countdown, click to start
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
          unlistenPostResume();
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
    } catch (e: unknown) {
      console.error("Failed to start meeting from pill:", e);
      const message =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : "Failed to start meeting";
      try {
        await emit("error", message);
      } catch (emitErr) {
        console.error("Failed to emit meeting error:", emitErr);
      }
      await resetPillToIdle();
    } finally {
      startingMeetingRef.current = false;
    }
  };

  const handleMouseDown = async () => {
    // Start dragging the window when clicking on the pill
    setIsPressed(true);
    try {
      const window = getCurrentWindow();
      await window.startDragging();
    } catch (error) {
      console.error("Failed to start dragging:", error);
    }
  };

  // Shared easing — same curve shadcn/Radix-style components use for hover/press
  // (size/position changes keep their own springier curve further down)
  const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

  // "Glass Frosted" design — ported 1:1 from the v0 pill-variations.tsx
  // export (PillGlass), now using real Tailwind utility classes (matches the
  // shared code's transition-all/backdrop-blur-xl/rounded-2xl exactly) so the
  // CSS-keyframe animations run on the GPU compositor instead of being
  // re-triggered by React state — that's what made the earlier inline-style
  // version feel less smooth than the source.
  const isGold = isActionMode && status === "recording";
  const accentHex = isGold ? "#c9a45c" : "#6b8f6e";
  const accentLightHex = isGold ? "#e0c088" : "#8ab98a";

  // NOTE: Tailwind's JIT scanner needs full static class strings present
  // verbatim in this file to generate their CSS — it can't resolve classes
  // built from an interpolated variable at runtime. So sage/gold variants
  // are spelled out in full below rather than templated from accentHex.
  const shapeClass =
    status === "meeting_detected" ? "rounded-3xl px-4 py-3" : "rounded-2xl px-4 py-3";
  const sageCardClass = `bg-gradient-to-br from-[#6b8f6e]/10 to-[#587a5b]/10 backdrop-blur-xl border-2 border-[#6b8f6e]/55 ${shapeClass}`;
  const goldCardClass = `bg-gradient-to-br from-[#c9a45c]/10 to-[#a9863f]/10 backdrop-blur-xl border-2 border-[#c9a45c]/55 ${shapeClass}`;
  const cardClass =
    status === "idle"
      ? isHovered
        ? "bg-[#6b8f6e]/16 backdrop-blur-md border-2 border-[#6b8f6e]/50 rounded-full"
        : "bg-[#6b8f6e]/5 backdrop-blur-md border-2 border-[#6b8f6e]/25 rounded-full"
      : isGold
        ? goldCardClass
        : sageCardClass;

  // Continuous GPU-driven bounce (matches v0's pillarBounce keyframes exactly)
  // gives the bars constant buttery motion; real mic level modulates a
  // transform: scaleY() on top via CSS transition, so audio reactivity never
  // fights the keyframe animation or causes layout thrash.
  const barKeyframeStyle = `
    @keyframes pillarBounce {
      0%, 100% { height: 6px; }
      50% { height: 20px; }
    }
    @keyframes pillSpeakBounce {
      0%, 100% { height: 8px; }
      50% { height: 16px; }
    }
  `;

  const resampleLevels = (levels: number[], count: number) =>
    levels.length > 0
      ? Array.from({ length: count }, (_, i) => {
          const src = Math.floor((i / count) * levels.length);
          return levels[src] ?? 0.35;
        })
      : Array(count).fill(0.35);

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseUp={() => setIsPressed(false)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsPressed(false);
      }}
      className={`relative w-full h-full flex items-center justify-center transition-all duration-300 ease-out ${cardClass}`}
      style={{
        cursor: "move",
        userSelect: "none",
        transform: isPressed
          ? "translateY(1px) scale(0.99)"
          : isHovered
            ? "scale(1.02)"
            : "scale(1)",
        transformOrigin: "center bottom",
        pointerEvents: "auto",
        boxSizing: "border-box",
        flexShrink: 0,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.22)",
      }}
    >
      <style>{barKeyframeStyle}</style>

      {status === "recording" && (
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 items-end h-5">
            {resampleLevels(smoothedLevels, 4).map((level, i) => (
              <div
                key={i}
                className="w-1.5 rounded-full"
                style={{
                  background: `linear-gradient(to top, ${accentHex}, ${accentLightHex})`,
                  animation: `pillarBounce 0.6s ease-in-out ${i % 2 === 1 ? "0.1s" : "0s"} infinite`,
                  transform: `scaleY(${0.7 + Math.max(0.15, level) * 0.6})`,
                  transformOrigin: "bottom",
                  transition: `transform 0.09s ${EASE}`,
                }}
              />
            ))}
          </div>
          <span
            className="text-xs font-bold ml-1"
            style={{ color: accentHex }}
          >
            {isGold ? "Action" : "Recording"}
          </span>
        </div>
      )}

      {status === "processing" && (
        <div className="flex items-center gap-2">
          <div className="animate-spin">
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <circle
                cx="12"
                cy="12"
                r="8"
                stroke="url(#pillLoaderGradient)"
                strokeWidth="5.5"
                strokeLinecap="round"
                strokeDasharray="12 38"
              />
              <defs>
                <linearGradient
                  id="pillLoaderGradient"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#6b8f6e" />
                  <stop offset="100%" stopColor="#8ab98a" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span className="text-xs font-bold text-[#6b8f6e]">
            Processing
          </span>
        </div>
      )}

      {status === "speaking" && (
        <div className="flex items-center gap-2">
          <div className="flex gap-1 items-end h-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-1 rounded-full"
                style={{
                  background: "linear-gradient(to top, #6b8f6e, #8ab98a)",
                  animation: `pillSpeakBounce ${0.5 + i * 0.1}s ease-in-out infinite`,
                }}
              />
            ))}
          </div>
          <span className="text-xs font-bold text-[#6b8f6e]">Speaking</span>
        </div>
      )}

      {status === "meeting_detected" && (
        <div className="flex flex-col gap-2 w-full">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-[#6b8f6e] animate-pulse shrink-0" />
            <span className="text-sm font-bold text-[#6b8f6e] truncate">
              {meetingContext?.platform || "Meeting"} detected
            </span>
          </div>
          <div className="text-xs text-[#587a5b] font-medium">
            Record this meeting?
          </div>
          <div className="flex gap-2 items-center">
            <button
              type="button"
              onMouseDown={(evt) => {
                evt.preventDefault();
                evt.stopPropagation();
              }}
              onClick={async (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                await startMeetingFromPill();
              }}
              className="flex-1 px-3 py-1.5 text-xs font-semibold bg-[#6b8f6e] hover:bg-[#587a5b] text-white rounded-lg transition-colors duration-200"
            >
              Record
            </button>
            <button
              type="button"
              onMouseDown={(evt) => {
                evt.preventDefault();
                evt.stopPropagation();
              }}
              onClick={async (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                await resetPillToIdle();
              }}
              className="flex-1 px-3 py-1.5 text-xs font-semibold bg-white/40 hover:bg-white/55 text-[#587a5b] rounded-lg transition-colors duration-200"
            >
              Skip
            </button>
          </div>
          <div className="text-[10px] text-[#587a5b]/70 text-center font-medium">
            Auto-recording in {meetingCountdown}s
          </div>
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
        fontFamily: "var(--lexi-font-body)",
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
