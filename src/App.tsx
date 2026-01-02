/**
 * Main App Component
 *
 * Displays the transcripts list on the homepage.
 */

import { useState } from "react";

import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { SettingsPage } from "./components/SettingsPage";
import { Sidebar } from "./components/Sidebar";
import { TranscriptsList } from "./components/TranscriptsList";
import { useOnboardingStore } from "./store/onboardingStore";

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
