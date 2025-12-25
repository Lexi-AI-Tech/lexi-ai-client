/**
 * Main App Component
 * 
 * Displays the transcripts list on the homepage.
 */

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { OnboardingFlow } from './components/onboarding/OnboardingFlow'
import { useOnboardingStore } from './store/onboardingStore'
import { useAuthStore } from './store/authStore'
import { TranscriptsList } from './components/TranscriptsList'
import { SettingsPage } from './components/SettingsPage'
import { Sidebar } from './components/Sidebar'

type Page = 'transcripts' | 'settings';

function App() {
  // Check if onboarding is completed
  const { isCompleted } = useOnboardingStore();
  const { tokens } = useAuthStore();
  const [currentPage, setCurrentPage] = useState<Page>('transcripts');
  
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

  // Load and sync config from DB on mount
  useEffect(() => {
    const loadAndSyncConfig = async () => {
      if (!tokens?.access_token) {
        return; // Wait for auth
      }

      try {
        const { getAppConfig } = await import('./lib/apiClient');
        const { getDeviceInfo } = await import('./lib/deviceInfo');
        
        // Detect system type
        const deviceInfo = getDeviceInfo();
        const systemType = deviceInfo.system_type || 'mac';
        
        const config = await getAppConfig(systemType);
        
        // Sync hotkey to Rust backend
        if (config.hotkey) {
          const hotkeyConfig = { hotkey: config.hotkey };
          await invoke('update_hotkey', { configJson: JSON.stringify(hotkeyConfig) });
        }
        
        // Sync language to Rust backend
        if (config.language) {
          await invoke('set_language', { language: config.language });
        }
        
        console.log('✅ Config synced to Rust backend:', config);
      } catch (error) {
        console.warn('Failed to load config from DB (using defaults):', error);
      }
    };

    loadAndSyncConfig();
  }, [tokens?.access_token]);
  
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
          {currentPage === 'transcripts' && <TranscriptsList />}
          {currentPage === 'settings' && <SettingsPage />}
        </div>
      </div>
    </div>
  )
}

export default App
