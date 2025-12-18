/**
 * Main App Component
 * 
 * Displays the transcripts list on the homepage.
 */

import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { OnboardingFlow } from './components/onboarding/OnboardingFlow'
import { OAuthCallback } from './components/auth/OAuthCallback'
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
  
  // OAuth callback route - handle separately from main app flow
  return (
    <Routes>
      <Route path="/auth/google/callback" element={<OAuthCallback />} />
      <Route
        path="*"
        element={
          // If onboarding is not completed, show onboarding flow
          !isCompleted ? (
            <OnboardingFlow />
          ) : (
            // Render only the transcripts list
            <div className="app">
              <div className="container">
                <TranscriptsList />
              </div>
            </div>
          )
        }
      />
    </Routes>
  )
}

export default App
