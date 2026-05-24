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

export const OnboardingFlow: React.FC = () => {
  const [systemType, setSystemType] = React.useState<string>("mac");
  const { currentStep, nextStep, previousStep, completeOnboarding } =
    useOnboardingStore();

  React.useEffect(() => {
    invoke<string>("get_system_type")
      .then(setSystemType)
      .catch((e) => console.error("Failed to get system type:", e));
  }, []);

  const IS_MACOS = systemType === "mac";
  const STEPS = IS_MACOS
    ? ["Welcome", "Permissions", "Setup", "Try it"]
    : ["Welcome", "Setup", "Try it"];

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
        return 1; // Only reachable on macOS
      case "hotkey-test":
        return IS_MACOS ? 2 : 1;
      case "microphone-test":
        return IS_MACOS ? 3 : 2;
      default:
        return 0;
    }
  })();

  const visualStep = (() => {
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
              {currentStep === "welcome" && (
                <WelcomeStep
                  key="welcome"
                  systemType={systemType}
                  onNext={nextStep}
                  onBack={previousStep}
                  showBack={showBack}
                />
              )}
              {currentStep === "permissions" && IS_MACOS && (
                <PermissionsStep
                  key="permissions"
                  onNext={nextStep}
                  onBack={previousStep}
                  showBack={showBack}
                />
              )}
              {currentStep === "hotkey-test" && (
                <SetupStep
                  key="setup"
                  systemType={systemType}
                  onNext={nextStep}
                  onBack={previousStep}
                  showBack={showBack}
                />
              )}
              {currentStep === "microphone-test" && (
                <TryItStep
                  key="tryit"
                  systemType={systemType}
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
        <VisualSide step={visualStep} />
      </div>
    </div>
  );
};
