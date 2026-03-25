import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Mic,
  Keyboard,
  Sparkles,
  Check,
  Monitor,
  ChevronLeft,
  Volume2,
  AudioWaveform,
  Loader2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAuthStore } from "../../store/authStore";
import type { TauriAppConfig } from "../../types";
import { GoogleLoginButton } from "../auth/GoogleLoginButton";

const stepVariants = {
  initial: { opacity: 0, x: 10 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -10 },
};

const TYPEWRITER_WORDS = ["Thought.", "Speech.", "Sound.", "Voice."];

const TYPE_MS = 82;
const DELETE_MS = 42;
const PAUSE_MS = 2200;
const BETWEEN_MS = 320;

// Step 1: Welcome
export function WelcomeStep({
  onNext,
  onBack,
  showBack,
}: {
  onNext: () => void | Promise<void>;
  onBack?: () => void | Promise<void>;
  showBack?: boolean;
}) {
  const { isAuthenticated } = useAuthStore();
  const [wordIdx, setWordIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const word = TYPEWRITER_WORDS[wordIdx];
    let timeout: ReturnType<typeof setTimeout>;

    if (!deleting) {
      if (charIdx < word.length) {
        timeout = setTimeout(() => setCharIdx((c) => c + 1), TYPE_MS);
      } else {
        timeout = setTimeout(() => setDeleting(true), PAUSE_MS);
      }
    } else if (charIdx > 0) {
      timeout = setTimeout(() => setCharIdx((c) => c - 1), DELETE_MS);
    } else {
      timeout = setTimeout(() => {
        setDeleting(false);
        setWordIdx((i) => (i + 1) % TYPEWRITER_WORDS.length);
      }, BETWEEN_MS);
    }

    return () => clearTimeout(timeout);
  }, [charIdx, wordIdx, deleting]);

  const typedWord = TYPEWRITER_WORDS[wordIdx].slice(0, charIdx);

  return (
    <motion.div
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="onboarding-step-content"
    >
      <div className="step-header">
        <h1 className="step-title">Welcome to Lexi AI</h1>
        <p className="step-description">
          The voice-first OS that works across every app on your Mac.
        </p>
        <p className="step-description">
          Dictate, meet, write, act — all connected through your voice.
        </p>
        <p
          className="step-description step-description--typewriter"
          aria-label="Your work at the speed of thought, speech, sound, and voice."
        >
          <span className="typewriter-prefix">Your Work. At the Speed of </span>
          <span className="typewriter-dynamic">
            {typedWord}
            <span className="typewriter-cursor" aria-hidden />
          </span>
        </p>
      </div>

      <div className="features-list features-list--welcome">
        {[
          { icon: Keyboard, text: "Global shortcut" },
          { icon: AudioWaveform, text: "Voice to text" },
          { icon: Sparkles, text: "Instant results" },
        ].map((item, i) => (
          <div key={i} className="feature-item">
            <item.icon className="feature-icon" />
            <div>
              <p className="feature-title">{item.text}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="step-actions">
        <div className="step-actions-row">
          {showBack && onBack && (
            <button
              type="button"
              className="btn btn-outline btn-icon"
              onClick={onBack}
              aria-label="Back"
            >
              <ChevronLeft className="btn-icon-svg" />
            </button>
          )}
          {isAuthenticated ? (
            <button
              className={`btn btn-primary ${showBack ? "btn-flex-2" : "btn-full"}`}
              onClick={onNext}
            >
              Continue
            </button>
          ) : (
            <>
              <GoogleLoginButton
                onSuccess={() => console.log("Login successful")}
                onError={(err) => console.error("Login error:", err)}
              />
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// Step 2: Permissions
interface PermissionState {
  granted: boolean;
  checking: boolean;
}

export function PermissionsStep({
  onNext,
  onBack,
  onSkip,
  showBack,
}: {
  onNext: () => void | Promise<void>;
  onBack?: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
  showBack?: boolean;
}) {
  const [microphone, setMicrophone] = useState<PermissionState>({
    granted: false,
    checking: false,
  });
  const [accessibility, setAccessibility] = useState<PermissionState>({
    granted: false,
    checking: false,
  });
  const [inputMonitoring, setInputMonitoring] = useState<PermissionState>({
    granted: false,
    checking: false,
  });
  const [systemAudio, setSystemAudio] = useState<PermissionState>({
    granted: false,
    checking: false,
  });

  useEffect(() => {
    checkPermissions();
    const interval = setInterval(checkPermissions, 2000);
    return () => clearInterval(interval);
  }, []);

  const checkPermissions = async () => {
    try {
      const micGranted = await invoke<boolean>("check_microphone_permission");
      const accGranted = await invoke<boolean>(
        "check_accessibility_permission",
      );
      const inputGranted = await invoke<boolean>(
        "check_input_monitoring_permission",
      );
      const systemAudioGranted = await invoke<boolean>(
        "check_system_audio_permission",
      );

      setMicrophone((prev) => ({ ...prev, granted: micGranted }));
      setAccessibility((prev) => ({ ...prev, granted: accGranted }));
      setInputMonitoring((prev) => ({ ...prev, granted: inputGranted }));
      setSystemAudio((prev) => ({ ...prev, granted: systemAudioGranted }));
    } catch (error) {
      console.error("Failed to check permissions:", error);
    }
  };

  const requestMicrophone = async () => {
    setMicrophone((prev) => ({ ...prev, checking: true }));
    try {
      await invoke<boolean>("request_microphone_permission");
      setTimeout(checkPermissions, 1000);
    } catch (error) {
      console.error("Failed to request microphone permission:", error);
    } finally {
      setMicrophone((prev) => ({ ...prev, checking: false }));
    }
  };

  const requestAccessibility = async () => {
    setAccessibility((prev) => ({ ...prev, checking: true }));
    try {
      await invoke<boolean>("request_accessibility_permission");
      setTimeout(checkPermissions, 1000);
    } catch (error) {
      console.error("Failed to request accessibility permission:", error);
    } finally {
      setAccessibility((prev) => ({ ...prev, checking: false }));
    }
  };

  const requestInputMonitoring = async () => {
    setInputMonitoring((prev) => ({ ...prev, checking: true }));
    try {
      await invoke<boolean>("request_input_monitoring_permission");
      setTimeout(checkPermissions, 1000);
    } catch (error) {
      console.error("Failed to request input monitoring permission:", error);
    } finally {
      setInputMonitoring((prev) => ({ ...prev, checking: false }));
    }
  };

  const requestSystemAudio = async () => {
    setSystemAudio((prev) => ({ ...prev, checking: true }));
    try {
      await invoke<boolean>("request_system_audio_permission");
      setTimeout(checkPermissions, 1000);
    } catch (error) {
      console.error("Failed to request system audio permission:", error);
    } finally {
      setSystemAudio((prev) => ({ ...prev, checking: false }));
    }
  };

  const allGranted =
    microphone.granted &&
    accessibility.granted &&
    inputMonitoring.granted &&
    systemAudio.granted;

  const permissions = [
    {
      icon: Mic,
      title: "Microphone",
      desc: "Record your voice for transcription",
      state: microphone,
      request: requestMicrophone,
    },
    {
      icon: Keyboard,
      title: "Input Monitoring",
      desc: "For detecting hotkeys",
      state: inputMonitoring,
      request: requestInputMonitoring,
    },
    {
      icon: Monitor,
      title: "Accessibility",
      desc: "For typing into apps",
      state: accessibility,
      request: requestAccessibility,
    },
    {
      icon: Volume2,
      title: "System Audio",
      desc: "For capturing participant audio in meetings",
      state: systemAudio,
      request: requestSystemAudio,
    },
  ];

  const grantedCount = permissions.filter((p) => p.state.granted).length;

  return (
    <motion.div
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="onboarding-step-content onboarding-step-content--permissions"
    >
      <div className="step-header">
        <h1 className="step-title">Permissions</h1>
        <p className="step-description">
          Lexi AI needs access to these controls so it can listen, capture
          meetings, and type for you system-wide.
        </p>
        <div className="permissions-progress" aria-label="Permission progress">
          <div className="permissions-progress__track">
            <div
              className="permissions-progress__fill"
              style={{
                width: `${(grantedCount / permissions.length) * 100}%`,
              }}
            />
          </div>
          <span className="permissions-progress__label">
            {grantedCount} of {permissions.length} allowed
          </span>
        </div>
      </div>

      <div className="permissions-list">
        {permissions.map((item, i) => (
          <div
            key={i}
            className={[
              "permission-card",
              item.state.granted ? "permission-card--granted" : "",
              !item.state.granted ? "permission-card--clickable" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role={!item.state.granted ? "button" : undefined}
            tabIndex={!item.state.granted ? 0 : undefined}
            onClick={!item.state.granted ? item.request : undefined}
            onKeyDown={
              !item.state.granted
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      item.request();
                    }
                  }
                : undefined
            }
            aria-disabled={!item.state.granted && item.state.checking}
          >
            <div className="permission-info">
              <div className="permission-icon-wrapper">
                <item.icon className="permission-icon" />
              </div>
              <div>
                <h3 className="permission-title">{item.title}</h3>
                <p className="permission-desc">{item.desc}</p>
              </div>
            </div>
            {item.state.granted ? (
              <div className="permission-granted">
                <Check className="check-icon" strokeWidth={2.5} /> Allowed
              </div>
            ) : item.state.checking ? (
              <span className="permission-allow-hint permission-allow-hint--loading">
                <Loader2 className="permission-spinner" aria-hidden />
                Opening settings…
              </span>
            ) : (
              <span className="permission-allow-hint">
                Click to allow in System Settings
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="step-actions-row">
        {showBack && onBack && (
          <button
            type="button"
            className="btn btn-outline btn-icon"
            onClick={onBack}
            aria-label="Back"
          >
            <ChevronLeft className="btn-icon-svg" />
          </button>
        )}
        <button
          disabled={!allGranted}
          className={`btn btn-primary ${showBack ? "btn-flex-2" : "btn-full"}`}
          onClick={onNext}
        >
          Continue
        </button>
      </div>
      {onSkip && (
        <button
          type="button"
          className="btn btn-outline btn-full btn-skip-onboarding"
          onClick={onSkip}
        >
          Skip onboarding
        </button>
      )}
    </motion.div>
  );
}

// Step 3: Hotkeys — show transcription + action combos; user must trigger each once
export function SetupStep({
  onNext,
  onBack,
  showBack,
}: {
  onNext: () => void | Promise<void>;
  onBack?: () => void | Promise<void>;
  showBack?: boolean;
}) {
  const [configLoading, setConfigLoading] = useState(true);
  const [transcriptionHotkeys, setTranscriptionHotkeys] = useState<string[]>(
    [],
  );
  const [actionHotkeys, setActionHotkeys] = useState<string[]>([]);
  const [transcriptionTested, setTranscriptionTested] = useState(false);
  const [actionTested, setActionTested] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await invoke<TauriAppConfig>("get_app_config");
        if (cancelled) return;
        let th = cfg.hotkeys?.filter(Boolean) ?? [];
        let ah = cfg.action_hotkeys?.filter(Boolean) ?? [];
        if (th.length === 0 || ah.length === 0) {
          try {
            const defaults = await invoke<{
              hotkeys: string[];
              action_hotkeys: string[];
            }>("get_default_hotkeys");
            if (cancelled) return;
            if (th.length === 0) th = defaults.hotkeys?.filter(Boolean) ?? [];
            if (ah.length === 0)
              ah = defaults.action_hotkeys?.filter(Boolean) ?? [];
          } catch {
            /* keep partial lists */
          }
        }
        setTranscriptionHotkeys(th);
        setActionHotkeys(ah);
      } catch (e) {
        console.error("SetupStep: failed to load hotkeys", e);
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const unsub: Array<() => void> = [];
    listen("recording_started", () => {
      if (!disposed) setTranscriptionTested(true);
    }).then((u) => {
      if (disposed) u();
      else unsub.push(u);
    });
    listen("action_recording_started", () => {
      if (!disposed) setActionTested(true);
    }).then((u) => {
      if (disposed) u();
      else unsub.push(u);
    });
    return () => {
      disposed = true;
      unsub.forEach((u) => u());
    };
  }, []);

  const verifiedCount =
    (transcriptionTested ? 1 : 0) + (actionTested ? 1 : 0);
  const canContinue =
    !configLoading &&
    transcriptionHotkeys.length > 0 &&
    actionHotkeys.length > 0 &&
    transcriptionTested &&
    actionTested;

  return (
    <motion.div
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="onboarding-step-content onboarding-step-content--hotkeys"
    >
      <div className="step-header">
        <h1 className="step-title">Try your shortcuts</h1>
        <p className="step-description">
          Press and hold each shortcut once. Lexi should start listening — then
          release to stop. This confirms both transcription and actions are wired
          correctly.
        </p>
        <div className="permissions-progress hotkey-test-progress" aria-label="Shortcut test progress">
          <div className="permissions-progress__track">
            <div
              className="permissions-progress__fill"
              style={{ width: `${(verifiedCount / 2) * 100}%` }}
            />
          </div>
          <span className="permissions-progress__label">
            {verifiedCount} of 2 shortcuts verified
          </span>
        </div>
      </div>

      {configLoading ? (
        <div className="hotkey-test-loading">
          <Loader2 className="permission-spinner" aria-hidden />
          <span>Loading your shortcuts…</span>
        </div>
      ) : (
        <div className="hotkey-test-list">
          <div
            className={[
              "hotkey-test-card",
              transcriptionTested ? "hotkey-test-card--done" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="hotkey-test-card__main">
              <div className="hotkey-test-card__icon" aria-hidden>
                <AudioWaveform className="hotkey-test-card__svg" />
              </div>
              <div>
                <h3 className="hotkey-test-card__title">Transcription</h3>
                <p className="hotkey-test-card__desc">
                  Hold to dictate text into the active app.
                </p>
                <div className="hotkey-test-chips">
                  {transcriptionHotkeys.length === 0 ? (
                    <span className="hotkey-test-chip hotkey-test-chip--muted">
                      Not configured
                    </span>
                  ) : (
                    transcriptionHotkeys.map((h) => (
                      <kbd key={h} className="hotkey-test-chip">
                        {h}
                      </kbd>
                    ))
                  )}
                </div>
              </div>
            </div>
            {transcriptionTested ? (
              <div className="hotkey-test-status hotkey-test-status--ok">
                <Check className="check-icon" strokeWidth={2.5} /> Detected
              </div>
            ) : (
              <span className="hotkey-test-status hotkey-test-status--pending">
                Press shortcut…
              </span>
            )}
          </div>

          <div
            className={[
              "hotkey-test-card",
              actionTested ? "hotkey-test-card--done" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="hotkey-test-card__main">
              <div className="hotkey-test-card__icon" aria-hidden>
                <Sparkles className="hotkey-test-card__svg" />
              </div>
              <div>
                <h3 className="hotkey-test-card__title">Actions</h3>
                <p className="hotkey-test-card__desc">
                  Hold to run a voice command (tasks, search, and more).
                </p>
                <div className="hotkey-test-chips">
                  {actionHotkeys.length === 0 ? (
                    <span className="hotkey-test-chip hotkey-test-chip--muted">
                      Not configured
                    </span>
                  ) : (
                    actionHotkeys.map((h) => (
                      <kbd key={h} className="hotkey-test-chip">
                        {h}
                      </kbd>
                    ))
                  )}
                </div>
              </div>
            </div>
            {actionTested ? (
              <div className="hotkey-test-status hotkey-test-status--ok">
                <Check className="check-icon" strokeWidth={2.5} /> Detected
              </div>
            ) : (
              <span className="hotkey-test-status hotkey-test-status--pending">
                Press shortcut…
              </span>
            )}
          </div>
        </div>
      )}

      <div className="step-actions">
        <div className="step-actions-row">
          {showBack && onBack && (
            <button
              type="button"
              className="btn btn-outline btn-icon"
              onClick={onBack}
              aria-label="Back"
            >
              <ChevronLeft className="btn-icon-svg" />
            </button>
          )}
          <button
            disabled={!canContinue}
            className={`btn btn-primary ${showBack ? "btn-flex-2" : "btn-full"}`}
            onClick={onNext}
          >
            Continue
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// Step 4: Try It
export function TryItStep({
  onComplete,
  onBack,
  showBack,
  hotkey: hotkeyProp,
}: {
  onComplete: () => void | Promise<void>;
  onBack?: () => void | Promise<void>;
  showBack?: boolean;
  hotkey?: string | null;
}) {
  const [isListening, setIsListening] = useState(false);
  const [setupWorking, setSetupWorking] = useState(false);
  const [hotkeyLabel, setHotkeyLabel] = useState<string | null>(
    hotkeyProp ?? null,
  );

  useEffect(() => {
    if (hotkeyProp != null) setHotkeyLabel(hotkeyProp);
  }, [hotkeyProp]);

  useEffect(() => {
    if (hotkeyProp != null) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await invoke<TauriAppConfig>("get_app_config");
        const first = cfg.hotkeys?.find(Boolean);
        if (!cancelled && first) setHotkeyLabel(first);
      } catch {
        if (!cancelled) setHotkeyLabel("Fn");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hotkeyProp]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const unlistenGlobal = await listen("global-input", (event: any) => {
        const s = event.payload as string;
        if (s.includes("Function")) {
          setIsListening(s.includes("key_press"));
        }
      });
      const unlistenRecording = await listen("recording_started", () =>
        setIsListening(true),
      );
      const unlistenStopped = await listen("recording_stopped", () =>
        setIsListening(false),
      );
      const unlistenTranscription = await listen("transcription_success", () =>
        setSetupWorking(true),
      );
      unlisten = () => {
        unlistenGlobal();
        unlistenRecording();
        unlistenStopped();
        unlistenTranscription();
      };
    })();
    return () => unlisten?.();
  }, []);

  return (
    <motion.div
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="onboarding-step-content"
    >
      <div className="step-header">
        <h1 className="step-title">Give it a try</h1>
        <p className="step-description">
          Click in the box below, then hold{" "}
          <span className="hotkey-badge">{hotkeyLabel ?? "Fn"}</span> and speak
          to try a transcription.
        </p>
      </div>

      <div className="tryit-textarea-wrapper">
        <textarea
          className="tryit-textarea"
          placeholder="Hold Fn and speak — your transcription will appear here"
          defaultValue=""
          spellCheck={false}
        />
        {isListening && (
          <div className="listening-indicator">
            <span className="listening-label">Live</span>
            <span
              className="listening-dot"
              style={{ animationDelay: "0ms" }}
            ></span>
            <span
              className="listening-dot"
              style={{ animationDelay: "150ms" }}
            ></span>
            <span
              className="listening-dot"
              style={{ animationDelay: "300ms" }}
            ></span>
          </div>
        )}
        {setupWorking && (
          <p className="tryit-success">
            <Check className="check-icon-small" /> Great! Your setup is working.
          </p>
        )}
      </div>

      <div className="step-actions-row">
        {showBack && onBack && (
          <button
            type="button"
            className="btn btn-outline btn-icon"
            onClick={onBack}
            aria-label="Back"
          >
            <ChevronLeft className="btn-icon-svg" />
          </button>
        )}
        <button
          className={`btn btn-primary ${showBack ? "btn-flex-2" : "btn-full"}`}
          onClick={onComplete}
        >
          Complete Setup
        </button>
      </div>
    </motion.div>
  );
}

/**
 * Abstract panel: sign-in (calm) → permissions → shortcuts (most intense).
 * Visual “growth” matches onboarding progress.
 */
function OnboardingAbstractVisual({
  variant,
  motionKey,
}: {
  variant: "welcome" | "permissions" | "shortcuts";
  motionKey: string;
}) {
  const level =
    variant === "welcome" ? 0 : variant === "permissions" ? 1 : 2;
  const elevated = level >= 1;
  const peak = level >= 2;

  const panelClass = peak
    ? "visual-side--shortcuts-panel"
    : elevated
      ? "visual-side--permissions-panel"
      : "";

  const swMain = peak ? "1.75" : elevated ? "1.55" : "1.25";
  const swSecond = peak ? "1.2" : elevated ? "1.05" : "0.75";

  return (
    <div
      className={["visual-side", "visual-side--welcome", panelClass]
        .filter(Boolean)
        .join(" ")}
    >
      <motion.div
        key={motionKey}
        initial={{ opacity: 0, y: peak ? 12 : elevated ? 8 : 0 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: peak ? 0.5 : elevated ? 0.55 : 0.6,
          ease: [0.22, 1, 0.36, 1],
        }}
        className={[
          "visual-welcome",
          elevated && "visual-welcome--permissions",
          peak && "visual-welcome--shortcuts",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {elevated && <div className="visual-welcome-rim" aria-hidden />}
        {peak && (
          <div
            className="visual-welcome-rim visual-welcome-rim--outer"
            aria-hidden
          />
        )}
        <div
          className={[
            "visual-welcome-grid",
            elevated && "visual-welcome-grid--permissions",
            peak && "visual-welcome-grid--shortcuts",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-hidden
        />
        <div className="visual-welcome-glow visual-welcome-glow--a" aria-hidden />
        <div className="visual-welcome-glow visual-welcome-glow--b" aria-hidden />
        <div className="visual-welcome-glow visual-welcome-glow--c" aria-hidden />
        {elevated && (
          <div className="visual-welcome-glow visual-welcome-glow--d" aria-hidden />
        )}
        {peak && (
          <>
            <div className="visual-welcome-glow visual-welcome-glow--e" aria-hidden />
            <div className="visual-welcome-glow visual-welcome-glow--f" aria-hidden />
          </>
        )}
        <svg
          className={[
            "visual-welcome-curve",
            elevated && "visual-welcome-curve--permissions",
            peak && "visual-welcome-curve--shortcuts",
          ]
            .filter(Boolean)
            .join(" ")}
          viewBox="0 0 400 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <path
            d="M0 120 C 80 40, 160 180, 200 100 S 320 20, 400 80"
            stroke="currentColor"
            strokeWidth={swMain}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M0 140 C 100 200, 200 60, 280 130 S 360 160, 400 100"
            stroke="currentColor"
            strokeWidth={swSecond}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {elevated && (
            <path
              d="M40 95 Q 120 25, 200 88 T 380 72"
              stroke="currentColor"
              strokeWidth={peak ? "1.05" : "0.9"}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {peak && (
            <>
              <path
                d="M20 165 Q 100 100, 200 155 T 392 128"
                stroke="currentColor"
                strokeWidth="0.85"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d="M60 55 Q 200 120, 340 48"
                stroke="currentColor"
                strokeWidth="0.65"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
      </motion.div>
    </div>
  );
}

// Steps 0–2: abstract panel (intensity ramps); step 3 = try-it focal
export function VisualSide({ step }: { step: number }) {
  if (step === 0) {
    return <OnboardingAbstractVisual variant="welcome" motionKey="welcome-visual" />;
  }

  if (step === 1) {
    return (
      <OnboardingAbstractVisual variant="permissions" motionKey="permissions-visual" />
    );
  }

  if (step === 2) {
    return (
      <OnboardingAbstractVisual variant="shortcuts" motionKey="shortcuts-visual" />
    );
  }

  return (
    <div className="visual-side visual-side--step visual-side--step-3">
      <motion.div
        key={step}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45 }}
        className="visual-content"
      >
        <div className="visual-blur visual-blur--step" />
        <div className="visual-icon">✨</div>
      </motion.div>
    </div>
  );
}
