import React from 'react';
import { useOnboardingStore } from '../../store/onboardingStore';
import { WelcomeScreen } from './WelcomeScreen';
import { PermissionsScreen } from './PermissionsScreen';
import { FnKeyTestScreen } from './FnKeyTestScreen';
import { MicrophoneTestScreen } from './MicrophoneTestScreen';
import { OnboardingTitlebar } from './OnboardingTitlebar';

export const OnboardingFlow: React.FC = () => {
  const { currentStep } = useOnboardingStore();

  const renderStep = () => {
    switch (currentStep) {
      case 'welcome':
        return <WelcomeScreen />;
      case 'permissions':
        return <PermissionsScreen />;
      case 'fn-key-test':
        return <FnKeyTestScreen />;
      case 'microphone-test':
        return <MicrophoneTestScreen />;
      default:
        return <WelcomeScreen />;
    }
  };

  return (
    <div className="onboarding-wrapper">
      <div className="onboarding-titlebar-container">
        <OnboardingTitlebar />
      </div>
      <div className="onboarding-content-wrapper">
        {renderStep()}
      </div>
    </div>
  );
};
