import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useOnboardingStore } from "../../store/onboardingStore";
import "./onboarding.css";

interface PermissionState {
  granted: boolean;
  checking: boolean;
}

export const PermissionsScreen: React.FC = () => {
  const { nextStep, previousStep } = useOnboardingStore();
  const [microphone, setMicrophone] = useState<PermissionState>({
    granted: false,
    checking: false,
  });
  const [accessibility, setAccessibility] = useState<PermissionState>({
    granted: false,
    checking: false,
  });
  const [inputMonitoring, setInputMonitoring] = useState<PermissionState>({
    granted: false,
    checking: false,
  });

  // Check permissions on mount
  useEffect(() => {
    checkPermissions();
    // Poll for permission changes
    const interval = setInterval(checkPermissions, 2000);
    return () => clearInterval(interval);
  }, []);

  const checkPermissions = async () => {
    try {
      // Note: We'll need to add these commands to the Rust backend
      // For now, we'll use the existing commands
      const micGranted = await invoke<boolean>("check_microphone_permission");
      const accGranted = await invoke<boolean>(
        "check_accessibility_permission",
      );
      const inputGranted = await invoke<boolean>(
        "check_input_monitoring_permission",
      );

      setMicrophone((prev) => ({ ...prev, granted: micGranted }));
      setAccessibility((prev) => ({ ...prev, granted: accGranted }));
      setInputMonitoring((prev) => ({ ...prev, granted: inputGranted }));
    } catch (error) {
      console.error("Failed to check permissions:", error);
    }
  };

  const requestMicrophone = async () => {
    setMicrophone((prev) => ({ ...prev, checking: true }));
    try {
      await invoke<boolean>("request_microphone_permission");
      // Start polling for permission change
      setTimeout(checkPermissions, 1000);
    } catch (error) {
      console.error("Failed to request microphone permission:", error);
    } finally {
      setMicrophone((prev) => ({ ...prev, checking: false }));
    }
  };

  const requestAccessibility = async () => {
    setAccessibility((prev) => ({ ...prev, checking: true }));
    try {
      await invoke<boolean>("request_accessibility_permission");
      setTimeout(checkPermissions, 1000);
    } catch (error) {
      console.error("Failed to request accessibility permission:", error);
    } finally {
      setAccessibility((prev) => ({ ...prev, checking: false }));
    }
  };

  const requestInputMonitoring = async () => {
    setInputMonitoring((prev) => ({ ...prev, checking: true }));
    try {
      await invoke<boolean>("request_input_monitoring_permission");
      setTimeout(checkPermissions, 1000);
    } catch (error) {
      console.error("Failed to request input monitoring permission:", error);
    } finally {
      setInputMonitoring((prev) => ({ ...prev, checking: false }));
    }
  };

  const allGranted =
    microphone.granted && accessibility.granted && inputMonitoring.granted;

  return (
    <div className="flex flex-row h-full w-full bg-background">
      <div className="flex flex-col w-[45%] justify-center items-start pl-24">
        <div className="flex flex-col h-full min-h-[400px] justify-between py-12">
          <div className="mt-8">
            <button
              className="mb-4 text-sm text-muted-foreground hover:underline"
              type="button"
              onClick={previousStep}
            >
              &lt; Back
            </button>
            <h1 className="text-3xl mb-4 mt-12 pr-24">
              {allGranted
                ? "Thank you for trusting us. We take your privacy seriously."
                : "Set up Lexi AI on your computer"}
            </h1>
            <div className="flex flex-col gap-4 my-8 pr-24">
              <div
                className={`border rounded-lg p-4 flex flex-col gap-2 bg-background border-border ${microphone.granted ? "border-green-500" : "border-2"}`}
              >
                <div
                  className={`flex items-center gap-2 ${microphone.granted ? "" : "mb-2"}`}
                >
                  {microphone.granted && (
                    <span className="text-green-500 text-xl">✓</span>
                  )}
                  <div className="font-medium text-base flex">
                    {microphone.granted
                      ? "Lexi AI can use your microphone."
                      : "Allow Lexi AI to use your microphone."}
                  </div>
                </div>
                {!microphone.granted && (
                  <>
                    <div className="text-sm text-muted-foreground mb-2">
                      This lets Lexi AI hear your voice and transcribe your
                      speech
                    </div>
                    <div className="flex items-center justify-between">
                      <button
                        className="onboarding-button secondary w-24"
                        onClick={requestMicrophone}
                        disabled={microphone.checking}
                      >
                        {microphone.checking ? "Requesting..." : "Allow"}
                      </button>
                      {microphone.checking && (
                        <div className="text-sm text-muted-foreground">
                          Checking...
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div
                className={`border rounded-lg p-4 flex flex-col gap-2 bg-background border-border ${inputMonitoring.granted ? "border-green-500" : "border-2"}`}
              >
                <div
                  className={`flex items-center gap-2 ${inputMonitoring.granted ? "" : "mb-2"}`}
                >
                  {inputMonitoring.granted && (
                    <span className="text-green-500 text-xl">✓</span>
                  )}
                  <div className="font-medium text-base flex">
                    {inputMonitoring.granted
                      ? "Lexi AI can detect Fn key presses."
                      : "Allow Lexi AI to detect Fn key presses."}
                  </div>
                </div>
                {!inputMonitoring.granted && (
                  <>
                    <div className="text-sm text-muted-foreground mb-2">
                      This lets Lexi AI detect when you press the Fn key to
                      start recording
                    </div>
                    <div className="flex items-center justify-between">
                      <button
                        className="onboarding-button secondary w-24"
                        onClick={requestInputMonitoring}
                        disabled={inputMonitoring.checking}
                      >
                        {inputMonitoring.checking ? "Requesting..." : "Allow"}
                      </button>
                      {inputMonitoring.checking && (
                        <div className="text-sm text-muted-foreground">
                          Checking...
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div
                className={`border rounded-lg p-4 flex flex-col gap-2 bg-background border-border ${accessibility.granted ? "border-green-500" : "border-2"}`}
              >
                <div
                  className={`flex items-center gap-2 ${accessibility.granted ? "" : "mb-2"}`}
                >
                  {accessibility.granted && (
                    <span className="text-green-500 text-xl">✓</span>
                  )}
                  <div className="font-medium text-base flex">
                    {accessibility.granted
                      ? "Lexi AI can insert and edit text."
                      : "Allow Lexi AI to insert spoken words."}
                  </div>
                </div>
                {!accessibility.granted && (
                  <>
                    <div className="text-sm text-muted-foreground mb-2">
                      This lets Lexi AI put your spoken words in the right
                      textbox
                    </div>
                    <div className="flex items-center justify-between">
                      <button
                        className="onboarding-button secondary w-24"
                        onClick={requestAccessibility}
                        disabled={accessibility.checking}
                      >
                        {accessibility.checking ? "Requesting..." : "Allow"}
                      </button>
                      {accessibility.checking && (
                        <div className="text-sm text-muted-foreground">
                          Checking...
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-start mb-8">
            <button
              className={`onboarding-button primary w-24 ${allGranted ? "" : "hidden"}`}
              onClick={nextStep}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
      <div className="flex w-[55%] items-center justify-center bg-gradient-to-b from-purple-50/10 to-purple-100 border-l-2 border-purple-100">
        <div className="w-[600px] h-[500px] rounded-lg flex items-center justify-center">
          {allGranted ? (
            <div className="text-9xl">🔒</div>
          ) : (
            <div className="text-9xl">🎙️</div>
          )}
        </div>
      </div>
    </div>
  );
};
