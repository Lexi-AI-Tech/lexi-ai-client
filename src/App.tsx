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
import { MeetingDetectorModal } from "./components/MeetingDetectorModal";
import { useOnboardingStore } from "./store/onboardingStore";
import { useAuthStore } from "./store/authStore";

const ONBOARDING_VERSION = 1;

type Page =
  | "home"
  | "transcripts"
  | "settings"
  | "vocabulary"
  | "actions"
  | "shortcuts"
  | "notes"
  | "meetings";

const LOADING_DELAY_MS = 150; // Only show loading spinner if init takes longer than this (avoids brief flash on first load)

function App() {
  const authStore = useAuthStore();
  const { isCompleted, isInitialized, refreshState } = useOnboardingStore();
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const [onboardingSyncDone, setOnboardingSyncDone] = useState(false);
  const [showLoadingScreen, setShowLoadingScreen] = useState(false);
  const prevCompletedRef = useRef(isCompleted);

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
          invoke("start_global_key_listener").catch(() => { });
        }
      })
      .catch(() => { });
  }, [isCompleted]);

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
      <MeetingDetectorModal />
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <div className="main-content">
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
          <div className="container">
            <MeetingsPage />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
