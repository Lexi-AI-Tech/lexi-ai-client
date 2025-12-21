import React from 'react';
import { HotkeySettings } from './HotkeySettings';

export const SettingsPage: React.FC = () => {
  return (
    <div className="settings-page">
      <h2 style={{ margin: 0, marginBottom: '32px', fontSize: '24px', fontWeight: 600, color: '#ffffff' }}>
        Settings
      </h2>
      <HotkeySettings />
    </div>
  );
};

