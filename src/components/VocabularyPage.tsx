import React, { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, RefreshCw, Plus, X, Trash2, Edit } from "lucide-react";
import type { TauriAppConfig } from "../types";
import { useToast } from "./toast/useToast";
import { ScreenSkeleton } from "./ui/ScreenSkeleton";
import "./home/home.css";

export const VocabularyPage: React.FC = () => {
  const toast = useToast();
  const [config, setConfig] = useState<TauriAppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [newVocabularyValue, setNewVocabularyValue] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [deleteConfirmValue, setDeleteConfirmValue] = useState<string | null>(
    null,
  );
  const [deletingValue, setDeletingValue] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const vocabulary = config?.vocabulary || [];

  // Load app config on mount
  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);

      try {
        const loadedConfig = await invoke<TauriAppConfig>("get_app_config");
        setConfig(loadedConfig);
      } catch (err: any) {
        console.error("Failed to load app config:", err);
        toast.error(err?.message || "Failed to load vocabulary");
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
    setIsUpdating(true);
    try {
      const updatedConfig = await invoke<TauriAppConfig>("update_app_config", {
        config: updates,
      });
      setConfig(updatedConfig);
      return updatedConfig;
    } catch (err: any) {
      console.error("Failed to update config:", err);
      toast.error(err?.message || "Failed to update vocabulary");
      throw err;
    } finally {
      setIsUpdating(false);
    }
  };

  // Add new vocabulary item
  const handleAddVocabulary = async () => {
    if (!newVocabularyValue.trim()) {
      toast.warning("Vocabulary value cannot be empty");
      return;
    }

    const currentVocabulary = vocabulary || [];
    const updatedVocabulary = [...currentVocabulary, newVocabularyValue.trim()];

    try {
      await updateConfig({ vocabulary: updatedVocabulary });
      setNewVocabularyValue("");
      setShowAddForm(false);
      toast.success("Vocabulary added");
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
      toast.success("Vocabulary removed");
    } catch (err) {
      toast.error(
        (err as Error)?.message || "Failed to remove vocabulary item",
      );
    } finally {
      setDeletingValue(null);
    }
  };

  const startEditVocabulary = (value: string) => {
    setEditingValue(value);
    setEditDraft(value);
  };

  const cancelEditVocabulary = () => {
    setEditingValue(null);
    setEditDraft("");
  };

  const saveEditVocabulary = async () => {
    if (!editingValue) return;
    const trimmed = editDraft.trim();
    if (!trimmed) {
      toast.warning("Vocabulary value cannot be empty");
      return;
    }
    if (trimmed === editingValue) {
      cancelEditVocabulary();
      return;
    }
    const currentVocabulary = vocabulary || [];
    const updatedVocabulary = currentVocabulary.map((v) =>
      v === editingValue ? trimmed : v,
    );
    try {
      await updateConfig({ vocabulary: updatedVocabulary });
      toast.success("Vocabulary updated");
      cancelEditVocabulary();
    } catch (err) {
      // Error already shown by updateConfig
    }
  };

  if (isLoading) {
    return (
      <div className="page">
        <h2 className="page__title">Vocabulary</h2>
        <ScreenSkeleton variant="vocabulary" className="page__empty" />
      </div>
    );
  }

  return (
    <div className="page">
      <h2 className="page__title">Vocabulary</h2>

      {/* Add Vocabulary Form */}
      {showAddForm && (
        <div className="panel">
          <div className="panel__label">Vocabulary Term</div>
          <input
            type="text"
            className="form-input form-input--lg"
            value={newVocabularyValue}
            onChange={(e) => setNewVocabularyValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddVocabulary();
              else if (e.key === "Escape") {
                setShowAddForm(false);
                setNewVocabularyValue("");
              }
            }}
            placeholder="Enter vocabulary term..."
            disabled={isUpdating}
            autoFocus
          />
          <div className="btn-row">
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setNewVocabularyValue("");
              }}
              disabled={isUpdating}
              className="btn btn--secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddVocabulary}
              disabled={isUpdating || !newVocabularyValue.trim()}
              className="btn btn--primary"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Vocabulary Section */}
      <div>
        <div className="vocab-header">
          <h3 className="vocab-header__title">ALL TERMS</h3>
          <div className="vocab-actions">
            <button
              type="button"
              onClick={handleSearchClick}
              className={`btn btn--icon ${showSearch ? "active" : ""}`}
              aria-label="Search"
            >
              <Search size={16} />
            </button>
            <button
              type="button"
              onClick={async () => {
                setIsLoading(true);
                try {
                  const loadedConfig =
                    await invoke<TauriAppConfig>("get_app_config");
                  setConfig(loadedConfig);
                } catch (err: any) {
                  console.error("Failed to load app config:", err);
                  toast.error(err?.message || "Failed to load vocabulary");
                } finally {
                  setIsLoading(false);
                }
              }}
              className="btn btn--icon"
              aria-label="Refresh"
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(true);
                setNewVocabularyValue("");
              }}
              className="btn btn--icon"
              aria-label="Add"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {showSearch && (
          <div className="search-wrap">
            <input
              type="text"
              className="form-input form-input--with-clear"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search vocabulary..."
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="search-clear"
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}

        {filteredVocabulary.length === 0 ? (
          <div className="page__empty page__empty--sm">
            <p>
              {searchQuery
                ? "No vocabulary terms match your search"
                : "No vocabulary items yet. Add vocabulary terms to improve transcription accuracy."}
            </p>
          </div>
        ) : (
          <div className="vocab-list">
            {filteredVocabulary.map((item, index) => (
              <div key={`${item}-${index}`} className="vocab-item">
                <div className="vocab-item__actions">
                  {editingValue !== item ? (
                    <button
                      type="button"
                      onClick={() => startEditVocabulary(item)}
                      disabled={isUpdating || !!deletingValue}
                      className="btn btn--icon-sm"
                      title="Edit vocabulary"
                    >
                      <Edit size={14} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openDeleteConfirm(item)}
                    disabled={isUpdating || !!deletingValue}
                    className="btn btn--icon-sm btn--icon-danger"
                    title="Remove from vocabulary"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="vocab-item__body">
                  {editingValue === item ? (
                    <div className="form-row">
                      <input
                        type="text"
                        className="form-input"
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEditVocabulary();
                          if (e.key === "Escape") cancelEditVocabulary();
                        }}
                        autoFocus
                      />
                      <div className="form-row--inline btn-row">
                        <button
                          type="button"
                          onClick={cancelEditVocabulary}
                          className="btn btn--secondary"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={saveEditVocabulary}
                          disabled={isUpdating}
                          className="btn btn--primary"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="vocab-item__text">{item}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteConfirmValue && (
        <div className="delete-modal-overlay" onClick={closeDeleteConfirm}>
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
