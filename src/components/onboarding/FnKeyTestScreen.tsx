import React, { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useOnboardingStore } from '../../store/onboardingStore';
import './onboarding.css';

export const FnKeyTestScreen: React.FC = () => {
  const { nextStep, previousStep } = useOnboardingStore();
  const [fnKeyPressed, setFnKeyPressed] = useState(false);
  const [hasDetectedFn, setHasDetectedFn] = useState(false);

  useEffect(() => {
    // Listen for global input events and recording events
    const setupListener = async () => {
      const unlistenGlobal = await listen('global-input', (event: any) => {
        const eventString = event.payload as string;
        // Check if it's an Fn key event (Function key)
        if (eventString.includes('Function')) {
          if (eventString.includes('key_press')) {
            setFnKeyPressed(true);
            setHasDetectedFn(true);
          } else if (eventString.includes('key_release')) {
            setFnKeyPressed(false);
          }
        }
      });

      // Also listen for recording events as a fallback
      const unlistenRecording = await listen('recording_started', () => {
        setFnKeyPressed(true);
        setHasDetectedFn(true);
      });

      const unlistenStopped = await listen('recording_stopped', () => {
        setFnKeyPressed(false);
      });

      return () => {
        unlistenGlobal();
        unlistenRecording();
        unlistenStopped();
      };
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

  return (
    <div className="flex flex-row h-full w-full bg-background">
      <div className="flex flex-col w-[45%] justify-center items-start px-24">
        <div className="flex flex-col h-full min-h-[400px] justify-between py-12 overflow-hidden">
          <div className="mt-8">
            <button
              className="mb-4 text-sm text-muted-foreground hover:underline"
              type="button"
              onClick={previousStep}
            >
              &lt; Back
            </button>
            <h1 className="text-3xl mb-4 mt-12">
              Press the Fn key to test it out.
            </h1>
            <div className="text-base text-muted-foreground mb-8 max-w-md">
              Press and hold the <span className="inline-flex items-center px-2 py-0.5 bg-neutral-100 border rounded text-xs font-mono ml-1">Fn</span> key at the bottom left of your keyboard
            </div>
          </div>
        </div>
      </div>
      <div className="flex w-[55%] items-center justify-center bg-gradient-to-b from-purple-50/10 to-purple-100 border-l-2 border-purple-100">
        <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col items-center" style={{ minWidth: 500, maxHeight: 280 }}>
          <div className="text-lg font-medium mb-6 text-center">
            {hasDetectedFn 
              ? 'Great! The Fn key is working.'
              : 'Does the button turn purple while pressing it?'}
          </div>
          <div className={`fn-key-display-large ${fnKeyPressed ? 'pressed' : ''}`}>
            <div className="fn-key-label-large">Fn</div>
            {fnKeyPressed && (
              <div className="fn-key-indicator-large">●</div>
            )}
          </div>
          <div className="flex gap-2 mt-6 w-full justify-end">
            <button
              className="onboarding-button primary w-16"
              onClick={nextStep}
              disabled={!hasDetectedFn}
            >
              {hasDetectedFn ? 'Yes' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
