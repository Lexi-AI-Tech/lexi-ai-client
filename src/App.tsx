/**
 * Main App Component
 *
 * Displays the transcripts list on the homepage.
 */

import { useState } from "react";

import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { SettingsPage } from "./components/SettingsPage";
import { VocabularyPage } from "./components/VocabularyPage";
import { ActionsPage } from "./components/ActionsPage";
import { ShortcutsPage } from "./components/ShortcutsPage";
import { Sidebar } from "./components/Sidebar";
import { TranscriptsList } from "./components/TranscriptsList";
import { useOnboardingStore } from "./store/onboardingStore";

type Page = "transcripts" | "settings" | "vocabulary" | "actions" | "shortcuts";

function App() {
  // Check if onboarding is completed
  const { isCompleted, isInitialized } = useOnboardingStore();
  const [currentPage, setCurrentPage] = useState<Page>("transcripts");

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
            color: "rgba(255, 255, 255, 0.6)",
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
        <div className="container">
          {currentPage === "transcripts" && <TranscriptsList />}
          {currentPage === "settings" && <SettingsPage />}
          {currentPage === "vocabulary" && <VocabularyPage />}
          {currentPage === "actions" && <ActionsPage />}
          {currentPage === "shortcuts" && <ShortcutsPage />}
        </div>
      </div>
    </div>
  );
}

export default App;
