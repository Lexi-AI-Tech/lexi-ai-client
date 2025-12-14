import React, { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useOnboardingStore } from '../../store/onboardingStore';
import './onboarding.css';

export const MicrophoneTestScreen: React.FC = () => {
  const { nextStep, previousStep, completeOnboarding } = useOnboardingStore();
  const [volume, setVolume] = useState(0);
  const [smoothedVolume, setSmoothedVolume] = useState(0);
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    // Listen for volume updates (if backend emits them)
    const setupListener = async () => {
      try {
        const unlisten = await listen('volume-update', (event: any) => {
          setVolume(event.payload as number);
        });
        return unlisten;
      } catch (error) {
        console.log('Volume update event not available:', error);
        return () => {};
      }
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

  // Smooth volume updates
  useEffect(() => {
    const smoothing = 0.4;
    setSmoothedVolume(prev => prev * (1 - smoothing) + volume * smoothing);
  }, [volume]);

  // Generate volume bars
  const generateVolumeBars = () => {
    const bars = 12;
    const minHeight = 0.2;
    return Array(bars).fill(0).map((_, i) => {
      const threshold = (i / bars) * 0.5;
      const normalizedVolume = Math.min(smoothedVolume * 8, 1);
      return normalizedVolume > threshold ? 1 : minHeight;
    });
  };

  const handleContinue = () => {
    completeOnboarding();
  };

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
              Speak to test your microphone.
            </h1>
            <div className="text-base text-muted-foreground mb-8 max-w-md">
              Your computer's built-in mic will ensure accurate transcription
              with minimal latency.
            </div>
          </div>
        </div>
      </div>
      <div className="flex w-[55%] items-center justify-center bg-gradient-to-b from-purple-50/10 to-purple-100 border-l-2 border-purple-100">
        <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col items-center" style={{ minWidth: 500, maxHeight: 280 }}>
          <div className="text-lg font-medium mb-6 text-center">
            Do you see purple bars moving while you speak?
          </div>
          <div className="flex gap-1 py-4 px-4 items-end bg-neutral-100 rounded-md" style={{ height: 120, width: '100%' }}>
            {generateVolumeBars().map((level, i) => (
              <div
                key={i}
                className={`mx-2 h-full ${level > 0.2 ? 'bg-purple-300' : 'bg-neutral-300'}`}
                style={{
                  width: 18,
                  borderRadius: 6,
                  transition: 'height 0.18s cubic-bezier(.4,2,.6,1)',
                  height: `${level * 100}%`,
                }}
              />
            ))}
          </div>
          <div className="flex gap-2 mt-6 w-full justify-end">
            <button
              className="onboarding-button primary w-16"
              onClick={handleContinue}
            >
              Yes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
