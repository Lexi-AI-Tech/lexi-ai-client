import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VocabularyItem, TauriAppConfig } from "../types";

export const VocabularyPage: React.FC = () => {
  const [config, setConfig] = useState<TauriAppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [newVocabularyValue, setNewVocabularyValue] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

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

  // Update config function
  const updateConfig = async (updates: Partial<TauriAppConfig>) => {
    setError(null);
    setIsUpdating(true);
    try {
      const updatedConfig = await invoke<TauriAppConfig>("update_app_config", {
        config: updates,
      });
      setConfig(updatedConfig);
      return updatedConfig;
    } catch (err: any) {
      console.error("Failed to update config:", err);
      setError(err?.message || "Failed to update vocabulary");
      throw err;
    } finally {
      setIsUpdating(false);
    }
  };

  // Add new vocabulary item
  const handleAddVocabulary = async () => {
    if (!newVocabularyValue.trim()) {
      setError("Vocabulary value cannot be empty");
      return;
    }

    const currentVocabulary = vocabulary || [];
    const newItem: VocabularyItem = {
      id: "", // Server will generate ID
      value: newVocabularyValue.trim(),
      is_system_generated: false,
      hidden: false,
    };

    // Add new item to the list
    const updatedVocabulary = [...currentVocabulary, newItem];

    try {
      await updateConfig({ vocabulary: updatedVocabulary });
      setNewVocabularyValue("");
      setShowAddForm(false);
      setError(null);
    } catch (err) {
      // Error already set by updateConfig
    }
  };

  // Delete vocabulary item
  const handleDeleteVocabulary = async (itemId: string) => {
    if (!itemId) {
      setError("Cannot delete item without ID");
      return;
    }

    const currentVocabulary = vocabulary || [];
    const updatedVocabulary = currentVocabulary.filter(
      (item) => item.id !== itemId,
    );

    try {
      await updateConfig({ vocabulary: updatedVocabulary });
      setError(null);
    } catch (err) {
      // Error already set by updateConfig
    }
  };

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

  const visibleVocabulary = vocabulary.filter((item) => !item.hidden);

  return (
    <div className="vocabulary-page">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "32px",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: "24px",
            fontWeight: 600,
            color: "#ffffff",
          }}
        >
          Vocabulary
        </h2>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            disabled={isUpdating}
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              backgroundColor: "rgba(0, 122, 255, 0.2)",
              border: "1px solid rgba(0, 122, 255, 0.4)",
              borderRadius: "6px",
              color: "#ffffff",
              cursor: isUpdating ? "not-allowed" : "pointer",
              opacity: isUpdating ? 0.5 : 1,
            }}
          >
            + Add Vocabulary
          </button>
        )}
      </div>

      {error && (
        <div
          className="permission-message"
          style={{
            background: "rgba(255, 59, 48, 0.1)",
            borderColor: "rgba(255, 59, 48, 0.2)",
            color: "rgba(255, 59, 48, 0.9)",
            fontSize: "11px",
            padding: "12px",
            marginBottom: "16px",
            borderRadius: "6px",
          }}
        >
          {error}
        </div>
      )}

      {/* Add Vocabulary Form */}
      {showAddForm && (
        <div
          style={{
            padding: "16px",
            backgroundColor: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "6px",
            marginBottom: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
            }}
          >
            <input
              type="text"
              value={newVocabularyValue}
              onChange={(e) => setNewVocabularyValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleAddVocabulary();
                } else if (e.key === "Escape") {
                  setShowAddForm(false);
                  setNewVocabularyValue("");
                }
              }}
              placeholder="Enter vocabulary term..."
              disabled={isUpdating}
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: "13px",
                backgroundColor: "rgba(255, 255, 255, 0.1)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                borderRadius: "4px",
                color: "#ffffff",
                outline: "none",
              }}
              autoFocus
            />
            <button
              onClick={handleAddVocabulary}
              disabled={isUpdating || !newVocabularyValue.trim()}
              style={{
                padding: "8px 16px",
                fontSize: "13px",
                backgroundColor: "rgba(52, 199, 89, 0.2)",
                border: "1px solid rgba(52, 199, 89, 0.4)",
                borderRadius: "4px",
                color: "#ffffff",
                cursor:
                  isUpdating || !newVocabularyValue.trim()
                    ? "not-allowed"
                    : "pointer",
                opacity: isUpdating || !newVocabularyValue.trim() ? 0.5 : 1,
              }}
            >
              Add
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setNewVocabularyValue("");
              }}
              disabled={isUpdating}
              style={{
                padding: "8px 16px",
                fontSize: "13px",
                backgroundColor: "rgba(255, 255, 255, 0.1)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                borderRadius: "4px",
                color: "#ffffff",
                cursor: isUpdating ? "not-allowed" : "pointer",
                opacity: isUpdating ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
          </div>
          <div
            style={{
              fontSize: "11px",
              color: "rgba(255, 255, 255, 0.5)",
              marginTop: "8px",
            }}
          >
            Press Enter to add, Esc to cancel
          </div>
        </div>
      )}

      {/* Vocabulary List */}
      {visibleVocabulary.length === 0 ? (
        <div
          style={{
            padding: "40px",
            textAlign: "center",
            color: "rgba(255, 255, 255, 0.6)",
            fontSize: "14px",
          }}
        >
          No vocabulary items yet. Add vocabulary terms to improve transcription
          accuracy for specific words or phrases.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {visibleVocabulary.map((item) => (
            <div
              key={item.id || item.value}
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
              <div style={{ flex: 1 }}>
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
              {!item.is_system_generated && (
                <button
                  onClick={() => handleDeleteVocabulary(item.id)}
                  disabled={isUpdating}
                  style={{
                    padding: "6px 12px",
                    fontSize: "12px",
                    backgroundColor: "rgba(255, 59, 48, 0.2)",
                    border: "1px solid rgba(255, 59, 48, 0.4)",
                    borderRadius: "4px",
                    color: "rgba(255, 59, 48, 0.9)",
                    cursor: isUpdating ? "not-allowed" : "pointer",
                    opacity: isUpdating ? 0.5 : 1,
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Info message */}
      {visibleVocabulary.length > 0 && (
        <div
          style={{
            marginTop: "24px",
            padding: "12px",
            backgroundColor: "rgba(0, 122, 255, 0.1)",
            border: "1px solid rgba(0, 122, 255, 0.2)",
            borderRadius: "6px",
            fontSize: "11px",
            color: "rgba(255, 255, 255, 0.7)",
            lineHeight: "1.5",
          }}
        >
          <strong>Tip:</strong> Adding vocabulary terms helps improve
          transcription accuracy for specific words, names, or technical terms.
          System-generated vocabulary cannot be deleted.
        </div>
      )}
    </div>
  );
};
