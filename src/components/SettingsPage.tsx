import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface HotkeyConfig {
  key: string;
  modifiers: string[];
}

export const SettingsPage: React.FC = () => {
  const [config, setConfig] = useState<HotkeyConfig>({ key: 'Function', modifiers: [] });
  const [isRecording, setIsRecording] = useState(false);
  const [recordedKeys, setRecordedKeys] = useState<{ key: string, modifiers: string[] } | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const currentConfig = await invoke<HotkeyConfig>('get_hotkey_config');
      setConfig(currentConfig);
    } catch (error) {
      console.error('Failed to load hotkey config:', error);
    }
  };

  const handleSave = async () => {
    try {
      if (recordedKeys) {
        await invoke('set_hotkey_config', { config: recordedKeys });
        setConfig(recordedKeys);
        setRecordedKeys(null);
        setIsRecording(false);
      }
    } catch (error) {
      console.error('Failed to save hotkey config:', error);
    }
  };

  const startRecording = () => {
    setIsRecording(true);
    setRecordedKeys(null);
  };

  const cancelRecording = () => {
    setIsRecording(false);
    setRecordedKeys(null);
  };

  const formatHotkey = (conf: HotkeyConfig) => {
    if (!conf) return 'None';
    const parts = [...conf.modifiers, conf.key];
    return parts.join(' + ');
  };

  // Handle key events during recording
  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const modifiers = [];
      if (e.metaKey) modifiers.push('Command');
      if (e.ctrlKey) modifiers.push('Control');
      if (e.altKey) modifiers.push('Option');
      if (e.shiftKey) modifiers.push('Shift');

      // Map key code to user friendly name
      let key = e.key;
      
      // Clean up key names
      if (key === ' ') key = 'Space';
      if (key === 'ArrowUp') key = 'Up';
      if (key === 'ArrowDown') key = 'Down';
      if (key === 'ArrowLeft') key = 'Left';
      if (key === 'ArrowRight') key = 'Right';
      
      // Ignore modifier-only key presses as the final key
      const isModifierKey = ['Meta', 'Control', 'Alt', 'Shift', 'Command', 'Option'].includes(key);
      
      if (!isModifierKey) {
        setRecordedKeys({
          key: key.length === 1 ? key.toUpperCase() : key,
          modifiers
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isRecording]);

  return (
    <div className="settings-page">
      <h2 style={{ margin: 0, marginBottom: '32px', fontSize: '24px', fontWeight: 600, color: '#ffffff' }}>Settings</h2>

      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#ffffff', marginBottom: '16px' }}>
          Global Shortcut
        </h3>
        <div style={{ 
          background: 'rgba(50, 50, 50, 0.8)', 
          padding: '20px', 
          borderRadius: '10px',
          border: isRecording ? '2px solid #007AFF' : '1px solid rgba(255,255,255,0.25)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
        }}>
          <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.85)' }}>
            Press the shortcut to start/stop recording.
          </div>
          
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{ 
              flex: 1, 
              background: 'rgba(20, 20, 20, 0.8)', 
              padding: '12px', 
              borderRadius: '8px',
              textAlign: 'center',
              fontFamily: 'monospace',
              fontSize: '16px',
              color: isRecording ? '#5AC8FA' : '#ffffff',
              border: '1px solid rgba(255,255,255,0.2)',
              fontWeight: 500
            }}>
              {isRecording 
                ? (recordedKeys ? formatHotkey(recordedKeys) : 'Press keys...')
                : formatHotkey(config)
              }
            </div>
            
            {!isRecording ? (
              <button 
                onClick={startRecording}
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  color: '#ffffff',
                  padding: '12px 20px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 600,
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.25)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
                }}
              >
                Edit
              </button>
            ) : (
              <>
                <button 
                  onClick={handleSave}
                  disabled={!recordedKeys}
                  style={{
                    background: !recordedKeys ? 'rgba(0, 122, 255, 0.4)' : '#007AFF',
                    border: 'none',
                    color: 'white',
                    padding: '12px 20px',
                    borderRadius: '8px',
                    cursor: !recordedKeys ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    fontWeight: 600,
                    opacity: !recordedKeys ? 0.6 : 1,
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (recordedKeys) {
                      e.currentTarget.style.background = '#0051D5';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (recordedKeys) {
                      e.currentTarget.style.background = '#007AFF';
                    }
                  }}
                >
                  Save
                </button>
                <button 
                  onClick={cancelRecording}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.3)',
                    color: 'rgba(255,255,255,0.9)',
                    padding: '12px 20px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 600,
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)';
                  }}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

