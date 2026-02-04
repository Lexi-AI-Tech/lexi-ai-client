/**
 * Main App Component
 *
 * Main app with home dashboard, transcripts, and settings.
 * When Rust detects auth errors (e.g. token refresh fails), it clears auth and resets
 * onboarding, then emits auth_expired; the frontend syncs state and shows onboarding.
 */

import { useState, useEffect, useRef } from "react";

import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { HomePage } from "./components/home/HomePage";
import { SettingsPage } from "./components/SettingsPage";
import { VocabularyPage } from "./components/VocabularyPage";
import { ActionsPage } from "./components/ActionsPage";
import { ShortcutsPage } from "./components/ShortcutsPage";
import { Sidebar } from "./components/Sidebar";
import { TranscriptsList } from "./components/TranscriptsList";
import { NotesPage } from "./components/NotesPage";
import { useOnboardingStore } from "./store/onboardingStore";

type Page =
  | "home"
  | "transcripts"
  | "settings"
  | "vocabulary"
  | "actions"
  | "shortcuts"
  | "notes"

function App() {
  const { isCompleted, isInitialized } = useOnboardingStore();
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const prevCompletedRef = useRef(isCompleted);

  // Whenever we land in the main app (complete/skip onboarding or load with onboarding done), show home
  useEffect(() => {
    if (isCompleted && !prevCompletedRef.current) {
      setCurrentPage("home");
    }
    prevCompletedRef.current = isCompleted;
  }, [isCompleted]);

  // Wait for onboarding state to initialize before deciding what to show
  if (!isInitialized) {
    return (
      <div className="app">
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100vh",
            color: "rgba(0, 0, 0, 0.6)",
          }}
        >
          Loading...
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
      </div>
    </div>
  );
}

export default App;
