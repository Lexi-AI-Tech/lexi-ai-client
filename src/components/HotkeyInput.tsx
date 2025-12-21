/**
 * HotkeyInput Component
 * 
 * A component that captures keyboard key combinations including modifiers.
 * Users can press any key combination and it will be displayed and captured.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface HotkeyConfig {
  key: string;
  alt_code?: number;
  modifiers: {
    cmd: boolean;
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
  };
}

interface HotkeyInputProps {
  value: HotkeyConfig;
  onChange: (config: HotkeyConfig) => void;
  disabled?: boolean;
}

// Map browser key names to rdev Key enum format
const normalizeKeyName = (key: string): string => {
  const keyMap: Record<string, string> = {
    'Meta': 'MetaLeft',  // Cmd on macOS
    'Control': 'ControlLeft',
    'Alt': 'Alt',
    'Shift': 'ShiftLeft',
    ' ': 'Space',
    'Enter': 'Return',
    'ArrowUp': 'UpArrow',
    'ArrowDown': 'DownArrow',
    'ArrowLeft': 'LeftArrow',
    'ArrowRight': 'RightArrow',
  };

  // Handle function keys
  if (key.startsWith('F') && /^F\d+$/.test(key)) {
    return key; // F1, F2, etc.
  }

  // Handle number keys
  if (/^\d$/.test(key)) {
    return `Num${key}`;
  }

  // Handle letter keys
  if (/^[a-zA-Z]$/.test(key)) {
    return `Key${key.toUpperCase()}`;
  }

  return keyMap[key] || key;
};

export const HotkeyInput: React.FC<HotkeyInputProps> = ({ value, onChange, disabled = false }) => {
  const [isCapturing, setIsCapturing] = useState(false);
  const [displayText, setDisplayText] = useState('');
  const inputRef = useRef<HTMLDivElement>(null);
  const [rustRecordingActive, setRustRecordingActive] = useState(false);
  const pendingKeyRef = useRef<{ key: string; modifiers: { cmd: boolean; ctrl: boolean; alt: boolean; shift: boolean } } | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const updateDisplayText = useCallback((config: HotkeyConfig) => {
    const parts: string[] = [];
    
    if (config.modifiers.cmd) {
      parts.push('⌘');
    }
    if (config.modifiers.ctrl) {
      parts.push('⌃');
    }
    if (config.modifiers.alt) {
      parts.push('⌥');
    }
    if (config.modifiers.shift) {
      parts.push('⇧');
    }

    // Format the main key
    let keyDisplay = config.key;
    if (keyDisplay.startsWith('Key')) {
      keyDisplay = keyDisplay.substring(3); // Remove "Key" prefix
    } else if (keyDisplay.startsWith('Num')) {
      keyDisplay = keyDisplay.substring(3); // Remove "Num" prefix
    } else if (keyDisplay === 'Space') {
      keyDisplay = 'Space';
    } else if (keyDisplay === 'Return') {
      keyDisplay = 'Enter';
    } else if (keyDisplay === 'MetaLeft' || keyDisplay === 'MetaRight') {
      keyDisplay = '⌘';
    } else if (keyDisplay === 'ControlLeft' || keyDisplay === 'ControlRight') {
      keyDisplay = '⌃';
    } else if (keyDisplay === 'Alt') {
      keyDisplay = '⌥';
    } else if (keyDisplay === 'ShiftLeft' || keyDisplay === 'ShiftRight') {
      keyDisplay = '⇧';
    } else if (keyDisplay === 'Function') {
      keyDisplay = 'Fn';
    }

    parts.push(keyDisplay);
    setDisplayText(parts.join(' + '));
  }, []);

  // Update display text when value changes
  useEffect(() => {
    updateDisplayText(value);
  }, [value, updateDisplayText]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled || !isCapturing) return;
    
    // If Rust recording is active, prefer Rust events (they're more reliable for Fn and modifiers)
    // Only use browser events as fallback
    if (rustRecordingActive) {
      // Still prevent default but don't process - wait for Rust event
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    // Use e.code for physical key detection (more reliable for special keys)
    const code = (e.nativeEvent as KeyboardEvent).code;
    const key = e.key;

    // Map key codes to expected format
    const mapCodeToKey = (code: string, key: string): string => {
      // Function keys
      if (code.startsWith('F')) {
        return code; // F1, F2, etc.
      }
      
      // Special keys by code
      switch (code) {
        case 'Space': return 'Space';
        case 'Enter': return 'Return';
        case 'Escape': return 'Escape';
        case 'Tab': return 'Tab';
        case 'Backspace': return 'Backspace';
        case 'ArrowUp': return 'UpArrow';
        case 'ArrowDown': return 'DownArrow';
        case 'ArrowLeft': return 'LeftArrow';
        case 'ArrowRight': return 'RightArrow';
        
        // Modifier keys - detect by code
        case 'MetaLeft':
        case 'MetaRight':
          return 'MetaLeft'; // Use MetaLeft as the standard
        case 'ControlLeft':
        case 'ControlRight':
          return 'ControlLeft';
        case 'AltLeft':
        case 'AltRight':
          return 'Alt';
        case 'ShiftLeft':
        case 'ShiftRight':
          return 'ShiftLeft';
        
        // Digits
        case 'Digit0': return 'Num0';
        case 'Digit1': return 'Num1';
        case 'Digit2': return 'Num2';
        case 'Digit3': return 'Num3';
        case 'Digit4': return 'Num4';
        case 'Digit5': return 'Num5';
        case 'Digit6': return 'Num6';
        case 'Digit7': return 'Num7';
        case 'Digit8': return 'Num8';
        case 'Digit9': return 'Num9';
        
        // Letters
        case 'KeyA': return 'KeyA';
        case 'KeyB': return 'KeyB';
        case 'KeyC': return 'KeyC';
        case 'KeyD': return 'KeyD';
        case 'KeyE': return 'KeyE';
        case 'KeyF': return 'KeyF';
        case 'KeyG': return 'KeyG';
        case 'KeyH': return 'KeyH';
        case 'KeyI': return 'KeyI';
        case 'KeyJ': return 'KeyJ';
        case 'KeyK': return 'KeyK';
        case 'KeyL': return 'KeyL';
        case 'KeyM': return 'KeyM';
        case 'KeyN': return 'KeyN';
        case 'KeyO': return 'KeyO';
        case 'KeyP': return 'KeyP';
        case 'KeyQ': return 'KeyQ';
        case 'KeyR': return 'KeyR';
        case 'KeyS': return 'KeyS';
        case 'KeyT': return 'KeyT';
        case 'KeyU': return 'KeyU';
        case 'KeyV': return 'KeyV';
        case 'KeyW': return 'KeyW';
        case 'KeyX': return 'KeyX';
        case 'KeyY': return 'KeyY';
        case 'KeyZ': return 'KeyZ';
        
        default:
          // Fallback to key name if code doesn't match
          if (key.length === 1) {
            return `Key${key.toUpperCase()}`;
          }
          return normalizeKeyName(key);
      }
    };

    const mappedKey = mapCodeToKey(code, key);
    
    // Check if the current key is a modifier key
    const isCurrentKeyModifier = ['MetaLeft', 'ControlLeft', 'Alt', 'ShiftLeft'].includes(mappedKey);
    
    // Build modifiers - only include modifiers that are NOT the current key
    const modifiers = {
      cmd: e.metaKey && mappedKey !== 'MetaLeft',
      ctrl: e.ctrlKey && mappedKey !== 'ControlLeft',
      alt: e.altKey && mappedKey !== 'Alt',
      shift: e.shiftKey && mappedKey !== 'ShiftLeft',
    };

    // Store the pending key combination
    pendingKeyRef.current = {
      key: mappedKey,
      modifiers,
    };

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Wait a bit to see if more modifiers are pressed (for combinations like Cmd+Shift)
    // This gives time for the user to press multiple modifiers
    timeoutRef.current = setTimeout(() => {
      if (pendingKeyRef.current) {
        const newConfig: HotkeyConfig = {
          key: pendingKeyRef.current.key,
          alt_code: pendingKeyRef.current.key === 'Function' ? 179 : undefined,
          modifiers: pendingKeyRef.current.modifiers,
        };

        onChange(newConfig);
        setIsCapturing(false);
        pendingKeyRef.current = null;
      }
    }, 150); // 150ms delay to capture modifier combinations
  }, [disabled, isCapturing, onChange]);

  // Listen for hotkey events from Rust (for Fn key and other special keys)
  // This takes priority over browser events for better detection
  useEffect(() => {
    if (!isCapturing || disabled) return;

    let rustEventReceived = false;

    const setupListener = async () => {
      try {
        // Start Rust-side hotkey recording
        await invoke('start_hotkey_recording');
        setRustRecordingActive(true);
      } catch (error) {
        console.error('Failed to start hotkey recording:', error);
      }

      const unlisten = await listen<{ key: string; modifiers: string[] }>('hotkey-recorded', (event) => {
        console.log('Hotkey recorded from Rust:', event.payload);
        rustEventReceived = true;
        
        const rustKey = event.payload.key;
        const rustModifiers = event.payload.modifiers;
        
        // Convert Rust format to our format
        const modifiers = {
          cmd: rustModifiers.includes('Command') || rustModifiers.includes('Cmd'),
          ctrl: rustModifiers.includes('Control') || rustModifiers.includes('Ctrl'),
          alt: rustModifiers.includes('Option') || rustModifiers.includes('Alt'),
          shift: rustModifiers.includes('Shift'),
        };
        
        // Map Rust key names to our format
        let mappedKey = rustKey;
        if (rustKey === 'Command') {
          mappedKey = 'MetaLeft';
        } else if (rustKey === 'Control') {
          mappedKey = 'ControlLeft';
        } else if (rustKey === 'Option') {
          mappedKey = 'Alt';
        } else if (rustKey === 'Shift') {
          mappedKey = 'ShiftLeft';
        } else if (rustKey === 'Function') {
          mappedKey = 'Function';
        }
        
        const newConfig: HotkeyConfig = {
          key: mappedKey,
          alt_code: mappedKey === 'Function' ? 179 : undefined,
          modifiers,
        };
        
        onChange(newConfig);
        setIsCapturing(false);
        setRustRecordingActive(false);
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
      // Stop Rust-side recording
      if (rustRecordingActive) {
        invoke('stop_hotkey_recording').catch(console.error);
        setRustRecordingActive(false);
      }
    };
  }, [isCapturing, disabled, onChange, rustRecordingActive]);

  const handleFocus = useCallback(() => {
    if (!disabled) {
      setIsCapturing(true);
    }
  }, [disabled]);

  const handleBlur = useCallback(async () => {
    // Clear any pending timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    // If there's a pending key, process it now
    if (pendingKeyRef.current) {
      const newConfig: HotkeyConfig = {
        key: pendingKeyRef.current.key,
        alt_code: pendingKeyRef.current.key === 'Function' ? 179 : undefined,
        modifiers: pendingKeyRef.current.modifiers,
      };
      onChange(newConfig);
      pendingKeyRef.current = null;
    }
    
    setIsCapturing(false);
    // Stop Rust-side recording when focus is lost
    if (rustRecordingActive) {
      try {
        await invoke('stop_hotkey_recording');
        setRustRecordingActive(false);
      } catch (error) {
        console.error('Failed to stop hotkey recording:', error);
      }
    }
  }, [rustRecordingActive, onChange]);

  const handleClick = useCallback(() => {
    if (!disabled && inputRef.current) {
      inputRef.current.focus();
    }
  }, [disabled]);

  return (
    <div
      ref={inputRef}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onClick={handleClick}
      style={{
        padding: '12px 16px',
        background: isCapturing 
          ? 'rgba(0, 122, 255, 0.2)' 
          : 'rgba(255, 255, 255, 0.1)',
        border: isCapturing
          ? '2px solid rgba(0, 122, 255, 0.5)'
          : '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: '6px',
        fontSize: '13px',
        color: 'rgba(255, 255, 255, 0.9)',
        cursor: disabled ? 'not-allowed' : 'text',
        outline: 'none',
        fontFamily: 'SF Mono, Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
        minHeight: '20px',
        display: 'flex',
        alignItems: 'center',
        transition: 'all 0.2s ease',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {isCapturing ? (
        <span style={{ color: 'rgba(0, 122, 255, 0.9)' }}>
          Press any key combination...
        </span>
      ) : displayText || (
        <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>
          Click to set hotkey
        </span>
      )}
    </div>
  );
};

