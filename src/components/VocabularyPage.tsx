import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VocabularyItem, TauriAppConfig } from "../types";

export const VocabularyPage: React.FC = () => {
  const [config, setConfig] = useState<TauriAppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const vocabulary = config?.vocabulary || [];

  // Load app config on mount
  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const loadedConfig = await invoke<TauriAppConfig>("get_app_config");
        setConfig(loadedConfig);
      } catch (err: any) {
        console.error("Failed to load app config:", err);
        setError(err?.message || "Failed to load vocabulary");
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();
  }, []);

  if (isLoading) {
    return (
      <div className="vocabulary-page">
        <h2
          style={{
            margin: 0,
            marginBottom: "32px",
            fontSize: "24px",
            fontWeight: 600,
            color: "#ffffff",
          }}
        >
          Vocabulary
        </h2>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "40px",
            color: "rgba(255, 255, 255, 0.6)",
            fontSize: "14px",
          }}
        >
          Loading vocabulary...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="vocabulary-page">
        <h2
          style={{
            margin: 0,
            marginBottom: "32px",
            fontSize: "24px",
            fontWeight: 600,
            color: "#ffffff",
          }}
        >
          Vocabulary
        </h2>
        <div
          className="permission-message"
          style={{
            background: "rgba(255, 59, 48, 0.1)",
            borderColor: "rgba(255, 59, 48, 0.2)",
            color: "rgba(255, 59, 48, 0.9)",
            fontSize: "11px",
            padding: "12px",
            marginBottom: "16px",
          }}
        >
          {error}
        </div>
      </div>
    );
  }

  const visibleVocabulary = vocabulary.filter((item) => !item.hidden);

  return (
    <div className="vocabulary-page">
      <h2
        style={{
          margin: 0,
          marginBottom: "32px",
          fontSize: "24px",
          fontWeight: 600,
          color: "#ffffff",
        }}
      >
        Vocabulary
      </h2>

      {visibleVocabulary.length === 0 ? (
        <div
          style={{
            padding: "40px",
            textAlign: "center",
            color: "rgba(255, 255, 255, 0.6)",
            fontSize: "14px",
          }}
        >
          No vocabulary items yet. Vocabulary will appear here as you use the
          app.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {visibleVocabulary.map((item, index) => (
            <div
              key={index}
              style={{
                padding: "16px",
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "6px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "14px",
                    color: "#ffffff",
                    fontWeight: 500,
                    marginBottom: "4px",
                  }}
                >
                  {item.value}
                </div>
                {item.is_system_generated && (
                  <div
                    style={{
                      fontSize: "11px",
                      color: "rgba(255, 255, 255, 0.5)",
                    }}
                  >
                    System generated
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
