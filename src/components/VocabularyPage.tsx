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
      <div
        style={{
          padding: "2rem 2.5rem",
          background: "#ffffff",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
        }}
      >
        <h2
          style={{
            margin: 0,
            marginBottom: "32px",
            fontSize: "24px",
            fontWeight: 600,
            color: "#111827",
            letterSpacing: "-0.025em",
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
            color: "#6b7280",
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
    <div
      style={{
        padding: "2rem 2.5rem",
        background: "#ffffff",
        minHeight: "100vh",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2rem",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: "24px",
            fontWeight: 600,
            color: "#111827",
            letterSpacing: "-0.025em",
          }}
        >
          Vocabulary
        </h2>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            disabled={isUpdating}
            style={{
              padding: "0.5rem 1.5rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              backgroundColor: "#111827",
              border: "1px solid #111827",
              borderRadius: "0.5rem",
              color: "#ffffff",
              cursor: isUpdating ? "not-allowed" : "pointer",
              opacity: isUpdating ? 0.5 : 1,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              if (!isUpdating) {
                e.currentTarget.style.background = "#374151";
                e.currentTarget.style.borderColor = "#374151";
              }
            }}
            onMouseLeave={(e) => {
              if (!isUpdating) {
                e.currentTarget.style.background = "#111827";
                e.currentTarget.style.borderColor = "#111827";
              }
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
            background: "#fef2f2",
            borderColor: "#fecaca",
            color: "#b91c1c",
            fontSize: "11px",
            padding: "12px",
            marginBottom: "16px",
            borderRadius: "0.5rem",
            border: "1px solid",
          }}
        >
          {error}
        </div>
      )}

      {/* Add Vocabulary Form */}
      {showAddForm && (
        <div
          style={{
            padding: "1.5rem",
            backgroundColor: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "0.75rem",
            marginBottom: "1.5rem",
            boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
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
                padding: "0.875rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                backgroundColor: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "0.625rem",
                color: "#111827",
                outline: "none",
                transition: "all 0.2s ease",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#6366f1";
                e.currentTarget.style.boxShadow =
                  "0 0 0 3px rgba(99, 102, 241, 0.1), 0 1px 2px rgba(0, 0, 0, 0.05)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#e5e7eb";
                e.currentTarget.style.boxShadow =
                  "0 1px 2px rgba(0, 0, 0, 0.05)";
              }}
              onMouseEnter={(e) => {
                if (document.activeElement !== e.currentTarget) {
                  e.currentTarget.style.borderColor = "#d1d5db";
                  e.currentTarget.style.boxShadow =
                    "0 2px 4px rgba(0, 0, 0, 0.08)";
                }
              }}
              onMouseLeave={(e) => {
                if (document.activeElement !== e.currentTarget) {
                  e.currentTarget.style.borderColor = "#e5e7eb";
                  e.currentTarget.style.boxShadow =
                    "0 1px 2px rgba(0, 0, 0, 0.05)";
                }
              }}
              autoFocus
            />
            <button
              onClick={handleAddVocabulary}
              disabled={isUpdating || !newVocabularyValue.trim()}
              style={{
                padding: "0.875rem 1.5rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                backgroundColor: "#111827",
                border: "1px solid #111827",
                borderRadius: "0.5rem",
                color: "#ffffff",
                cursor:
                  isUpdating || !newVocabularyValue.trim()
                    ? "not-allowed"
                    : "pointer",
                opacity: isUpdating || !newVocabularyValue.trim() ? 0.5 : 1,
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                if (!isUpdating && newVocabularyValue.trim()) {
                  e.currentTarget.style.background = "#374151";
                  e.currentTarget.style.borderColor = "#374151";
                }
              }}
              onMouseLeave={(e) => {
                if (!isUpdating && newVocabularyValue.trim()) {
                  e.currentTarget.style.background = "#111827";
                  e.currentTarget.style.borderColor = "#111827";
                }
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
                padding: "0.875rem 1.5rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                backgroundColor: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "0.5rem",
                color: "#6b7280",
                cursor: isUpdating ? "not-allowed" : "pointer",
                opacity: isUpdating ? 0.5 : 1,
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                if (!isUpdating) {
                  e.currentTarget.style.background = "#f9fafb";
                  e.currentTarget.style.borderColor = "#d1d5db";
                  e.currentTarget.style.color = "#111827";
                }
              }}
              onMouseLeave={(e) => {
                if (!isUpdating) {
                  e.currentTarget.style.background = "#ffffff";
                  e.currentTarget.style.borderColor = "#e5e7eb";
                  e.currentTarget.style.color = "#6b7280";
                }
              }}
            >
              Cancel
            </button>
          </div>
          <div
            style={{
              fontSize: "0.75rem",
              color: "#9ca3af",
              marginTop: "0.75rem",
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
            padding: "3rem 1rem",
            textAlign: "center",
            color: "#6b7280",
            fontSize: "0.875rem",
            background: "#ffffff",
            border: "1px solid #f3f4f6",
            borderRadius: "0.75rem",
          }}
        >
          No vocabulary items yet. Add vocabulary terms to improve transcription
          accuracy for specific words or phrases.
        </div>
      ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          {visibleVocabulary.map((item) => (
            <div
              key={item.id || item.value}
              style={{
                padding: "1.25rem",
                backgroundColor: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "0.75rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                transition: "all 0.2s ease",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#d1d5db";
                e.currentTarget.style.boxShadow =
                  "0 4px 12px rgba(0, 0, 0, 0.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#e5e7eb";
                e.currentTarget.style.boxShadow =
                  "0 1px 2px rgba(0, 0, 0, 0.05)";
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: "0.9375rem",
                    color: "#111827",
                    fontWeight: 500,
                    marginBottom: "0.25rem",
                  }}
                >
                  {item.value}
                </div>
                {item.is_system_generated && (
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "#9ca3af",
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
                    padding: "0.5rem 1rem",
                    fontSize: "0.8125rem",
                    fontWeight: 500,
                    backgroundColor: "#ffffff",
                    border: "1px solid #fecaca",
                    borderRadius: "0.5rem",
                    color: "#b91c1c",
                    cursor: isUpdating ? "not-allowed" : "pointer",
                    opacity: isUpdating ? 0.5 : 1,
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isUpdating) {
                      e.currentTarget.style.background = "#fef2f2";
                      e.currentTarget.style.borderColor = "#fca5a5";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isUpdating) {
                      e.currentTarget.style.background = "#ffffff";
                      e.currentTarget.style.borderColor = "#fecaca";
                    }
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
            marginTop: "1.5rem",
            padding: "1rem",
            backgroundColor: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: "0.75rem",
            fontSize: "0.8125rem",
            color: "#1e40af",
            lineHeight: "1.5",
          }}
        >
          <strong style={{ fontWeight: 600 }}>Tip:</strong> Adding vocabulary
          terms helps improve transcription accuracy for specific words, names,
          or technical terms. System-generated vocabulary cannot be deleted.
        </div>
      )}
    </div>
  );
};
