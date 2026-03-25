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
import { DocsPage } from "./components/docs/DocsPage";
import { useOnboardingStore } from "./store/onboardingStore";
import { useAuthStore } from "./store/authStore";
import { useAutoUpdater, checkUpdateDetails } from "./hooks/useAutoUpdater";
import { useUpdaterStore } from "./store/updaterStore";
import { useToast } from "./components/toast/useToast";

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

  // Initialize auto-updating background worker
  useAutoUpdater();

  // When a meeting is started from the pill overlay, we want to:
  // 1. Switch to the Meetings page
  // 2. Focus that specific meeting and show its transcript tab
  const [pillMeetingId, setPillMeetingId] = useState<string | null>(null);
  const [meetingReminderModal, setMeetingReminderModal] = useState<{
    meetingId: string;
    readableDuration: string;
  } | null>(null);
  const [pendingReminderAutoEndMeetingId, setPendingReminderAutoEndMeetingId] =
    useState<string | null>(null);
  const [activeRecordingMeetingId, setActiveRecordingMeetingId] = useState<
    string | null
  >(null);

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

  // Whenever we land in the main app (complete/skip onboarding or load with onboarding done), show home
  useEffect(() => {
    if (isCompleted && !prevCompletedRef.current) {
      setCurrentPage("home");
    }
    prevCompletedRef.current = isCompleted;
  }, [isCompleted]);

  // Start the global key listener only when onboarding is complete AND input monitoring
  // is already granted. This avoids triggering the macOS Input Monitoring popup before
  // the user has reached the permissions page (e.g. when server says onboarding complete
  // from another device). After the user grants the permission and restarts, this will
  // start the listener on next launch.
  useEffect(() => {
    if (!isCompleted) return;
    invoke<boolean>("check_input_monitoring_permission")
      .then((granted) => {
        if (granted) {
          invoke("start_global_key_listener").catch(() => {});
        }
      })
      .catch(() => {});
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
          const { check } = await import("@tauri-apps/plugin-updater");
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
    if (!meetingReminderModal?.meetingId) return;
    // Run the same full end flow as the Meetings "End" button:
    // stop recording, switch to summary tab, and generate summary.
    setPendingReminderAutoEndMeetingId(meetingReminderModal.meetingId);
    setCurrentPage("meetings");
    setMeetingReminderModal(null);
  };

  // Navigate to docs page, optionally opening a specific doc (e.g. after creating from meeting)
  const [selectedDocIdToOpen, setSelectedDocIdToOpen] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const handleNavigateToDocs = () => {
      setSelectedDocIdToOpen(null);
      setCurrentPage("docs");
    };
    const handleNavigateToDoc = (e: Event) => {
      const ev = e as CustomEvent<{ docId: string }>;
      const docId = ev.detail?.docId;
      if (docId) {
        setSelectedDocIdToOpen(docId);
      } else {
        setSelectedDocIdToOpen(null);
      }
      setCurrentPage("docs");
    };
    window.addEventListener(
      "lexi-navigate-to-docs",
      handleNavigateToDocs as EventListener,
    );
    window.addEventListener("lexi-navigate-to-doc", handleNavigateToDoc);
    return () => {
      window.removeEventListener(
        "lexi-navigate-to-docs",
        handleNavigateToDocs as EventListener,
      );
      window.removeEventListener("lexi-navigate-to-doc", handleNavigateToDoc);
    };
  }, []);

  const showLoading =
    !authStore.isInitialized ||
    (authStore.isAuthenticated && !onboardingSyncDone) ||
    !isInitialized;

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
        <div className="app-loading-screen">
          {showLoadingScreen ? <div className="app-loading-spinner" /> : null}
        </div>
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
                />
              </div>
            )}
            {currentPage === "docs" && (
              <div className="container container--docs">
                <DocsPage
                  initialSelectedDocId={selectedDocIdToOpen}
                  onInitialDocConsumed={() => setSelectedDocIdToOpen(null)}
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
