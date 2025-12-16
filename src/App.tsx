/**
 * Main App Component
 * 
 * Displays the transcripts list on the homepage.
 */

import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { OnboardingFlow } from './components/onboarding/OnboardingFlow'
import { useOnboardingStore } from './store/onboardingStore'
import { useAuthStore } from './store/authStore'
import { TranscriptsList } from './components/TranscriptsList'

function App() {
  // Check if onboarding is completed
  const { isCompleted } = useOnboardingStore();
  const { tokens } = useAuthStore();
  
  // Sync auth token to Rust backend whenever it changes
  useEffect(() => {
    const syncAuthToken = async () => {
      try {
        const token = tokens?.access_token || null;
        await invoke('set_auth_token', { token });
        console.log('✅ Auth token synced to Rust backend');
      } catch (error) {
        console.error('Failed to sync auth token to Rust:', error);
      }
    };
    
    syncAuthToken();
  }, [tokens?.access_token]);
  
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
