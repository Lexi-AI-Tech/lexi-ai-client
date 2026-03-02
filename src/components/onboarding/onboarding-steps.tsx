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
          A minimalist voice assistant that helps you type anywhere on your Mac.
        </p>
      </div>

      <div className="features-list">
        {[
          { icon: Keyboard, text: "Global Shortcut" },
          { icon: Mic, text: "Natural Speech" },
          { icon: Sparkles, text: "Instant Result" },
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
      desc: "For audio recording",
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

  return (
    <motion.div
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="onboarding-step-content"
    >
      <div className="step-header">
        <h1 className="step-title">Permissions</h1>
        <p className="step-description">
          Lexi AI needs a few permissions to function as your system-wide
          assistant.
        </p>
      </div>

      <div className="permissions-list">
        {permissions.map((item, i) => (
          <div
            key={i}
            className={`permission-card ${!item.state.granted ? "permission-card--clickable" : ""}`}
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
                <Check className="check-icon" /> Allowed
              </div>
            ) : (
              <span className="permission-allow-hint">
                {item.state.checking
                  ? "..."
                  : "Click to open system permission"}
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

// Visual Side Component
export function VisualSide({ step }: { step: number }) {
  const icons = ["🎤", "🔐", "⌨️", "✨"];

  return (
    <div className="visual-side">
      <motion.div
        key={step}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="visual-content"
      >
        <div className="visual-blur" />
        <div className="visual-icon">{icons[step] || "🎤"}</div>
      </motion.div>
    </div>
  );
}
