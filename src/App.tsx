/**
 * Main App Component
 *
 * Displays the transcripts list on the homepage.
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { useOnboardingStore } from "./store/onboardingStore";
import { useAuthStore } from "./store/authStore";
import { TranscriptsList } from "./components/TranscriptsList";
import { SettingsPage } from "./components/SettingsPage";
import { Sidebar } from "./components/Sidebar";

type Page = "transcripts" | "settings";

function App() {
  // Check if onboarding is completed
  const { isCompleted } = useOnboardingStore();
  const [currentPage, setCurrentPage] = useState<Page>("transcripts");

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
        </div>
      </div>
    </div>
  );
}

export default App;
