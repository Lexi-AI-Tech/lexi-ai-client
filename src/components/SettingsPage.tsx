import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

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
        // Stop Rust-side hotkey recording
        await invoke('stop_hotkey_recording');
      }
    } catch (error) {
      console.error('Failed to save hotkey config:', error);
    }
  };

  const startRecording = async () => {
    setIsRecording(true);
    setRecordedKeys(null);
    // Start Rust-side hotkey recording to capture Fn key
    try {
      await invoke('start_hotkey_recording');
    } catch (error) {
      console.error('Failed to start hotkey recording:', error);
    }
  };

  const cancelRecording = async () => {
    setIsRecording(false);
    setRecordedKeys(null);
    // Stop Rust-side hotkey recording
    try {
      await invoke('stop_hotkey_recording');
    } catch (error) {
      console.error('Failed to stop hotkey recording:', error);
    }
  };

  const formatHotkey = (conf: HotkeyConfig) => {
    if (!conf) return 'None';
    const parts = [...conf.modifiers, conf.key];
    return parts.join(' + ');
  };

  // Listen for hotkey events from Rust (for Fn key and other special keys)
  useEffect(() => {
    if (!isRecording) return;

    const unlisten = listen<{ key: string; modifiers: string[] }>('hotkey-recorded', (event) => {
      console.log('Hotkey recorded from Rust:', event.payload);
      setRecordedKeys({
        key: event.payload.key,
        modifiers: event.payload.modifiers
      });
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [isRecording]);

  // Handle key events during recording (browser events for regular keys)
  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Use e.code for physical key detection (more reliable for special keys)
      const code = e.code;
      const key = e.key;
      
      // Debug logging
      console.log('Key event:', { code, key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey });

      // Map key codes to expected format
      const mapCodeToKey = (code: string, key: string): string => {
        // Function keys
        if (code.startsWith('F')) {
          return code; // F1, F2, etc.
        }
        
        // Special keys by code
        switch (code) {
          case 'Space': return 'Space';
          case 'Enter': return 'Enter';
          case 'Escape': return 'Escape';
          case 'Tab': return 'Tab';
          case 'Backspace': return 'Backspace';
          case 'ArrowUp': return 'Up';
          case 'ArrowDown': return 'Down';
          case 'ArrowLeft': return 'Left';
          case 'ArrowRight': return 'Right';
          
          // Modifier keys - detect by code
          case 'MetaLeft':
          case 'MetaRight':
            return 'Command';
          case 'ControlLeft':
          case 'ControlRight':
            return 'Control';
          case 'AltLeft':
          case 'AltRight':
            return 'Option';
          case 'ShiftLeft':
          case 'ShiftRight':
            return 'Shift';
          
          // Function key (Fn) - Note: Fn key is often not detectable in browsers
          // On macOS, Fn key might not be exposed, but we try to detect it
          case 'Fn':
            return 'Function';
          
          // Digits
          case 'Digit0': return '0';
          case 'Digit1': return '1';
          case 'Digit2': return '2';
          case 'Digit3': return '3';
          case 'Digit4': return '4';
          case 'Digit5': return '5';
          case 'Digit6': return '6';
          case 'Digit7': return '7';
          case 'Digit8': return '8';
          case 'Digit9': return '9';
          
          // Letters
          case 'KeyA': return 'A';
          case 'KeyB': return 'B';
          case 'KeyC': return 'C';
          case 'KeyD': return 'D';
          case 'KeyE': return 'E';
          case 'KeyF': return 'F';
          case 'KeyG': return 'G';
          case 'KeyH': return 'H';
          case 'KeyI': return 'I';
          case 'KeyJ': return 'J';
          case 'KeyK': return 'K';
          case 'KeyL': return 'L';
          case 'KeyM': return 'M';
          case 'KeyN': return 'N';
          case 'KeyO': return 'O';
          case 'KeyP': return 'P';
          case 'KeyQ': return 'Q';
          case 'KeyR': return 'R';
          case 'KeyS': return 'S';
          case 'KeyT': return 'T';
          case 'KeyU': return 'U';
          case 'KeyV': return 'V';
          case 'KeyW': return 'W';
          case 'KeyX': return 'X';
          case 'KeyY': return 'Y';
          case 'KeyZ': return 'Z';
          
          default:
            // Fallback to key name if code doesn't match
            if (key.length === 1) {
              return key.toUpperCase();
            }
            return key;
        }
      };

      const mappedKey = mapCodeToKey(code, key);
      
      // Build modifiers array
      const modifiers: string[] = [];
      
      // Check if the current key is a modifier key
      const isCurrentKeyModifier = ['Command', 'Control', 'Option', 'Shift'].includes(mappedKey);
      
      // Only add modifiers that are NOT the current key being pressed
      if (e.metaKey && mappedKey !== 'Command') {
        modifiers.push('Command');
      }
      
      if (e.ctrlKey && mappedKey !== 'Control') {
        modifiers.push('Control');
      }
      
      if (e.altKey && mappedKey !== 'Option') {
        modifiers.push('Option');
      }
      
      if (e.shiftKey && mappedKey !== 'Shift') {
        modifiers.push('Shift');
      }

      // Allow modifier keys to be used as the main key (e.g., Command alone, Fn alone)
      // Set the recorded keys
      setRecordedKeys({
        key: mappedKey,
        modifiers
      });
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
          <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.85)', marginBottom: '8px' }}>
            Press the shortcut to start/stop recording. The Fn key and other special keys are detected via the system.
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

