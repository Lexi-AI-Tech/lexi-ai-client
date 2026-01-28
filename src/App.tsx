/**
 * Main App Component
 *
 * Main app with home dashboard, transcripts, and settings.
 */

import { useState } from "react";

import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { HomePage } from "./components/home/HomePage";
import { SettingsPage } from "./components/SettingsPage";
import { VocabularyPage } from "./components/VocabularyPage";
import { ActionsPage } from "./components/ActionsPage";
import { ShortcutsPage } from "./components/ShortcutsPage";
import { RoomsPage } from "./components/RoomsPage";
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
  | "rooms";

function App() {
  // Check if onboarding is completed
  const { isCompleted, isInitialized } = useOnboardingStore();
  const [currentPage, setCurrentPage] = useState<Page>("home");

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
        {currentPage === "home" && <HomePage />}
        {currentPage === "transcripts" && (
          <div className="container">
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
        {currentPage === "rooms" && (
          <div className="container">
            <RoomsPage />
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
