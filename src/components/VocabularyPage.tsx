import React, { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, RefreshCw, Plus, X, Trash2 } from "lucide-react";
import type { TauriAppConfig } from "../types";
import "../styles/pages/shared.css";

export const VocabularyPage: React.FC = () => {
  const [config, setConfig] = useState<TauriAppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [newVocabularyValue, setNewVocabularyValue] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [hoveredVocabularyValue, setHoveredVocabularyValue] = useState<
    string | null
  >(null);
  const [deleteConfirmValue, setDeleteConfirmValue] = useState<string | null>(
    null,
  );
  const [deletingValue, setDeletingValue] = useState<string | null>(null);

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

  // Filter vocabulary based on search query
  const filteredVocabulary = useMemo(() => {
    if (!searchQuery.trim()) {
      return vocabulary;
    }
    const query = searchQuery.toLowerCase();
    return vocabulary.filter((item) => item.toLowerCase().includes(query));
  }, [vocabulary, searchQuery]);

  const handleSearchClick = () => {
    setShowSearch((prev) => !prev);
    if (showSearch) {
      setSearchQuery("");
    }
  };

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
    const updatedVocabulary = [...currentVocabulary, newVocabularyValue.trim()];

    try {
      await updateConfig({ vocabulary: updatedVocabulary });
      setNewVocabularyValue("");
      setShowAddForm(false);
      setError(null);
    } catch (err) {
      // Error already set by updateConfig
    }
  };

  const openDeleteConfirm = (value: string) => {
    setDeleteConfirmValue(value);
  };

  const closeDeleteConfirm = () => {
    if (!deletingValue) setDeleteConfirmValue(null);
  };

  const handleConfirmDeleteVocabulary = async () => {
    if (!deleteConfirmValue) return;

    const currentVocabulary = vocabulary || [];
    const updatedVocabulary = currentVocabulary.filter(
      (item) => item !== deleteConfirmValue,
    );

    setDeletingValue(deleteConfirmValue);
    try {
      await updateConfig({ vocabulary: updatedVocabulary });
      setDeleteConfirmValue(null);
      setError(null);
    } catch (err) {
      // Error already set by updateConfig
      alert(
        (err as Error)?.message || "Failed to remove vocabulary item",
      );
    } finally {
      setDeletingValue(null);
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: "40px", maxWidth: "800px", margin: "0 auto" }}>
        <div style={{ textAlign: "center", padding: "40px", color: "#666" }}>
          Loading vocabulary...
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "40px", maxWidth: "800px", margin: "0 auto" }}>
      <h2
        style={{
          fontSize: "18px",
          fontWeight: 500,
          color: "#111827",
          marginBottom: "16px",
          marginTop: 0,
        }}
      >
        Vocabulary
      </h2>

      {error && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            fontSize: "13px",
            padding: "12px 16px",
            marginBottom: "24px",
            borderRadius: "8px",
          }}
        >
          {error}
        </div>
      )}

      {/* Add Vocabulary Form */}
      {showAddForm && (
        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            padding: "20px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "#9ca3af",
              marginBottom: "8px",
            }}
          >
            Vocabulary Term
          </div>
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
              width: "100%",
              padding: "10px 12px",
              fontSize: "14px",
              backgroundColor: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              color: "#111827",
              marginBottom: "16px",
              outline: "none",
              transition: "all 0.2s ease",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "#d1d5db";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "#e5e7eb";
            }}
            autoFocus
          />
          <div
            style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}
          >
            <button
              onClick={() => {
                setShowAddForm(false);
                setNewVocabularyValue("");
              }}
              disabled={isUpdating}
              style={{
                padding: "8px 16px",
                backgroundColor: "#f3f4f6",
                color: "#6b7280",
                border: "none",
                borderRadius: "6px",
                cursor: isUpdating ? "not-allowed" : "pointer",
                fontSize: "14px",
                fontWeight: 500,
                transition: "all 0.2s ease",
                opacity: isUpdating ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!isUpdating) {
                  e.currentTarget.style.backgroundColor = "#e5e7eb";
                  e.currentTarget.style.color = "#111827";
                }
              }}
              onMouseLeave={(e) => {
                if (!isUpdating) {
                  e.currentTarget.style.backgroundColor = "#f3f4f6";
                  e.currentTarget.style.color = "#6b7280";
                }
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleAddVocabulary}
              disabled={isUpdating || !newVocabularyValue.trim()}
              style={{
                padding: "8px 16px",
                backgroundColor: "#111827",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                cursor:
                  isUpdating || !newVocabularyValue.trim()
                    ? "not-allowed"
                    : "pointer",
                fontSize: "14px",
                fontWeight: 500,
                opacity: isUpdating || !newVocabularyValue.trim() ? 0.5 : 1,
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                if (!isUpdating && newVocabularyValue.trim()) {
                  e.currentTarget.style.backgroundColor = "#374151";
                }
              }}
              onMouseLeave={(e) => {
                if (!isUpdating && newVocabularyValue.trim()) {
                  e.currentTarget.style.backgroundColor = "#111827";
                }
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Vocabulary Section */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h3
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              margin: 0,
            }}
          >
            ALL TERMS
          </h3>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <button
              type="button"
              onClick={handleSearchClick}
              style={{
                background: showSearch ? "#f3f4f6" : "transparent",
                border: "none",
                cursor: "pointer",
                color: showSearch ? "#111827" : "#9ca3af",
                padding: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "4px",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                if (!showSearch) {
                  e.currentTarget.style.backgroundColor = "#f3f4f6";
                  e.currentTarget.style.color = "#111827";
                }
              }}
              onMouseLeave={(e) => {
                if (!showSearch) {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#9ca3af";
                }
              }}
            >
              <Search size={16} />
            </button>
            <button
              type="button"
              onClick={() => {
                const loadConfig = async () => {
                  setIsLoading(true);
                  setError(null);
                  try {
                    const loadedConfig =
                      await invoke<TauriAppConfig>("get_app_config");
                    setConfig(loadedConfig);
                  } catch (err: any) {
                    console.error("Failed to load app config:", err);
                    setError(err?.message || "Failed to load vocabulary");
                  } finally {
                    setIsLoading(false);
                  }
                };
                loadConfig();
              }}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#9ca3af",
                padding: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "4px",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#f3f4f6";
                e.currentTarget.style.color = "#111827";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "#9ca3af";
              }}
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(true);
                setNewVocabularyValue("");
              }}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#9ca3af",
                padding: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "4px",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#f3f4f6";
                e.currentTarget.style.color = "#111827";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "#9ca3af";
              }}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Search Input */}
        {showSearch && (
          <div
            style={{
              marginBottom: "16px",
              position: "relative",
            }}
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search vocabulary..."
              autoFocus
              style={{
                width: "100%",
                padding: "10px 40px 10px 12px",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                fontSize: "14px",
                fontFamily: "inherit",
                outline: "none",
                transition: "all 0.2s ease",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#d1d5db";
                e.currentTarget.style.boxShadow =
                  "0 0 0 3px rgba(0, 0, 0, 0.05)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#e5e7eb";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                style={{
                  position: "absolute",
                  right: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "#9ca3af",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "4px",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#f3f4f6";
                  e.currentTarget.style.color = "#111827";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#9ca3af";
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}

        {/* Vocabulary List */}
        {filteredVocabulary.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "60px 20px",
              color: "#9ca3af",
            }}
          >
            <p style={{ margin: 0, fontSize: "14px" }}>
              {searchQuery
                ? "No vocabulary terms match your search"
                : "No vocabulary items yet. Add vocabulary terms to improve transcription accuracy."}
            </p>
          </div>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            {filteredVocabulary.map((item, index) => (
              <div
                key={`${item}-${index}`}
                style={{
                  backgroundColor: "#ffffff",
                  border:
                    hoveredVocabularyValue === item
                      ? "1px solid #d1d5db"
                      : "1px solid #e5e7eb",
                  borderRadius: "8px",
                  padding: "16px",
                  transition: "all 0.2s ease",
                  position: "relative",
                  boxShadow:
                    hoveredVocabularyValue === item
                      ? "0 1px 3px rgba(0, 0, 0, 0.05)"
                      : "none",
                }}
                onMouseEnter={() => setHoveredVocabularyValue(item)}
                onMouseLeave={() => setHoveredVocabularyValue(null)}
              >
                <div
                  style={{
                    position: "absolute",
                    top: "12px",
                    right: "12px",
                    opacity: hoveredVocabularyValue === item ? 1 : 0,
                    transition: "opacity 0.2s ease",
                  }}
                >
                  <button
                    onClick={() => openDeleteConfirm(item)}
                    disabled={isUpdating || !!deletingValue}
                    style={{
                      padding: "6px",
                      backgroundColor: "#fef2f2",
                      border: "none",
                      borderRadius: "4px",
                      cursor:
                        isUpdating || deletingValue ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ef4444",
                      transition: "all 0.2s ease",
                      opacity: isUpdating || deletingValue ? 0.5 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!isUpdating && !deletingValue) {
                        e.currentTarget.style.backgroundColor = "#fee2e2";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isUpdating && !deletingValue) {
                        e.currentTarget.style.backgroundColor = "#fef2f2";
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div style={{ paddingRight: "50px" }}>
                  <div
                    style={{
                      fontSize: "15px",
                      color: "#111827",
                      fontWeight: 400,
                      marginBottom: "4px",
                    }}
                  >
                    {item}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteConfirmValue && (
        <div
          className="delete-modal-overlay"
          onClick={closeDeleteConfirm}
        >
          <div
            className="delete-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Remove vocabulary item?</h3>
            <p>
              This will permanently remove &quot;{deleteConfirmValue}&quot; from
              your vocabulary.
            </p>
            <div className="delete-modal-actions">
              <button
                type="button"
                className="delete-modal-btn-cancel"
                onClick={closeDeleteConfirm}
                disabled={!!deletingValue}
              >
                Cancel
              </button>
              <button
                type="button"
                className="delete-modal-btn-delete"
                onClick={handleConfirmDeleteVocabulary}
                disabled={!!deletingValue}
              >
                {deletingValue ? "Removing..." : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
