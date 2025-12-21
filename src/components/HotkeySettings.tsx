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

const DEFAULT_HOTKEY: HotkeyConfig = {
  key: 'Function',
  alt_code: 179,
  modifiers: {
    cmd: false,
    shift: false,
    alt: false,
    ctrl: false,
  },
};

export const HotkeySettings: React.FC = () => {
  const [currentHotkey, setCurrentHotkey] = useState<HotkeyConfig>(DEFAULT_HOTKEY);
  const [selectedHotkey, setSelectedHotkey] = useState<HotkeyConfig>(DEFAULT_HOTKEY);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load current hotkey on mount
  useEffect(() => {
    const loadCurrentHotkey = async () => {
      try {
        const hotkeyJson = await invoke<string>('get_current_hotkey');
        const hotkey: HotkeyConfig = JSON.parse(hotkeyJson);
        setCurrentHotkey(hotkey);
        setSelectedHotkey(hotkey);
      } catch (err) {
        console.error('Failed to load current hotkey:', err);
        setError('Failed to load current hotkey');
      }
    };

    loadCurrentHotkey();
  }, []);

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

  const handleHotkeyChange = async () => {
    // Check if hotkey actually changed
    const isSame = 
      selectedHotkey.key === currentHotkey.key &&
      selectedHotkey.modifiers.cmd === currentHotkey.modifiers.cmd &&
      selectedHotkey.modifiers.shift === currentHotkey.modifiers.shift &&
      selectedHotkey.modifiers.alt === currentHotkey.modifiers.alt &&
      selectedHotkey.modifiers.ctrl === currentHotkey.modifiers.ctrl;

    if (isSame) {
      return; // No change needed
    }

    setIsUpdating(true);
    setError(null);
    setSuccess(false);

    try {
      const configJson = JSON.stringify(selectedHotkey);
      await invoke('update_hotkey', { configJson });
      // The event listener will handle updating the UI
    } catch (err: any) {
      console.error('Failed to update hotkey:', err);
      setError(err || 'Failed to update hotkey');
      setIsUpdating(false);
    }
  };

  const handleHotkeyInputChange = (config: HotkeyConfig) => {
    setSelectedHotkey(config);
  };

  const isHotkeyChanged = 
    selectedHotkey.key !== currentHotkey.key ||
    selectedHotkey.modifiers.cmd !== currentHotkey.modifiers.cmd ||
    selectedHotkey.modifiers.shift !== currentHotkey.modifiers.shift ||
    selectedHotkey.modifiers.alt !== currentHotkey.modifiers.alt ||
    selectedHotkey.modifiers.ctrl !== currentHotkey.modifiers.ctrl;

  return (
    <div className="settings">
      <h3>Hotkey Settings</h3>
      
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
          <button
            className="transcript-btn"
            onClick={handleHotkeyChange}
            disabled={isUpdating || !isHotkeyChanged}
            style={{
              marginTop: '8px',
              padding: '8px 16px',
              fontSize: '11px',
              width: '100%',
              opacity: (isUpdating || !isHotkeyChanged) ? 0.5 : 1,
            }}
          >
            {isUpdating ? 'Updating...' : 'Update Hotkey'}
          </button>
        </div>

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
            Hotkey updated successfully!
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

