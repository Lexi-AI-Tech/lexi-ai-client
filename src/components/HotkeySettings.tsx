/**
 * HotkeySettings Component
 * 
 * Allows users to configure the hotkey that triggers recording.
 * Supports any key combination including modifiers (Cmd, Shift, Alt, Ctrl).
 */

import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { HotkeyInput, HotkeyConfig } from './HotkeyInput';
import { getAppConfig, updateAppConfig } from '../lib/apiClient';
import { useAuthStore } from '../store/authStore';

const DEFAULT_HOTKEY: HotkeyConfig = {
  hotkey: 'Fn',
};

// Supported languages for transcription
const SUPPORTED_LANGUAGES = [
  { value: 'auto', label: 'Auto (Detect Language)' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'sv', label: 'Swedish' },
  { value: 'da', label: 'Danish' },
  { value: 'no', label: 'Norwegian' },
  { value: 'fi', label: 'Finnish' },
];

export const HotkeySettings: React.FC = () => {
  const { tokens } = useAuthStore();
  const [currentHotkey, setCurrentHotkey] = useState<HotkeyConfig>(DEFAULT_HOTKEY);
  const [selectedHotkey, setSelectedHotkey] = useState<HotkeyConfig>(DEFAULT_HOTKEY);
  const [currentLanguage, setCurrentLanguage] = useState<string>('en');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');
  const [systemType, setSystemType] = useState<'mac' | 'windows'>('mac');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load current config from DB on mount and when auth token changes
  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        // Detect system type
        const { getDeviceInfo } = await import('../lib/deviceInfo');
        const deviceInfo = getDeviceInfo();
        const detectedSystemType = deviceInfo.system_type || 'mac';
        setSystemType(detectedSystemType);

        // Always load from Rust backend first (for hotkey)
        try {
          const hotkeyJson = await invoke<string>('get_current_hotkey');
          const hotkey: HotkeyConfig = JSON.parse(hotkeyJson);
          setCurrentHotkey(hotkey);
          setSelectedHotkey(hotkey);
        } catch (rustErr) {
          console.warn('Failed to load hotkey from Rust backend:', rustErr);
        }

        // Load from DB only if user is authenticated
        if (tokens?.access_token) {
          try {
            const config = await getAppConfig(detectedSystemType);
            if (config.hotkey) {
              const dbHotkey: HotkeyConfig = { hotkey: config.hotkey };
              setCurrentHotkey(dbHotkey);
              setSelectedHotkey(dbHotkey);
              // Update Rust backend with DB hotkey
              await invoke('update_hotkey', { configJson: JSON.stringify(dbHotkey) });
            }
            if (config.language) {
              setCurrentLanguage(config.language);
              setSelectedLanguage(config.language);
            }
          } catch (dbErr: any) {
            console.warn('Failed to load config from DB, using defaults:', dbErr);
            // If DB fails, we'll use the Rust backend values as defaults
            if (dbErr?.message?.includes('401') || dbErr?.message?.includes('Unauthorized')) {
              setError('Please log in to save your configuration');
            }
          }
        } else {
          console.log('User not authenticated, using default config');
        }
      } catch (err: any) {
        console.error('Failed to load config:', err);
        setError(err?.message || 'Failed to load configuration');
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();
  }, [tokens?.access_token]);

  // Listen for hotkey updates from backend
  useEffect(() => {
    const setupListener = async () => {
      const unlisten = await listen<string>('hotkey-updated', (event) => {
        try {
          const hotkey: HotkeyConfig = JSON.parse(event.payload);
          setCurrentHotkey(hotkey);
          setSelectedHotkey(hotkey);
          setSuccess(true);
          setIsUpdating(false);
          setError(null);
          
          // Clear success message after 2 seconds
          setTimeout(() => setSuccess(false), 2000);
        } catch (err) {
          console.error('Failed to parse hotkey update:', err);
        }
      });

      return unlisten;
    };

    let unlistenFn: (() => void) | undefined;
    setupListener().then(unlisten => {
      unlistenFn = unlisten;
    });

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, []);

  const handleSaveConfig = async () => {
    // Check if anything changed
    const hotkeyChanged = selectedHotkey.hotkey !== currentHotkey.hotkey;
    const languageChanged = selectedLanguage !== currentLanguage;
    
    if (!hotkeyChanged && !languageChanged) {
      return; // No change needed
    }

    setIsUpdating(true);
    setError(null);
    setSuccess(false);

    try {
      // Update Rust backend if hotkey changed (works even without auth)
      if (hotkeyChanged) {
        const configJson = JSON.stringify(selectedHotkey);
        await invoke('update_hotkey', { configJson });
      }

      // Save to DB only if user is authenticated
      if (tokens?.access_token) {
        // Save to DB (both hotkey and language) with system type
        // Always send both values to ensure consistency
        const updateData: { system_type: string; hotkey: string; language: string } = {
          system_type: systemType,
          hotkey: selectedHotkey.hotkey,
          language: selectedLanguage,
        };

        await updateAppConfig(updateData);

        // Reload config from DB to get the latest values
        try {
          const updatedConfig = await getAppConfig(systemType);
          if (updatedConfig.hotkey) {
            const dbHotkey: HotkeyConfig = { hotkey: updatedConfig.hotkey };
            setCurrentHotkey(dbHotkey);
            setSelectedHotkey(dbHotkey);
          }
          if (updatedConfig.language) {
            setCurrentLanguage(updatedConfig.language);
            setSelectedLanguage(updatedConfig.language);
          }
        } catch (reloadErr) {
          console.warn('Failed to reload config after update:', reloadErr);
          // Still update local state even if reload fails
          if (hotkeyChanged) {
            setCurrentHotkey(selectedHotkey);
          }
          if (languageChanged) {
            setCurrentLanguage(selectedLanguage);
          }
        }
      } else {
        // If not authenticated, just update local state
        console.log('User not authenticated, saving only to local Rust backend');
        if (hotkeyChanged) {
          setCurrentHotkey(selectedHotkey);
        }
        if (languageChanged) {
          setCurrentLanguage(selectedLanguage);
        }
      }

      setSuccess(true);
      setIsUpdating(false);
      
      // Clear success message after 2 seconds
      setTimeout(() => setSuccess(false), 2000);
    } catch (err: any) {
      console.error('Failed to update config:', err);
      setError(err?.message || 'Failed to update configuration');
      setIsUpdating(false);
    }
  };

  const handleHotkeyInputChange = (config: HotkeyConfig) => {
    setSelectedHotkey(config);
  };

  const isHotkeyChanged = selectedHotkey.hotkey !== currentHotkey.hotkey;
  const isLanguageChanged = selectedLanguage !== currentLanguage;
  const hasChanges = isHotkeyChanged || isLanguageChanged;

  if (isLoading) {
    return (
      <div className="settings">
        <h3>Hotkey Settings</h3>
        <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '11px' }}>
          Loading configuration...
        </div>
      </div>
    );
  }

  return (
    <div className="settings">
      <h3>Hotkey Settings</h3>
      
      {!tokens?.access_token && (
        <div className="permission-message" style={{ 
          background: 'rgba(255, 193, 7, 0.1)', 
          borderColor: 'rgba(255, 193, 7, 0.2)', 
          color: 'rgba(255, 193, 7, 0.9)',
          fontSize: '11px',
          padding: '8px',
          marginBottom: '12px',
        }}>
          Please log in to save your configuration to the cloud. Changes will only be saved locally until you log in.
        </div>
      )}
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <div style={{ 
            fontSize: '11px', 
            color: 'rgba(255, 255, 255, 0.6)', 
            marginBottom: '8px' 
          }}>
            Current Hotkey
          </div>
          <HotkeyInput
            value={currentHotkey}
            onChange={() => {}} // Read-only
            disabled={true}
          />
          <div style={{ 
            fontSize: '10px', 
            color: 'rgba(255, 255, 255, 0.5)', 
            marginTop: '6px' 
          }}>
            Press this combination to start/stop recording
          </div>
        </div>

        <div>
          <div style={{ 
            fontSize: '11px', 
            color: 'rgba(255, 255, 255, 0.6)', 
            marginBottom: '8px' 
          }}>
            Change Hotkey
          </div>
          <HotkeyInput
            value={selectedHotkey}
            onChange={handleHotkeyInputChange}
            disabled={isUpdating}
          />
        </div>

        <div>
          <div style={{ 
            fontSize: '11px', 
            color: 'rgba(255, 255, 255, 0.6)', 
            marginBottom: '8px' 
          }}>
            Transcription Language
          </div>
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            disabled={isUpdating}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '11px',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '6px',
              color: '#ffffff',
              cursor: isUpdating ? 'not-allowed' : 'pointer',
              opacity: isUpdating ? 0.5 : 1,
            }}
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
          <div style={{ 
            fontSize: '10px', 
            color: 'rgba(255, 255, 255, 0.5)', 
            marginTop: '6px' 
          }}>
            {selectedLanguage === 'auto' 
              ? 'Language will be automatically detected from audio'
              : `Transcription will be limited to ${SUPPORTED_LANGUAGES.find(l => l.value === selectedLanguage)?.label || selectedLanguage}`
            }
          </div>
        </div>

        <button
          className="transcript-btn"
          onClick={handleSaveConfig}
          disabled={isUpdating || !hasChanges}
          style={{
            marginTop: '8px',
            padding: '8px 16px',
            fontSize: '11px',
            width: '100%',
            opacity: (isUpdating || !hasChanges) ? 0.5 : 1,
          }}
        >
          {isUpdating ? 'Saving...' : 'Save Configuration'}
        </button>

        {error && (
          <div className="permission-message" style={{ 
            background: 'rgba(255, 59, 48, 0.1)', 
            borderColor: 'rgba(255, 59, 48, 0.2)', 
            color: 'rgba(255, 59, 48, 0.9)',
            fontSize: '11px',
            padding: '8px',
          }}>
            {error}
          </div>
        )}

        {success && (
          <div className="permission-message" style={{ 
            background: 'rgba(52, 199, 89, 0.1)', 
            borderColor: 'rgba(52, 199, 89, 0.2)', 
            color: 'rgba(52, 199, 89, 0.9)',
            fontSize: '11px',
            padding: '8px',
          }}>
            Configuration saved successfully!
          </div>
        )}

        <div style={{ 
          fontSize: '10px', 
          color: 'rgba(255, 255, 255, 0.4)', 
          marginTop: '4px',
          lineHeight: '1.4',
        }}>
          The listener will restart automatically when you change the hotkey.
        </div>
      </div>
    </div>
  );
};

