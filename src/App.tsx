/**
 * Main App Component
 *
 * Main app with home dashboard, transcripts, and settings.
 * When Rust detects auth errors (e.g. token refresh fails), it clears auth and resets
 * onboarding, then emits auth_expired; the frontend syncs state and shows onboarding.
 * After login, onboarding status is synced from server by system type and version;
 * if not complete, onboarding flow is shown from start; otherwise go to homepage.
 */

import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";

import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { HomePage } from "./components/home/HomePage";
import { SettingsPage } from "./components/SettingsPage";
import { VocabularyPage } from "./components/VocabularyPage";
import { ActionsPage } from "./components/ActionsPage";
import { ShortcutsPage } from "./components/ShortcutsPage";
import { Sidebar } from "./components/Sidebar";
import { TranscriptsList } from "./components/TranscriptsList";
import { NotesPage } from "./components/NotesPage";
import { MeetingsPage } from "./components/MeetingsPage";
import type { Meeting } from "./components/meetings/MeetingsListPage";
import { DocsPage, type DocsEntryIntent } from "./components/docs/DocsPage";
import type { Doc } from "./types";
import { useOnboardingStore } from "./store/onboardingStore";
import { useAuthStore } from "./store/authStore";
import { check } from "@tauri-apps/plugin-updater";
import { useAutoUpdater, checkUpdateDetails } from "./hooks/useAutoUpdater";
import { useUpdaterStore } from "./store/updaterStore";
import { useToast } from "./components/toast/useToast";
import { AppLoader } from "./components/ui/AppLoader";

const ONBOARDING_VERSION = 1;

type Page =
  | "home"
  | "transcripts"
  | "settings"
  | "vocabulary"
  | "actions"
  | "shortcuts"
  | "notes"
  | "meetings"
  | "docs";

const LOADING_DELAY_MS = 150; // Only show loading spinner if init takes longer than this (avoids brief flash on first load)
const MEETING_REMINDER_INTERVAL_MINUTES = 45;

function formatMeetingDuration(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours === 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  if (minutes === 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

const PAGE_TRANSITION_VARIANTS = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
  exit: { opacity: 0, y: -8, transition: { duration: 0.18 } },
} as const;

function App() {
  const authStore = useAuthStore();
  const { isCompleted, isInitialized, refreshState } = useOnboardingStore();
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const [onboardingSyncDone, setOnboardingSyncDone] = useState(false);
  const [showLoadingScreen, setShowLoadingScreen] = useState(false);
  const prevCompletedRef = useRef(isCompleted);
  const toast = useToast();
  const lastForegroundedErrorRef = useRef<{ msg: string; at: number } | null>(
    null,
  );

  // Initialize auto-updating background worker
  useAutoUpdater();

  // Global error-to-toast bridge for backend events (so we never fail silently).
  // Brings the main window to the front so the toast is actually visible.
  useEffect(() => {
    let cancelled = false;

    const shouldDedupe = (msg: string) => {
      const now = Date.now();
      const prev = lastForegroundedErrorRef.current;
      if (prev && prev.msg === msg && now - prev.at < 3000) return true;
      lastForegroundedErrorRef.current = { msg, at: now };
      return false;
    };

    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event");

      const showError = async (raw: unknown, fallback: string) => {
        if (cancelled) return;
        const msg =
          typeof raw === "string" && raw.trim().length > 0 ? raw : fallback;
        if (shouldDedupe(msg)) return;
        try {
          await invoke("show_main_window");
        } catch {
          // Best-effort: if window can't be shown, still toast.
        }
        toast.error(msg);
      };

      const unlistenTranscription = await listen<string>(
        "transcription_error",
        (e) => showError(e.payload, "Transcription failed"),
      );
      const unlistenInjection = await listen<string>("injection_error", (e) =>
        showError(e.payload, "Failed to insert text"),
      );
      const unlistenGeneric = await listen<string>("error", (e) =>
        showError(e.payload, "Something went wrong"),
      );
      const unlistenAction = await listen<string>("action_error", (e) =>
        showError(e.payload, "Action failed"),
      );

      return () => {
        unlistenTranscription();
        unlistenInjection();
        unlistenGeneric();
        unlistenAction();
      };
    };

    let unlistenFn: (() => void) | undefined;
    setup()
      .then((fn) => {
        unlistenFn = fn;
      })
      .catch((e) => {
        console.error("Failed to set up global error listeners:", e);
      });

    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  }, [toast]);

  // When a meeting is started from the pill overlay, we want to:
  // 1. Switch to the Meetings page
  // 2. Focus that specific meeting and show its transcript tab
  const [pillMeetingId, setPillMeetingId] = useState<string | null>(null);
  const [meetingReminderModal, setMeetingReminderModal] = useState<{
    meetingId: string;
    readableDuration: string;
  } | null>(null);
  const [
    openSummaryAfterCompleteForMeetingId,
    setOpenSummaryAfterCompleteForMeetingId,
  ] = useState<string | null>(null);
  const [_activeRecordingMeetingId, setActiveRecordingMeetingId] = useState<
    string | null
  >(null);
  const [meetingMicEndedPrompt, setMeetingMicEndedPrompt] = useState<{
    meetingId: string;
  } | null>(null);

  // When not authenticated, reset sync flag so we sync again after next login
  useEffect(() => {
    if (!authStore.isAuthenticated) {
      setOnboardingSyncDone(false);
    }
  }, [authStore.isAuthenticated]);

  // After login: fetch onboarding status from server and sync local state (complete or reset)
  useEffect(() => {
    if (
      !authStore.isInitialized ||
      !authStore.isAuthenticated ||
      onboardingSyncDone
    ) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const status = await invoke<{ is_complete: boolean; version: number }>(
          "get_server_onboarding_status",
          { version: ONBOARDING_VERSION },
        );
        if (cancelled) return;
        if (status.is_complete) {
          await invoke("complete_onboarding");
        } else {
          await invoke("reset_onboarding");
        }
        if (cancelled) return;
        await refreshState();
        if (!cancelled) setOnboardingSyncDone(true);
      } catch (e) {
        if (!cancelled) {
          console.error("Failed to sync onboarding from server:", e);
          setOnboardingSyncDone(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    authStore.isInitialized,
    authStore.isAuthenticated,
    onboardingSyncDone,
    refreshState,
  ]);

  // Whenever we land in the main app (onboarding complete or load with onboarding done), show home
  useEffect(() => {
    if (isCompleted && !prevCompletedRef.current) {
      setCurrentPage("home");
    }
    prevCompletedRef.current = isCompleted;
  }, [isCompleted]);

  // Listen for "Start Meeting" from system tray
  const [pendingTrayMeeting, setPendingTrayMeeting] = useState(false);
  const [pendingTrayMeetingPlatform, setPendingTrayMeetingPlatform] = useState<
    string | null
  >(null);
  const [triggerEndMeetingFromTray, setTriggerEndMeetingFromTray] =
    useState(false);
  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlistenStart = await listen("start-meeting-from-tray", () => {
        if (!cancelled) {
          setPendingTrayMeeting(true);
          setPendingTrayMeetingPlatform("Lexi AI");
          setCurrentPage("meetings");
        }
      });
      const unlistenEnd = await listen("end-meeting-from-tray", () => {
        if (!cancelled) {
          setCurrentPage("meetings");
          setTriggerEndMeetingFromTray(true);
        }
      });
      if (cancelled) {
        unlistenStart();
        unlistenEnd();
      } else {
        return () => {
          unlistenStart();
          unlistenEnd();
        };
      }
    };
    let unlistenFn: (() => void) | undefined;
    setup().then((fn) => {
      unlistenFn = fn;
    });
    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Listen for "Check for Updates" from system tray
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | undefined;

    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen("check-updates-from-tray", async () => {
        if (cancelled) return;
        try {
          const update = await check();
          if (update) {
            const details = await checkUpdateDetails();
            useUpdaterStore.getState().setUpdate(update, details);
            useUpdaterStore.getState().openModal();
          } else {
            toast.info("Lexi AI is up to date");
          }
        } catch (e) {
          console.error("Tray update check failed:", e);
          toast.error("Update check failed");
        }
      });
      unlistenFn = unlisten;
    };

    setup().catch((e) => {
      console.error("Failed to set up check-updates-from-tray listener:", e);
    });

    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  }, [toast]);

  // Listen for meeting recording lifecycle events globally so active
  // recording state survives page navigation.
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | undefined;

    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlistenStarted = await listen<{ meetingId: string }>(
        "meeting-recording-started",
        (event) => {
          if (cancelled) return;
          const payload = event.payload as any;
          const id =
            payload && typeof payload.meetingId === "string"
              ? payload.meetingId
              : null;
          if (!id) return;
          setActiveRecordingMeetingId(id);
          setPillMeetingId(id);
          setCurrentPage("meetings");
        },
      );
      const unlistenStopped = await listen<{ meetingId?: string }>(
        "meeting-recording-stopped",
        () => {
          if (cancelled) return;
          setActiveRecordingMeetingId(null);
        },
      );
      unlistenFn = () => {
        unlistenStarted();
        unlistenStopped();
      };
    };

    setup().catch((e) => {
      console.error("Failed to set up meeting-recording-started listener:", e);
    });

    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // External call likely ended (e.g. Zoom no longer on mic) while Lexi is still recording
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | undefined;

    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<{ meetingId: string }>(
        "meeting-mic-ended",
        (event) => {
          if (cancelled) return;
          const payload = (event.payload || {}) as { meetingId?: string };
          const id =
            typeof payload.meetingId === "string" ? payload.meetingId : null;
          if (!id) return;
          setCurrentPage("meetings");
          setMeetingMicEndedPrompt({ meetingId: id });
        },
      );
      unlistenFn = unlisten;
    };

    setup().catch((e) => {
      console.error("Failed to set up meeting-mic-ended listener:", e);
    });

    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Periodic safety reminder for long-running meetings (every 45 minutes)
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | undefined;

    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<{ meetingId: string; minutes: number }>(
        "meeting-duration-reminder",
        async (event) => {
          if (cancelled) return;
          const payload = (event.payload || {}) as any;
          const meetingId =
            payload && typeof payload.meetingId === "string"
              ? payload.meetingId
              : null;
          const minutes =
            payload && typeof payload.minutes === "number"
              ? payload.minutes
              : MEETING_REMINDER_INTERVAL_MINUTES;
          const readableDuration = formatMeetingDuration(minutes);
          if (meetingId) {
            setMeetingReminderModal({ meetingId, readableDuration });
          }
        },
      );
      unlistenFn = unlisten;
    };

    setup().catch((e) => {
      console.error("Failed to set up meeting-duration-reminder listener:", e);
    });

    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const handleKeepMeetingRunning = () => {
    setMeetingReminderModal(null);
  };

  const handleEndMeetingFromReminder = () => {
    const id = meetingReminderModal?.meetingId;
    if (!id) return;
    setMeetingReminderModal(null);
    void (async () => {
      try {
        await invoke<Meeting>("end_meeting_session", { meetingId: id });
        setCurrentPage("meetings");
        setOpenSummaryAfterCompleteForMeetingId(id);
      } catch (e) {
        console.error("Failed to end meeting from reminder:", e);
        toast.error(e);
      }
    })();
  };

  const dismissMeetingMicEndedPrompt = () => {
    void invoke("dismiss_meeting_end_check_prompt").catch(() => {});
    setMeetingMicEndedPrompt(null);
  };

  const confirmMeetingMicEndedEnd = () => {
    const id = meetingMicEndedPrompt?.meetingId;
    if (!id) return;
    setMeetingMicEndedPrompt(null);
    void (async () => {
      try {
        await invoke<Meeting>("end_meeting_session", { meetingId: id });
        setCurrentPage("meetings");
        setOpenSummaryAfterCompleteForMeetingId(id);
      } catch (e) {
        console.error("Failed to complete meeting after mic-ended prompt:", e);
        toast.error(e);
      }
    })();
  };

  // Navigate to docs page, optionally opening a specific doc (e.g. after creating from meeting)
  const [docsEntryIntent, setDocsEntryIntent] =
    useState<DocsEntryIntent | null>(null);

  useEffect(() => {
    const handleNavigateToDocs = () => {
      setDocsEntryIntent(null);
      setCurrentPage("docs");
    };
    const handleNavigateToDoc = (e: Event) => {
      const ev = e as CustomEvent<{ docId: string; doc?: Doc }>;
      const docId = ev.detail?.docId;
      const doc = ev.detail?.doc;
      if (docId) {
        setDocsEntryIntent({ kind: "open", docId, doc });
      } else {
        setDocsEntryIntent(null);
      }
      setCurrentPage("docs");
    };
    const handleStartMeetingDocGeneration = (e: Event) => {
      const ev = e as CustomEvent<{
        requestId: string;
        meetingId: string;
        instructions: string;
      }>;
      const { requestId, meetingId, instructions } = ev.detail ?? {};
      const trimmed = instructions?.trim();
      if (!(requestId && meetingId && trimmed)) return;

      // Navigate first so Docs mounts as the active page, then deliver the intent on
      // a later frame so generation + invoke run inside DocsPage (avoids batched
      // navigation+intent updates and Strict Mode effect edge cases).
      setDocsEntryIntent(null);
      setCurrentPage("docs");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setDocsEntryIntent({
            kind: "generating-meeting-doc",
            requestId,
            meetingId,
            instructions: trimmed,
          });
        });
      });
    };
    window.addEventListener(
      "lexi-navigate-to-docs",
      handleNavigateToDocs as EventListener,
    );
    window.addEventListener("lexi-navigate-to-doc", handleNavigateToDoc);
    window.addEventListener(
      "lexi-start-meeting-doc-generation",
      handleStartMeetingDocGeneration,
    );
    return () => {
      window.removeEventListener(
        "lexi-navigate-to-docs",
        handleNavigateToDocs as EventListener,
      );
      window.removeEventListener("lexi-navigate-to-doc", handleNavigateToDoc);
      window.removeEventListener(
        "lexi-start-meeting-doc-generation",
        handleStartMeetingDocGeneration,
      );
    };
  }, []);

  const showLoading =
    !authStore.isInitialized ||
    (authStore.isAuthenticated && !onboardingSyncDone) ||
    !isInitialized;

  // Returning users: start tap only after loading (never during splash — avoids stale isCompleted race).
  // First-run users: OnboardingFlow starts the listener only after the Permissions step (hotkey-test+).
  useEffect(() => {
    if (!isCompleted || showLoading) return;
    invoke("start_global_key_listener").catch(() => {});
  }, [isCompleted, showLoading]);

  // Defer showing the loading screen so we don't flash "Loading..." when init finishes in a few ms
  useEffect(() => {
    if (!showLoading) {
      setShowLoadingScreen(false);
      return;
    }
    const id = setTimeout(() => setShowLoadingScreen(true), LOADING_DELAY_MS);
    return () => clearTimeout(id);
  }, [showLoading]);

  if (showLoading) {
    return (
      <div className="app">
        {showLoadingScreen ? (
          <AppLoader />
        ) : (
          <div className="app-loading-screen" />
        )}
      </div>
    );
  }

  // If onboarding is not completed, show onboarding flow
  if (!isCompleted) {
    return <OnboardingFlow />;
  }

  // Render app with sidebar and page content
  return (
    <div className="app">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <div className="main-content">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPage}
            variants={PAGE_TRANSITION_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ flex: 1, display: "flex", flexDirection: "column" }}
          >
            {currentPage === "home" && (
              <HomePage
                onViewAllTranscripts={() => setCurrentPage("transcripts")}
                onNavigate={(page: string) => setCurrentPage(page as Page)}
              />
            )}
            {currentPage === "transcripts" && (
              <div className="container container--transcripts">
                <TranscriptsList />
              </div>
            )}
            {currentPage === "settings" && (
              <div className="container">
                <SettingsPage />
              </div>
            )}
            {currentPage === "vocabulary" && (
              <div className="container">
                <VocabularyPage />
              </div>
            )}
            {currentPage === "actions" && (
              <div className="container">
                <ActionsPage />
              </div>
            )}
            {currentPage === "shortcuts" && (
              <div className="container">
                <ShortcutsPage />
              </div>
            )}
            {currentPage === "notes" && (
              <div className="container">
                <NotesPage />
              </div>
            )}
            {currentPage === "meetings" && (
              <div className="container container--meetings">
                <MeetingsPage
                  autoStart={pendingTrayMeeting}
                  autoStartPlatform={pendingTrayMeetingPlatform}
                  onAutoStartConsumed={() => setPendingTrayMeeting(false)}
                  pillMeetingId={pillMeetingId}
                  onPillMeetingConsumed={() => setPillMeetingId(null)}
                  triggerEndMeetingFromTray={triggerEndMeetingFromTray}
                  onEndMeetingFromTrayConsumed={() =>
                    setTriggerEndMeetingFromTray(false)
                  }
                  openSummaryAfterCompleteForMeetingId={
                    openSummaryAfterCompleteForMeetingId
                  }
                  onOpenSummaryAfterCompleteConsumed={() =>
                    setOpenSummaryAfterCompleteForMeetingId(null)
                  }
                />
              </div>
            )}
            {currentPage === "docs" && (
              <div className="container container--docs">
                <DocsPage
                  entryIntent={docsEntryIntent}
                  onEntryIntentConsumed={() => setDocsEntryIntent(null)}
                />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {meetingReminderModal && (
        <div
          className="delete-modal-overlay"
          onClick={handleKeepMeetingRunning}
        >
          <div
            className="delete-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Meeting still running?</h3>
            <p>
              The meeting has been running for{" "}
              {meetingReminderModal.readableDuration}. Is it still running?
            </p>
            <div className="delete-modal-actions">
              <button
                type="button"
                className="delete-modal-btn-cancel"
                onClick={handleKeepMeetingRunning}
              >
                Keep Running
              </button>
              <button
                type="button"
                className="delete-modal-btn-delete"
                onClick={handleEndMeetingFromReminder}
              >
                End Meeting
              </button>
            </div>
          </div>
        </div>
      )}

      {meetingMicEndedPrompt && (
        <div
          className="delete-modal-overlay"
          onClick={dismissMeetingMicEndedPrompt}
        >
          <div
            className="delete-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Has your meeting ended?</h3>
            <p>
              We no longer detect a meeting session. Do you want to end this
              meeting in Lexi and generate a summary?
            </p>
            <div className="delete-modal-actions">
              <button
                type="button"
                className="delete-modal-btn-cancel"
                onClick={dismissMeetingMicEndedPrompt}
              >
                Keep recording
              </button>
              <button
                type="button"
                className="delete-modal-btn-delete"
                onClick={confirmMeetingMicEndedEnd}
              >
                Yes, end meeting
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

// export const sage = {
//   bg: "#f5f7f4",
//   sidebar: "#eaefe8",
//   sidebarBorder: "#dce4d9",
//   card: "#ffffff",
//   cardBorder: "#e4eae1",
//   accent: "#6b8f6e",
//   accentLight: "#d4e2d4",
//   accentMid: "#8fab8e",
//   text: "#2e3b2f",
//   textMid: "#5a6e5c",
//   textLight: "#8fa48f",
//   textFaint: "#b4c4b5",
//   activeNav: "#ddeadc",
// };
