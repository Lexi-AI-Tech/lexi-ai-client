/**
 * HotkeyInput Component
 * 
 * A component that captures keyboard key combinations including modifiers.
 * Users can press any key combination and it will be displayed and captured.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

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

    e.preventDefault();
    e.stopPropagation();

    const modifiers = {
      cmd: e.metaKey || e.key === 'Meta',
      ctrl: e.ctrlKey || e.key === 'Control',
      alt: e.altKey || e.key === 'Alt',
      shift: e.shiftKey || e.key === 'Shift',
    };

    // Don't capture if only modifiers are pressed
    const isModifierOnly = ['Meta', 'Control', 'Alt', 'Shift', 'MetaLeft', 'MetaRight', 
                            'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight'].includes(e.key);
    
    if (isModifierOnly) {
      return;
    }

    const normalizedKey = normalizeKeyName(e.key);
    
    const newConfig: HotkeyConfig = {
      key: normalizedKey,
      alt_code: normalizedKey === 'Function' ? 179 : undefined,
      modifiers,
    };

    onChange(newConfig);
    setIsCapturing(false);
  }, [disabled, isCapturing, onChange]);

  const handleFocus = useCallback(() => {
    if (!disabled) {
      setIsCapturing(true);
    }
  }, [disabled]);

  const handleBlur = useCallback(() => {
    setIsCapturing(false);
  }, []);

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

