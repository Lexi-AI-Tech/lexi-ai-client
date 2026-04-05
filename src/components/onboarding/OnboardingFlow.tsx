import React, { useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useOnboardingStore } from "../../store/onboardingStore";
import {
  WelcomeStep,
  PermissionsStep,
  SetupStep,
  TryItStep,
  VisualSide,
} from "./onboarding-steps";
import "./onboarding.css";

const STEPS = ["Welcome", "Permissions", "Setup", "Try it"];

export const OnboardingFlow: React.FC = () => {
  const { currentStep, nextStep, previousStep, completeOnboarding } =
    useOnboardingStore();

  // After Permissions: shortcuts step uses dry-run (no pill); “Try it” uses full recording + pill.
  useEffect(() => {
    if (currentStep !== "hotkey-test" && currentStep !== "microphone-test") {
      return;
    }
    invoke("start_global_key_listener").catch(() => {});
  }, [currentStep]);

  const currentStepIndex = (() => {
    switch (currentStep) {
      case "welcome":
        return 0;
      case "permissions":
        return 1;
      case "hotkey-test":
        return 2;
      case "microphone-test":
        return 3;
      default:
        return 0;
    }
  })();
  const showBack = currentStepIndex > 0;

  return (
    <div className="onboarding-container">
      {/* Interaction Area */}
      <div className="onboarding-form-area">
        {/* Header */}
        <header className="onboarding-header">
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
                <WelcomeStep
                  key="welcome"
                  onNext={nextStep}
                  onBack={previousStep}
                  showBack={showBack}
                />
              )}
              {currentStepIndex === 1 && (
                <PermissionsStep
                  key="permissions"
                  onNext={nextStep}
                  onBack={previousStep}
                  showBack={showBack}
                />
              )}
              {currentStepIndex === 2 && (
                <SetupStep
                  key="setup"
                  onNext={nextStep}
                  onBack={previousStep}
                  showBack={showBack}
                />
              )}
              {currentStepIndex === 3 && (
                <TryItStep
                  key="tryit"
                  onComplete={completeOnboarding}
                  onBack={previousStep}
                  showBack={showBack}
                />
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

      <div
        className="onboarding-visual-area"
        data-onboarding-step={currentStepIndex}
      >
        <VisualSide step={currentStepIndex} />
      </div>
    </div>
  );
};
