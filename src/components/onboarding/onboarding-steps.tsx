import { motion } from "framer-motion";
import { Mic, Keyboard, Sparkles, Check, Monitor } from "lucide-react";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useOnboardingStore } from "../../store/onboardingStore";
import { useAuthStore } from "../../store/authStore";
import { GoogleLoginButton } from "../auth/GoogleLoginButton";
import {
  clearAllStorage,
  clearAuthStorage,
  clearOnboardingStorage,
} from "../../lib/storageUtils";

const stepVariants = {
  initial: { opacity: 0, x: 10 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -10 },
};

// Step 1: Welcome
export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { isAuthenticated, error } = useAuthStore();
  const { resetOnboarding } = useOnboardingStore();
  const { clearAuth } = useAuthStore();
  const [showDebugMenu, setShowDebugMenu] = useState(false);

  const handleClearAll = () => {
    if (
      confirm("Clear all app data? This will log you out and reset onboarding.")
    ) {
      clearAllStorage();
      clearAuth();
      resetOnboarding();
      setShowDebugMenu(false);
      alert("All data cleared! Page will refresh.");
      window.location.reload();
    }
  };

  const handleClearAuth = () => {
    if (confirm("Clear authentication data? You will be logged out.")) {
      clearAuthStorage();
      clearAuth();
      setShowDebugMenu(false);
      alert("Auth data cleared!");
    }
  };

  const handleClearOnboarding = () => {
    if (confirm("Reset onboarding? You will need to go through setup again.")) {
      clearOnboardingStorage();
      resetOnboarding();
      setShowDebugMenu(false);
      alert("Onboarding reset!");
    }
  };

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
          {
            icon: Keyboard,
            text: "Global Shortcut",
            sub: "Works in every application",
          },
          {
            icon: Mic,
            text: "Natural Speech",
            sub: "Powered by OpenAI Whisper",
          },
          {
            icon: Sparkles,
            text: "Instant Result",
            sub: "Zero-latency transcription",
          },
        ].map((item, i) => (
          <div key={i} className="feature-item">
            <item.icon className="feature-icon" />
            <div>
              <p className="feature-title">{item.text}</p>
              <p className="feature-sub">{item.sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="step-actions">
        <button className="btn btn-primary" onClick={onNext}>
          {isAuthenticated ? "Continue" : "Get Started"}
        </button>

        {!isAuthenticated && (
          <>
            <div className="divider">
              <span>or</span>
            </div>
            <GoogleLoginButton
              onSuccess={() => {
                console.log("Login successful");
              }}
              onError={(err) => {
                console.error("Login error:", err);
              }}
            />
            {error && <div className="auth-error">{error}</div>}
          </>
        )}
      </div>

      {/* Debug Menu */}
      <div className="debug-menu-container">
        <button
          className="debug-toggle"
          onClick={() => setShowDebugMenu(!showDebugMenu)}
          onContextMenu={(e) => {
            e.preventDefault();
            setShowDebugMenu(!showDebugMenu);
          }}
        >
          {showDebugMenu ? "▼" : "▶"} Debug Menu
        </button>

        {showDebugMenu && (
          <div className="debug-menu">
            <p className="debug-menu-title">Clear Storage:</p>
            <button className="debug-btn" onClick={handleClearAuth}>
              Clear Auth Data
            </button>
            <button className="debug-btn" onClick={handleClearOnboarding}>
              Clear Onboarding Data
            </button>
            <button
              className="debug-btn debug-btn-danger"
              onClick={handleClearAll}
            >
              Clear All Data
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// Step 2: Permissions
interface PermissionState {
  granted: boolean;
  checking: boolean;
}

export function PermissionsStep({ onNext }: { onNext: () => void }) {
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

      setMicrophone((prev) => ({ ...prev, granted: micGranted }));
      setAccessibility((prev) => ({ ...prev, granted: accGranted }));
      setInputMonitoring((prev) => ({ ...prev, granted: inputGranted }));
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

  const allGranted =
    microphone.granted &&
    accessibility.granted &&
    inputMonitoring.granted;

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
      desc: "For detecting Fn key",
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
          <div key={i} className="permission-card">
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
              <button
                onClick={item.request}
                disabled={item.state.checking}
                className="btn btn-outline btn-sm"
              >
                {item.state.checking ? "..." : "Allow"}
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        disabled={!allGranted}
        className="btn btn-primary btn-full"
        onClick={onNext}
      >
        Continue
      </button>
    </motion.div>
  );
}

// Step 3: Setup (Global Shortcut)
export function SetupStep({
  onNext,
  hotkey,
  setHotkey,
}: {
  onNext: () => void;
  hotkey: string | null;
  setHotkey: (k: string) => void;
}) {
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    if (isRecording) {
      const handleKeyDown = (e: KeyboardEvent) => {
        e.preventDefault();
        const keys = [];
        if (e.metaKey) keys.push("⌘");
        if (e.ctrlKey) keys.push("Ctrl");
        if (e.altKey) keys.push("Alt");
        if (e.shiftKey) keys.push("Shift");
        if (e.key && !["Meta", "Control", "Alt", "Shift"].includes(e.key)) {
          keys.push(e.key.toUpperCase());
        }
        if (keys.length > 0) {
          setHotkey(keys.join(" + "));
          setIsRecording(false);
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isRecording, setHotkey]);

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

      <div
        className={`hotkey-recorder ${isRecording ? "recording" : ""}`}
        onClick={() => setIsRecording(true)}
      >
        <div className="hotkey-content">
          <div className="hotkey-label">
            {isRecording ? "Listening..." : "Current Key"}
          </div>
          <div className="hotkey-value">{hotkey || "Fn"}</div>
          {!isRecording && <p className="hotkey-hint">Click to reassign</p>}
        </div>
      </div>

      <div className="step-actions-row">
        <button
          className="btn btn-outline btn-flex"
          onClick={() => setHotkey("Fn")}
        >
          Reset
        </button>
        <button className="btn btn-primary btn-flex-2" onClick={onNext}>
          Apply and Continue
        </button>
      </div>
    </motion.div>
  );
}

// Step 4: Try It
export function TryItStep({
  onComplete,
  hotkey,
}: {
  onComplete: () => void;
  hotkey: string | null;
}) {
  const [isListening, setIsListening] = useState(false);
  const [text, setText] = useState("");
  const [hasDetectedFn, setHasDetectedFn] = useState(false);
  const fullText =
    "Welcome to the future of typing. This is Lexi AI transcribing your voice in real-time with zero latency.";

  // Listen for Fn key events
  useEffect(() => {
    const setupListener = async () => {
      const unlistenGlobal = await listen("global-input", (event: any) => {
        const eventString = event.payload as string;
        if (eventString.includes("Function")) {
          if (eventString.includes("key_press")) {
            setIsListening(true);
            setHasDetectedFn(true);
          } else if (eventString.includes("key_release")) {
            setIsListening(false);
          }
        }
      });

      const unlistenRecording = await listen("recording_started", () => {
        setIsListening(true);
        setHasDetectedFn(true);
      });

      const unlistenStopped = await listen("recording_stopped", () => {
        setIsListening(false);
      });

      return () => {
        unlistenGlobal();
        unlistenRecording();
        unlistenStopped();
      };
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

  // Simulate transcription when listening
  useEffect(() => {
    if (isListening) {
      let i = 0;
      setText("");
      const interval = setInterval(() => {
        setText(fullText.slice(0, i + 1));
        i++;
        if (i >= fullText.length) {
          clearInterval(interval);
        }
      }, 40);
      return () => clearInterval(interval);
    }
  }, [isListening]);

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
          Hold <span className="hotkey-badge">{hotkey || "Fn"}</span> and speak
          to see Lexi AI in action.
        </p>
      </div>

      <div className="tryit-textarea-wrapper">
        <textarea
          className="tryit-textarea"
          placeholder="Your voice will appear here..."
          value={text}
          readOnly
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
      </div>

      <div className="mic-button-container">
        <button
          className={`mic-button ${isListening ? "active" : ""}`}
          onClick={() => setIsListening(!isListening)}
        >
          <Mic className="mic-icon" />
        </button>
        {hasDetectedFn && (
          <p className="mic-success">
            <Check className="check-icon-small" /> Great! Your setup is working.
          </p>
        )}
      </div>

      <button className="btn btn-primary btn-full" onClick={onComplete}>
        Complete Setup
      </button>
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
