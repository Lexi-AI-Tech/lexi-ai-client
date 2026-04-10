import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Mic,
  Keyboard,
  Sparkles,
  Atom,
  Check,
  Monitor,
  ChevronLeft,
  Volume2,
  AudioLines,
  Loader2,
  Zap,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { listen } from "@tauri-apps/api/event";
import { useAuthStore } from "../../store/authStore";
import type { TauriAppConfig } from "../../types";
import { GoogleLoginButton } from "../auth/GoogleLoginButton";

/** Matches Rust `DefaultHotkeysResponse` / `begin_onboarding_hotkey_dry_run` */
type DefaultHotkeysResponse = {
  hotkeys: string[];
  action_hotkeys: string[];
};

const LOCAL_HOTKEY_FALLBACK: DefaultHotkeysResponse = {
  hotkeys: ["Fn"],
  action_hotkeys: ["Fn+Control"],
};

const HOW_TO_SETUP_URL = "https://speaklexi.com/how-to-setup";

/**
 * Labels for the try-it step: prefer `get_app_config`, fill empty sides with
 * `get_default_hotkeys` (same server defaults as the hotkey dry-run), then local fallback.
 */
async function resolveHotkeysForTryItStep(): Promise<DefaultHotkeysResponse> {
  let hotkeys: string[] = [];
  let action_hotkeys: string[] = [];
  try {
    const cfg = await invoke<TauriAppConfig>("get_app_config");
    hotkeys = cfg.hotkeys?.filter(Boolean) ?? [];
    action_hotkeys = cfg.action_hotkeys?.filter(Boolean) ?? [];
  } catch {
    // Missing auth/network: fall through to default-hotkeys API or local fallback.
  }
  if (hotkeys.length > 0 && action_hotkeys.length > 0) {
    return { hotkeys, action_hotkeys };
  }
  try {
    const d = await invoke<DefaultHotkeysResponse>("get_default_hotkeys");
    const dh = d.hotkeys?.filter(Boolean) ?? [];
    const da = d.action_hotkeys?.filter(Boolean) ?? [];
    if (!hotkeys.length) hotkeys = dh;
    if (!action_hotkeys.length) action_hotkeys = da;
  } catch {
    // Same path as Rust `local_onboarding_hotkey_fallback`
  }
  if (!hotkeys.length) hotkeys = [...LOCAL_HOTKEY_FALLBACK.hotkeys];
  if (!action_hotkeys.length)
    action_hotkeys = [...LOCAL_HOTKEY_FALLBACK.action_hotkeys];
  return { hotkeys, action_hotkeys };
}

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
          { icon: AudioLines, text: "Voice to text" },
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
  showBack,
}: {
  onNext: () => void | Promise<void>;
  onBack?: () => void | Promise<void>;
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
  const [systemAudio, setSystemAudio] = useState<PermissionState>({
    granted: false,
    checking: false,
  });

  const [autoAdvanced, setAutoAdvanced] = useState(false);

  const checkPermissions = async () => {
    try {
      const micGranted = await invoke<boolean>("check_microphone_permission");
      const accGranted = await invoke<boolean>(
        "check_accessibility_permission",
      );
      const systemAudioGranted = await invoke<boolean>(
        "check_system_audio_permission",
      );

      setMicrophone((prev) => ({ ...prev, granted: micGranted }));
      setAccessibility((prev) => ({ ...prev, granted: accGranted }));
      setSystemAudio((prev) => ({ ...prev, granted: systemAudioGranted }));
    } catch (error) {
      console.error("Failed to check permissions:", error);
    }
  };

  useEffect(() => {
    void checkPermissions();
    const interval = setInterval(checkPermissions, 1000);
    return () => clearInterval(interval);
  }, []);

  const requestMicrophone = async () => {
    setMicrophone((prev) => ({ ...prev, checking: true }));
    try {
      await invoke<boolean>("request_microphone_permission");
      setTimeout(checkPermissions, 800);
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
      setTimeout(checkPermissions, 800);
    } catch (error) {
      console.error("Failed to request accessibility permission:", error);
    } finally {
      setAccessibility((prev) => ({ ...prev, checking: false }));
    }
  };

  const requestSystemAudio = async () => {
    setSystemAudio((prev) => ({ ...prev, checking: true }));
    try {
      await invoke<boolean>("request_system_audio_permission");
      setTimeout(checkPermissions, 800);
    } catch (error) {
      console.error("Failed to request system audio permission:", error);
    } finally {
      setSystemAudio((prev) => ({ ...prev, checking: false }));
    }
  };

  const allGranted =
    microphone.granted && accessibility.granted && systemAudio.granted;

  // Auto-advance when all permissions are granted
  useEffect(() => {
    if (allGranted && !autoAdvanced) {
      setAutoAdvanced(true);
      const timeout = setTimeout(() => onNext(), 800);
      return () => clearTimeout(timeout);
    }
  }, [allGranted, autoAdvanced, onNext]);

  const permissions = [
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
    {
      icon: Mic,
      title: "Microphone",
      desc: "For recording your voice",
      state: microphone,
      request: requestMicrophone,
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
          Click each permission below — most just need a single "Allow" in the
          system popup that appears.
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
                Opening…
              </span>
            ) : (
              <span className="permission-allow-hint permission-allow-hint--cta">
                Click to allow
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="permissions-restart-note">
        <p className="permissions-restart-note__text">
          Sometimes the permission status above may not update right away after
          you allow access in System Settings. You may need to restart the app
          to refresh.
        </p>
        <button
          type="button"
          className="btn btn-outline btn-sm permissions-restart-note__btn"
          onClick={() => {
            void relaunch().catch((err) =>
              console.error("Failed to restart app:", err),
            );
          }}
        >
          Restart app
        </button>
      </div>

      <div
        className={[
          "step-actions-row",
          showBack && onBack ? "step-actions-row--with-back" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
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
          className={`btn btn-primary ${showBack && onBack ? "" : "btn-full"} permissions-continue-btn`}
          onClick={onNext}
          title={
            !allGranted ? "All permissions are required to continue" : undefined
          }
        >
          Continue
        </button>
      </div>
      {!allGranted && (
        <p className="permissions-hint-text">
          All permissions are required to provide the full Lexi AI experience.
        </p>
      )}
      <p className="permissions-setup-help">
        Having trouble setting up?{" "}
        <a
          href={HOW_TO_SETUP_URL}
          onClick={(e) => {
            e.preventDefault();
            void (async () => {
              try {
                await invoke("open_external_url", { url: HOW_TO_SETUP_URL });
              } catch (err) {
                console.error("Failed to open setup guide:", err);
                window.open(HOW_TO_SETUP_URL, "_blank", "noopener,noreferrer");
              }
            })();
          }}
        >
          Click here
        </a>
        .
      </p>
    </motion.div>
  );
}

// Step 3: Hotkeys — press each once; dry-run skips pill (see `onboarding_hotkey_verify` in Rust).
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
        const defaults = await invoke<DefaultHotkeysResponse>(
          "begin_onboarding_hotkey_dry_run",
        );
        if (cancelled) return;
        setTranscriptionHotkeys(defaults.hotkeys?.filter(Boolean) ?? []);
        setActionHotkeys(defaults.action_hotkeys?.filter(Boolean) ?? []);
      } catch (e) {
        console.error("SetupStep: begin_onboarding_hotkey_dry_run failed", e);
        if (!cancelled) {
          setTranscriptionHotkeys(["Fn"]);
          setActionHotkeys(["Fn+Control"]);
        }
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      void invoke("end_onboarding_hotkey_dry_run").catch((err) =>
        console.error("SetupStep: end_onboarding_hotkey_dry_run", err),
      );
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const unsub: Array<() => void> = [];
    listen<{ mode: string }>("onboarding_hotkey_verify", (event) => {
      if (disposed) return;
      const m = event.payload?.mode;
      if (m === "assistant") setTranscriptionTested(true);
      if (m === "action") setActionTested(true);
    }).then((u) => {
      if (disposed) u();
      else unsub.push(u);
    });
    return () => {
      disposed = true;
      unsub.forEach((u) => u());
    };
  }, []);

  const verifiedCount = (transcriptionTested ? 1 : 0) + (actionTested ? 1 : 0);
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
          These are Lexi’s default shortcuts. Press and hold each once — your
          mic turns on, then release to stop. Nothing is sent to transcription
          or voice actions here; we only check the keys. The floating pill
          appears on the next step when you try Lexi for real.
        </p>
        <div
          className="permissions-progress hotkey-test-progress"
          aria-label="Shortcut test progress"
        >
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
          <span>Preparing shortcut test…</span>
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
                <AudioLines className="hotkey-test-card__svg" />
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
                <Atom className="hotkey-test-card__svg" strokeWidth={2} />
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

// Step 4: Give it a try — real transcription & actions (no dry-run)
export function TryItStep({
  onComplete,
  onBack,
  showBack,
}: {
  onComplete: () => void | Promise<void>;
  onBack?: () => void | Promise<void>;
  showBack?: boolean;
}) {
  const [configLoading, setConfigLoading] = useState(true);
  const [transcriptionHotkeys, setTranscriptionHotkeys] = useState<string[]>(
    [],
  );
  const [actionHotkeys, setActionHotkeys] = useState<string[]>([]);
  const [transcriptionLive, setTranscriptionLive] = useState(false);
  const [actionLive, setActionLive] = useState(false);
  const [transcriptionDone, setTranscriptionDone] = useState(false);
  const [actionDone, setActionDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { hotkeys, action_hotkeys } = await resolveHotkeysForTryItStep();
        if (!cancelled) {
          setTranscriptionHotkeys(hotkeys);
          setActionHotkeys(action_hotkeys);
        }
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

    const add = (u: () => void) => {
      if (disposed) u();
      else unsub.push(u);
    };

    listen("recording_started", () => {
      if (!disposed) setTranscriptionLive(true);
    }).then((u) => add(u));
    listen("recording_stopped", () => {
      if (!disposed) setTranscriptionLive(false);
    }).then((u) => add(u));
    listen("action_recording_started", () => {
      if (!disposed) setActionLive(true);
    }).then((u) => add(u));
    listen("action_recording_stopped", () => {
      if (!disposed) setActionLive(false);
    }).then((u) => add(u));
    listen("transcription_success", () => {
      if (!disposed) setTranscriptionDone(true);
    }).then((u) => add(u));
    listen("action_success", () => {
      if (!disposed) setActionDone(true);
    }).then((u) => add(u));

    return () => {
      disposed = true;
      unsub.forEach((u) => u());
    };
  }, []);

  const triedCount = (transcriptionDone ? 1 : 0) + (actionDone ? 1 : 0);
  const canComplete = transcriptionDone || actionDone;

  const finaleChild = {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
  };

  return (
    <motion.div
      variants={stepVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="onboarding-step-content onboarding-step-content--tryit-finale"
    >
      <div className="tryit-finale-ambient" aria-hidden />
      <motion.div
        className="tryit-finale-hero"
        variants={finaleChild}
        initial="initial"
        animate="animate"
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="tryit-finale-hero__badge">
          <Zap className="tryit-finale-hero__badge-icon" aria-hidden />
          <span>Final step</span>
        </div>
        <h1 className="tryit-finale-title">Give it a try</h1>
        <p className="tryit-finale-lead">
          Focus a box below, hold the shortcut, and speak — text appears there
          on success. Complete one path (or both) to finish.
        </p>
        <div
          className="permissions-progress tryit-finale-progress"
          aria-label="Live try progress"
        >
          <div className="permissions-progress__track tryit-finale-progress__track">
            <motion.div
              className="permissions-progress__fill tryit-finale-progress__fill"
              initial={false}
              animate={{
                width: `${Math.min(triedCount, 2) * 50}%`,
              }}
              transition={{ type: "spring", stiffness: 220, damping: 28 }}
            />
          </div>
          <span className="permissions-progress__label">
            {triedCount === 0
              ? "0 / 2 — try transcription or actions"
              : triedCount === 1
                ? "1 / 2 — try the other path"
                : "2 / 2 done"}
          </span>
        </div>
      </motion.div>

      {configLoading ? (
        <div className="hotkey-test-loading tryit-finale-loading">
          <Loader2 className="permission-spinner" aria-hidden />
          <span>Loading your shortcuts…</span>
        </div>
      ) : (
        <div className="tryit-finale-grid">
          <motion.div
            className={[
              "tryit-finale-card",
              transcriptionLive ? "tryit-finale-card--live" : "",
              transcriptionDone ? "tryit-finale-card--done" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            variants={finaleChild}
            initial="initial"
            animate="animate"
            transition={{
              duration: 0.5,
              delay: 0.06,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="tryit-finale-card__glow" aria-hidden />
            <div className="tryit-finale-card__head">
              <div className="tryit-finale-card__icon" aria-hidden>
                <AudioLines className="tryit-finale-card__svg" />
              </div>
              <div>
                <h2 className="tryit-finale-card__title">Transcription</h2>
                <p className="tryit-finale-card__desc">
                  Focus the field, hold your transcription shortcut, speak.
                </p>
              </div>
            </div>
            <div className="tryit-finale-chips">
              {transcriptionHotkeys.length === 0 ? (
                <span className="hotkey-test-chip hotkey-test-chip--muted">
                  Not configured
                </span>
              ) : (
                transcriptionHotkeys.map((h) => (
                  <kbd key={h} className="hotkey-test-chip tryit-finale-kbd">
                    {h}
                  </kbd>
                ))
              )}
            </div>
            <div className="tryit-textarea-wrapper tryit-finale-textarea-wrap">
              <textarea
                className="tryit-textarea tryit-finale-textarea"
                placeholder="Click here first, then hold your transcription shortcut and speak…"
                defaultValue=""
                spellCheck={false}
              />
              {transcriptionLive && (
                <div className="listening-indicator tryit-finale-live-pill">
                  <span className="listening-label">Live</span>
                  <span
                    className="listening-dot"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="listening-dot"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="listening-dot"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              )}
            </div>
            {transcriptionDone ? (
              <p className="tryit-finale-card__status tryit-finale-card__status--ok">
                <Check className="check-icon-small" strokeWidth={2.5} />
                Transcription completed — you are ready.
              </p>
            ) : (
              <p className="tryit-finale-card__status tryit-finale-card__status--hint">
                Waiting for a successful transcription…
              </p>
            )}
          </motion.div>

          <motion.div
            className={[
              "tryit-finale-card",
              actionLive ? "tryit-finale-card--live" : "",
              actionDone ? "tryit-finale-card--done" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            variants={finaleChild}
            initial="initial"
            animate="animate"
            transition={{
              duration: 0.5,
              delay: 0.12,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div
              className="tryit-finale-card__glow tryit-finale-card__glow--b"
              aria-hidden
            />
            <div className="tryit-finale-card__head">
              <div
                className="tryit-finale-card__icon tryit-finale-card__icon--action"
                aria-hidden
              >
                <Atom className="tryit-finale-card__svg" strokeWidth={2} />
              </div>
              <div>
                <h2 className="tryit-finale-card__title">Actions</h2>
                <p className="tryit-finale-card__desc">
                  Focus the field, hold your action shortcut, speak.
                </p>
              </div>
            </div>
            <div className="tryit-finale-chips">
              {actionHotkeys.length === 0 ? (
                <span className="hotkey-test-chip hotkey-test-chip--muted">
                  Not configured
                </span>
              ) : (
                actionHotkeys.map((h) => (
                  <kbd key={h} className="hotkey-test-chip tryit-finale-kbd">
                    {h}
                  </kbd>
                ))
              )}
            </div>
            <div className="tryit-textarea-wrapper tryit-finale-textarea-wrap">
              <textarea
                className="tryit-textarea tryit-finale-textarea"
                placeholder="Try saying e.g. “Write a poem in spanish”"
                defaultValue=""
                spellCheck={false}
              />
              {actionLive && (
                <div className="listening-indicator tryit-finale-live-pill">
                  <span className="listening-label">Live</span>
                  <span
                    className="listening-dot"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="listening-dot"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="listening-dot"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              )}
            </div>
            {actionDone ? (
              <p className="tryit-finale-card__status tryit-finale-card__status--ok">
                <Check className="check-icon-small" strokeWidth={2.5} />
                Action completed — you are ready.
              </p>
            ) : (
              <p className="tryit-finale-card__status tryit-finale-card__status--hint">
                Waiting for a successful voice action…
              </p>
            )}
          </motion.div>
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
            type="button"
            disabled={!canComplete}
            title={
              !canComplete
                ? "Complete a transcription or a voice action first"
                : undefined
            }
            className={`btn btn-primary tryit-finale-complete ${showBack ? "btn-flex-2" : "btn-full"}`}
            onClick={onComplete}
          >
            Complete setup
          </button>
        </div>
        {!canComplete && !configLoading && (
          <p className="tryit-finale-footnote">
            Finish this step after Lexi confirms at least one transcription or
            action — shortcuts are live.
          </p>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Abstract panel: sign-in → permissions → shortcuts → finale (peak intensity).
 * Visual “growth” matches onboarding progress.
 */
function OnboardingAbstractVisual({
  variant,
  motionKey,
}: {
  variant: "welcome" | "permissions" | "shortcuts" | "finale";
  motionKey: string;
}) {
  const level =
    variant === "welcome"
      ? 0
      : variant === "permissions"
        ? 1
        : variant === "shortcuts"
          ? 2
          : 3;
  const elevated = level >= 1;
  const peak = level >= 2;
  const ultra = level >= 3;

  const panelClass = ultra
    ? "visual-side--finale-panel"
    : peak
      ? "visual-side--shortcuts-panel"
      : elevated
        ? "visual-side--permissions-panel"
        : "";

  const swMain = ultra ? "2" : peak ? "1.75" : elevated ? "1.55" : "1.25";
  const swSecond = ultra ? "1.35" : peak ? "1.2" : elevated ? "1.05" : "0.75";

  return (
    <div
      className={["visual-side", "visual-side--welcome", panelClass]
        .filter(Boolean)
        .join(" ")}
    >
      <motion.div
        key={motionKey}
        initial={{ opacity: 0, y: ultra ? 16 : peak ? 12 : elevated ? 8 : 0 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: ultra ? 0.58 : peak ? 0.5 : elevated ? 0.55 : 0.6,
          ease: [0.22, 1, 0.36, 1],
        }}
        className={[
          "visual-welcome",
          elevated && "visual-welcome--permissions",
          peak && "visual-welcome--shortcuts",
          ultra && "visual-welcome--finale",
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
        {ultra && (
          <div
            className="visual-welcome-rim visual-welcome-rim--finale"
            aria-hidden
          />
        )}
        <div
          className={[
            "visual-welcome-grid",
            elevated && "visual-welcome-grid--permissions",
            peak && "visual-welcome-grid--shortcuts",
            ultra && "visual-welcome-grid--finale",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-hidden
        />
        <div
          className="visual-welcome-glow visual-welcome-glow--a"
          aria-hidden
        />
        <div
          className="visual-welcome-glow visual-welcome-glow--b"
          aria-hidden
        />
        <div
          className="visual-welcome-glow visual-welcome-glow--c"
          aria-hidden
        />
        {elevated && (
          <div
            className="visual-welcome-glow visual-welcome-glow--d"
            aria-hidden
          />
        )}
        {peak && (
          <>
            <div
              className="visual-welcome-glow visual-welcome-glow--e"
              aria-hidden
            />
            <div
              className="visual-welcome-glow visual-welcome-glow--f"
              aria-hidden
            />
          </>
        )}
        {ultra && (
          <>
            <div
              className="visual-welcome-glow visual-welcome-glow--g"
              aria-hidden
            />
            <div
              className="visual-welcome-glow visual-welcome-glow--h"
              aria-hidden
            />
            <div
              className="visual-welcome-glow visual-welcome-glow--i"
              aria-hidden
            />
          </>
        )}
        <svg
          className={[
            "visual-welcome-curve",
            elevated && "visual-welcome-curve--permissions",
            peak && "visual-welcome-curve--shortcuts",
            ultra && "visual-welcome-curve--finale",
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
          {ultra && (
            <>
              <path
                d="M10 78 Q 100 140, 200 62 T 390 95"
                stroke="currentColor"
                strokeWidth="0.55"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d="M48 188 Q 200 118, 352 168"
                stroke="currentColor"
                strokeWidth="0.5"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d="M200 8 L200 192"
                stroke="currentColor"
                strokeWidth="0.35"
                strokeLinecap="round"
                opacity={0.35}
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
      </motion.div>
    </div>
  );
}

export function VisualSide({ step }: { step: number }) {
  if (step === 0) {
    return (
      <OnboardingAbstractVisual variant="welcome" motionKey="welcome-visual" />
    );
  }

  if (step === 1) {
    return (
      <OnboardingAbstractVisual
        variant="permissions"
        motionKey="permissions-visual"
      />
    );
  }

  if (step === 2) {
    return (
      <OnboardingAbstractVisual
        variant="shortcuts"
        motionKey="shortcuts-visual"
      />
    );
  }

  if (step === 3) {
    return (
      <OnboardingAbstractVisual variant="finale" motionKey="finale-visual" />
    );
  }

  return null;
}
