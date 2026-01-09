/**
 * ModelsSection Component
 *
 * Placeholder component for managing Whisper models.
 * This component allows users to:
 * - View available models
 * - Check which models are installed
 * - Download models (placeholder for future implementation)
 */

import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ModelInfo {
  id: string;
  name: string;
  size: number | null;
  is_downloaded: boolean;
  download_url: string | null;
}

export const ModelsSection: React.FC = () => {
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [installedModels, setInstalledModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelsDir, setModelsDir] = useState<string | null>(null);
  const [exeDir, setExeDir] = useState<string | null>(null);
  const [isExeInstalled, setIsExeInstalled] = useState<boolean>(false);

  useEffect(() => {
    loadModelData();
  }, []);

  const loadModelData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Load available models
      const available = await invoke<ModelInfo[]>("list_available_models");
      setAvailableModels(available);

      // Load installed models
      const installed = await invoke<ModelInfo[]>("get_installed_models");
      setInstalledModels(installed);

      // Get directories
      const modelsPath = await invoke<string>("get_models_directory");
      setModelsDir(modelsPath);

      const exePath = await invoke<string>("get_executables_directory");
      setExeDir(exePath);

      // Check if executable is installed
      const exeExists = await invoke<boolean>(
        "is_whisper_executable_installed",
      );
      setIsExeInstalled(exeExists);
    } catch (err: any) {
      console.error("Failed to load model data:", err);
      setError(err?.message || "Failed to load model information");
    } finally {
      setIsLoading(false);
    }
  };

  const formatSize = (bytes: number | null): string => {
    if (!bytes) return "Unknown size";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  // COMMENTED OUT: Model downloading functionality
  // const handleDownload = async (model: ModelInfo) => {
  //   if (!model.download_url) {
  //     setError("Download URL not available for this model");
  //     return;
  //   }

  //   try {
  //     // Placeholder: This will be implemented in the future
  //     const result = await invoke<string>("download_model", {
  //       modelId: model.id,
  //       downloadUrl: model.download_url,
  //     });
  //     alert(`Model download started: ${result}`);
  //     // Reload model data after download
  //     await loadModelData();
  //   } catch (err: any) {
  //     // For now, show instructions since download is not implemented
  //     const message = err?.message || "Download failed";
  //     alert(
  //       `${message}\n\nPlease download the model manually from:\n${model.download_url}\n\nAnd place it in:\n${modelsDir}`,
  //     );
  //   }
  // };

  if (isLoading) {
    return (
      <div
        style={{
          padding: "24px",
          color: "rgba(255, 255, 255, 0.7)",
          fontSize: "13px",
        }}
      >
        Loading model information...
      </div>
    );
  }

  return (
    <div>
      <h3
        style={{
          marginBottom: "16px",
          fontSize: "18px",
          fontWeight: 500,
          color: "#ffffff",
        }}
      >
        Offline Models
      </h3>

      <div
        style={{
          fontSize: "11px",
          color: "rgba(255, 255, 255, 0.6)",
          marginBottom: "16px",
          lineHeight: "1.5",
        }}
      >
        Download Whisper models to enable offline transcription. Models are
        stored in your user data directory.
      </div>

      {/* Executable Status */}
      <div
        style={{
          padding: "12px",
          backgroundColor: isExeInstalled
            ? "rgba(52, 199, 89, 0.1)"
            : "rgba(255, 159, 10, 0.1)",
          border: `1px solid ${
            isExeInstalled
              ? "rgba(52, 199, 89, 0.3)"
              : "rgba(255, 159, 10, 0.3)"
          }`,
          borderRadius: "6px",
          marginBottom: "16px",
        }}
      >
        <div
          style={{
            fontSize: "12px",
            fontWeight: 500,
            color: "#ffffff",
            marginBottom: "4px",
          }}
        >
          Whisper Executable: {isExeInstalled ? "✅ Installed" : "⚠️ Not Found"}
        </div>
        {!isExeInstalled && (
          <div
            style={{
              fontSize: "10px",
              color: "rgba(255, 255, 255, 0.6)",
              marginTop: "4px",
            }}
          >
            Please download the whisper executable and place it in: {exeDir}
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            background: "rgba(255, 59, 48, 0.1)",
            border: "1px solid rgba(255, 59, 48, 0.2)",
            color: "rgba(255, 59, 48, 0.9)",
            fontSize: "11px",
            padding: "8px",
            marginBottom: "16px",
            borderRadius: "6px",
          }}
        >
          {error}
        </div>
      )}

      {/* Available Models */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {availableModels.map((model) => {
          const isInstalled = model.is_downloaded;
          return (
            <div
              key={model.id}
              style={{
                padding: "12px",
                backgroundColor: isInstalled
                  ? "rgba(52, 199, 89, 0.05)"
                  : "rgba(255, 255, 255, 0.05)",
                border: `1px solid ${
                  isInstalled
                    ? "rgba(52, 199, 89, 0.2)"
                    : "rgba(255, 255, 255, 0.1)"
                }`,
                borderRadius: "6px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: "13px",
                    color: "#ffffff",
                    fontWeight: 500,
                    marginBottom: "4px",
                  }}
                >
                  {model.name}
                </div>
                <div
                  style={{
                    fontSize: "10px",
                    color: "rgba(255, 255, 255, 0.5)",
                  }}
                >
                  {formatSize(model.size)} • {model.id}
                </div>
                {isInstalled && (
                  <div
                    style={{
                      fontSize: "10px",
                      color: "rgba(52, 199, 89, 0.9)",
                      marginTop: "4px",
                    }}
                  >
                    ✓ Installed
                  </div>
                )}
              </div>
              <button
                // onClick={() => handleDownload(model)}
                onClick={() => {
                  // COMMENTED OUT: Model downloading functionality
                  alert("Model downloading is currently disabled.");
                }}
                disabled={isInstalled}
                style={{
                  padding: "6px 12px",
                  fontSize: "11px",
                  backgroundColor: isInstalled
                    ? "rgba(255, 255, 255, 0.1)"
                    : "rgba(0, 122, 255, 0.2)",
                  border: `1px solid ${
                    isInstalled
                      ? "rgba(255, 255, 255, 0.2)"
                      : "rgba(0, 122, 255, 0.4)"
                  }`,
                  borderRadius: "4px",
                  color: isInstalled ? "rgba(255, 255, 255, 0.5)" : "#ffffff",
                  cursor: isInstalled ? "not-allowed" : "pointer",
                  opacity: isInstalled ? 0.5 : 1,
                }}
              >
                {isInstalled ? "Installed" : "Download"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Directory Information */}
      <div
        style={{
          marginTop: "16px",
          padding: "12px",
          backgroundColor: "rgba(255, 255, 255, 0.03)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "6px",
        }}
      >
        <div
          style={{
            fontSize: "10px",
            color: "rgba(255, 255, 255, 0.5)",
            lineHeight: "1.5",
          }}
        >
          <div style={{ marginBottom: "4px" }}>
            <strong>Models Directory:</strong> {modelsDir}
          </div>
          <div>
            <strong>Executables Directory:</strong> {exeDir}
          </div>
        </div>
      </div>
    </div>
  );
};
