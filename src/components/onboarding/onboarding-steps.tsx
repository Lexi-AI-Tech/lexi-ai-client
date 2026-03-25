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

// Step 3: Setup (Global Shortcut) – display only, no reassignment
export function SetupStep({
  onNext,
  onBack,
  showBack,
  hotkey,
}: {
  onNext: () => void | Promise<void>;
  onBack?: () => void | Promise<void>;
  showBack?: boolean;
  hotkey: string | null;
}) {
  return (
    <motion.div
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="onboarding-step-content"
    >
      <div className="step-header">
        <h1 className="step-title">Global Shortcut</h1>
        <p className="step-description">
          The shortcut used to activate Lexi AI while working in other apps.
        </p>
      </div>

      <div className="hotkey-recorder hotkey-recorder-readonly">
        <div className="hotkey-content">
          <div className="hotkey-label">Shortcut</div>
          <div className="hotkey-value">{hotkey || "Fn"}</div>
        </div>
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
          <button
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
  hotkey,
}: {
  onComplete: () => void | Promise<void>;
  onBack?: () => void | Promise<void>;
  showBack?: boolean;
  hotkey: string | null;
}) {
  const [isListening, setIsListening] = useState(false);
  const [setupWorking, setSetupWorking] = useState(false);

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
          <span className="hotkey-badge">{hotkey || "Fn"}</span> and speak to
          try a transcription.
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

/** Same abstract “card + grid + aura + curves” as sign-in; permissions uses elevated styling in CSS. */
function OnboardingAbstractVisual({
  variant,
  motionKey,
}: {
  variant: "welcome" | "permissions";
  motionKey: string;
}) {
  const elevated = variant === "permissions";

  return (
    <div
      className={[
        "visual-side",
        "visual-side--welcome",
        elevated ? "visual-side--permissions-panel" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <motion.div
        key={motionKey}
        initial={{ opacity: 0, y: elevated ? 8 : 0 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: elevated ? 0.55 : 0.6,
          ease: [0.22, 1, 0.36, 1],
        }}
        className={[
          "visual-welcome",
          elevated ? "visual-welcome--permissions" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {elevated && <div className="visual-welcome-rim" aria-hidden />}
        <div
          className={[
            "visual-welcome-grid",
            elevated ? "visual-welcome-grid--permissions" : "",
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
        <svg
          className={[
            "visual-welcome-curve",
            elevated ? "visual-welcome-curve--permissions" : "",
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
            strokeWidth={elevated ? "1.55" : "1.25"}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M0 140 C 100 200, 200 60, 280 130 S 360 160, 400 100"
            stroke="currentColor"
            strokeWidth={elevated ? "1.05" : "0.75"}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {elevated && (
            <path
              d="M40 95 Q 120 25, 200 88 T 380 72"
              stroke="currentColor"
              strokeWidth="0.9"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </motion.div>
    </div>
  );
}

// Visual Side — steps 0/1 share abstract panel (permissions is more intense); 2–3 keep emoji focal
export function VisualSide({ step }: { step: number }) {
  const icons: [string, string] = ["⌨️", "✨"];

  if (step === 0) {
    return <OnboardingAbstractVisual variant="welcome" motionKey="welcome-visual" />;
  }

  if (step === 1) {
    return (
      <OnboardingAbstractVisual variant="permissions" motionKey="permissions-visual" />
    );
  }

  const focalIndex = step - 2;
  const emoji = icons[focalIndex] ?? "✨";

  return (
    <div className={`visual-side visual-side--step visual-side--step-${step}`}>
      <motion.div
        key={step}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45 }}
        className="visual-content"
      >
        <div className="visual-blur visual-blur--step" />
        <div className="visual-icon">{emoji}</div>
      </motion.div>
    </div>
  );
}
