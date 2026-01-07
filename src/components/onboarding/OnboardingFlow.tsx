import React, { useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useOnboardingStore } from "../../store/onboardingStore";
import {
  WelcomeStep,
  PermissionsStep,
  SetupStep,
  TryItStep,
  VisualSide,
} from "./onboarding-steps";
import "./onboarding.css";
import Logo from "../../assets/light_mode_without_text.png";

const STEPS = ["Welcome", "Permissions", "Setup", "Try it"];
const STEP_KEYS = ["welcome", "permissions", "setup", "tryit"] as const;

export const OnboardingFlow: React.FC = () => {
  const { currentStep, setStep, completeOnboarding } = useOnboardingStore();
  const [hotkey, setHotkey] = useState<string | null>(null);

  // Map old step names to new indices
  const getStepIndex = () => {
    switch (currentStep) {
      case "welcome":
        return 0;
      case "permissions":
        return 1;
      case "fn-key-test":
        return 2;
      case "microphone-test":
        return 3;
      default:
        return 0;
    }
  };

  const currentStepIndex = getStepIndex();

  const nextStep = () => {
    const steps = [
      "welcome",
      "permissions",
      "fn-key-test",
      "microphone-test",
    ] as const;
    if (currentStepIndex < steps.length - 1) {
      setStep(steps[currentStepIndex + 1]);
    }
  };

  const handleComplete = () => {
    completeOnboarding();
  };

  return (
    <div className="onboarding-container">
      {/* Interaction Area */}
      <div className="onboarding-form-area">
        {/* Header */}
        <header className="onboarding-header">
          <img src={Logo} alt="Speaklexi" className="onboarding-header-logo" />
          <div className="step-indicators">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`step-dot ${i === currentStepIndex ? "active" : ""}`}
              />
            ))}
          </div>
        </header>

        {/* Form Content */}
        <main className="onboarding-main">
          <div className="onboarding-form-wrapper">
            <AnimatePresence mode="wait">
              {currentStepIndex === 0 && (
                <WelcomeStep key="welcome" onNext={nextStep} />
              )}
              {currentStepIndex === 1 && (
                <PermissionsStep key="permissions" onNext={nextStep} />
              )}
              {currentStepIndex === 2 && (
                <SetupStep
                  key="setup"
                  onNext={nextStep}
                  hotkey={hotkey}
                  setHotkey={setHotkey}
                />
              )}
              {currentStepIndex === 3 && (
                <TryItStep
                  key="tryit"
                  onComplete={handleComplete}
                  hotkey={hotkey}
                />
              )}
            </AnimatePresence>
          </div>
        </main>

        {/* Footer */}
        <footer className="onboarding-footer">
          <div className="footer-links">
            <span className="footer-link">Privacy</span>
            <span className="footer-link">Terms</span>
            <span className="footer-link">Support</span>
          </div>
        </footer>
      </div>

      {/* Visual Area */}
      <div className="onboarding-visual-area">
        <VisualSide step={currentStepIndex} />

        {/* Version badge */}
        <div className="version-badge">v1.0.0</div>
      </div>
    </div>
  );
};
