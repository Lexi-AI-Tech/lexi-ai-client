import React from "react";
import { useOnboardingStore } from "../../store/onboardingStore";
import "./onboarding.css";

const STEPS = ["Welcome", "Permissions", "Set Up", "Try it"];

export const OnboardingTitlebar: React.FC = () => {
  const { currentStep } = useOnboardingStore();

  // Map current step to category index
  let categoryIndex = 0;
  if (currentStep === "permissions") {
    categoryIndex = 1;
  } else if (
    currentStep === "fn-key-test" ||
    currentStep === "microphone-test"
  ) {
    categoryIndex = 2;
  } else if (currentStep === "home") {
    categoryIndex = 3;
  }

  const progress = ((categoryIndex + 1) / STEPS.length) * 100;

  return (
    <>
      <div className="onboarding-steps-text">
        {STEPS.map((step, idx) => (
          <React.Fragment key={step}>
            <span
              className={`onboarding-step-label ${idx <= categoryIndex ? "active" : ""}`}
            >
              {step.toUpperCase()}
            </span>
            {idx < STEPS.length - 1 && (
              <span
                className={`onboarding-step-chevron ${idx < categoryIndex ? "active" : ""}`}
                aria-hidden="true"
              >
                &#8250;
              </span>
            )}
          </React.Fragment>
        ))}
      </div>
      <div className="onboarding-progress-bar-bg">
        <div
          className="onboarding-progress-bar-fg"
          style={{ width: `${progress}%` }}
        />
      </div>
    </>
  );
};
