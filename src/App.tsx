/**
 * Main App Component
 * 
 * Displays the transcripts list on the homepage.
 */

import { OnboardingFlow } from './components/onboarding/OnboardingFlow'
import { useOnboardingStore } from './store/onboardingStore'
import { TranscriptsList } from './components/TranscriptsList'

function App() {
  // Check if onboarding is completed
  const { isCompleted } = useOnboardingStore();
  
  // If onboarding is not completed, show onboarding flow
  if (!isCompleted) {
    return <OnboardingFlow />;
  }

  // Render only the transcripts list
  return (
    <div className="app">
      <div className="container">
        <TranscriptsList />
      </div>
    </div>
  )
}

export default App
