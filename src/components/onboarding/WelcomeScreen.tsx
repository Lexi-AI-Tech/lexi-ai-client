import React from 'react';
import { useOnboardingStore } from '../../store/onboardingStore';
import './onboarding.css';

export const WelcomeScreen: React.FC = () => {
  const { nextStep } = useOnboardingStore();

  return (
    <div className="flex flex-row h-full w-full bg-background">
      <div className="flex flex-col w-[45%] justify-center items-start px-24">
        <div className="flex flex-col h-full min-h-[400px] justify-between py-12">
          <div className="mt-8">
            <h1 className="text-3xl mb-4 mt-12">
              Welcome to Lexi AI
            </h1>
            <p className="text-base text-muted-foreground mb-8 max-w-md">
              Your voice-to-text assistant that works anywhere on your Mac
            </p>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⌨️</span>
                <span className="text-base">Press Fn key to record</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl">🎙️</span>
                <span className="text-base">Speak naturally</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl">✨</span>
                <span className="text-base">Text appears instantly</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-start mb-8">
            <button 
              className="onboarding-button primary"
              onClick={nextStep}
            >
              Get Started
            </button>
          </div>
        </div>
      </div>
      <div className="flex w-[55%] items-center justify-center bg-gradient-to-b from-purple-50/10 to-purple-100 border-l-2 border-purple-100">
        <div className="text-center">
          <div className="text-9xl mb-8">🎤</div>
        </div>
      </div>
    </div>
  );
};
