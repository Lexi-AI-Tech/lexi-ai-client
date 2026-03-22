import React, { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, RefreshCw, Plus, X, Edit, Trash2 } from "lucide-react";
import type { Shortcut } from "../types";
import { useAuthStore } from "../store/authStore";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";
import { useToast } from "./toast/useToast";
import { ScreenSkeleton } from "./ui/ScreenSkeleton";
import "./home/home.css";

export const ShortcutsPage: React.FC = () => {
  const authStore = useAuthStore();
  const toast = useToast();
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateShortcut, setShowCreateShortcut] = useState(false);
  const [newShortcut, setNewShortcut] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editingShortcut, setEditingShortcut] = useState<Shortcut | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [hoveredShortcutId, setHoveredShortcutId] = useState<string | null>(
    null,
  );
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Load shortcuts
  const loadShortcuts = async () => {
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      setShortcuts([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const data = await invoke<Shortcut[]>("get_shortcuts");
      setShortcuts(data);
    } catch (err: any) {
      console.error("Failed to load shortcuts:", err);
      const errorMessage = err?.message || "Failed to load shortcuts";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error loading shortcuts, clearing auth");
        authStore.clearAuth();
        setShortcuts([]);
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (authStore.isInitialized) {
      loadShortcuts();
    }
  }, [authStore.isAuthenticated, authStore.isInitialized]);

  // Filter shortcuts based on search query
  const filteredShortcuts = useMemo(() => {
    if (!searchQuery.trim()) {
      return shortcuts;
    }
    const query = searchQuery.toLowerCase();
    return shortcuts.filter(
      (shortcut) =>
        shortcut.shortcut.toLowerCase().includes(query) ||
        shortcut.value.toLowerCase().includes(query),
    );
  }, [shortcuts, searchQuery]);

  const handleSearchClick = () => {
    setShowSearch((prev) => !prev);
    if (showSearch) {
      setSearchQuery("");
    }
  };

  const handleCreateShortcut = async () => {
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      toast.error("Please sign in to create shortcuts");
      return;
    }

    if (!newShortcut.trim() || !newValue.trim()) {
      toast.warning("Both shortcut and value are required");
      return;
    }

    try {
      await invoke<Shortcut>("create_shortcut", {
        request: {
          shortcut: newShortcut.trim(),
          value: newValue.trim(),
        },
      });
      setNewShortcut("");
      setNewValue("");
      setShowCreateShortcut(false);
      await loadShortcuts();
      toast.success("Shortcut created");
    } catch (err: any) {
      const errorMessage = err?.message || "Failed to create shortcut";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error creating shortcut, clearing auth");
        authStore.clearAuth();
      } else {
        toast.error(errorMessage);
      }
    }
  };

  const handleUpdateShortcut = async (shortcut: Shortcut) => {
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      toast.error("Please sign in to update shortcuts");
      return;
    }

    if (!editingShortcut) {
      setEditingShortcut(shortcut);
      return;
    }

    if (editingShortcut.id !== shortcut.id) {
      setEditingShortcut(shortcut);
      return;
    }

    try {
      await invoke<Shortcut>("update_shortcut", {
        shortcutId: shortcut.id,
        request: {
          shortcut: editingShortcut.shortcut,
          value: editingShortcut.value,
        },
      });
      await loadShortcuts();
      setEditingShortcut(null);
      toast.success("Shortcut updated");
    } catch (err: any) {
      const errorMessage = err?.message || "Failed to update shortcut";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error updating shortcut, clearing auth");
        authStore.clearAuth();
      } else {
        toast.error(errorMessage);
      }
    }
  };

  const openDeleteConfirm = (shortcutId: string) => {
    setDeleteConfirmId(shortcutId);
  };

  const closeDeleteConfirm = () => {
    if (!deletingId) setDeleteConfirmId(null);
  };

  const handleConfirmDeleteShortcut = async () => {
    if (!deleteConfirmId) return;
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      toast.error("Please sign in to delete shortcuts");
      return;
    }

    setDeletingId(deleteConfirmId);
    try {
      await invoke("delete_shortcut", {
        shortcutId: deleteConfirmId,
      });
      setDeleteConfirmId(null);
      await loadShortcuts();
      toast.success("Shortcut deleted");
    } catch (err: any) {
      const errorMessage = err?.message || "Failed to delete shortcut";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error deleting shortcut, clearing auth");
        authStore.clearAuth();
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setDeletingId(null);
    }
  };

  if (!authStore.isInitialized) {
    return (
      <div className="page">
        <h2 className="page__title">Shortcuts</h2>
        <ScreenSkeleton variant="shortcuts" className="page__empty" />
      </div>
    );
  }

  if (!authStore.isAuthenticated) {
    return (
      <div className="page">
        <h2 className="page__title">Shortcuts</h2>
        <div className="panel panel--center">
          <p className="panel__message">Sign in to access your shortcuts</p>
          <GoogleLoginButton
            onSuccess={() => {
              // Shortcuts will be loaded automatically via useEffect
            }}
            onError={() => {}}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h2 className="page__title">Shortcuts</h2>

      {showCreateShortcut && (
        <div className="panel">
          <div className="panel__label">Shortcut</div>
          <input
            type="text"
            className="form-input form-input--lg"
            value={newShortcut}
            onChange={(e) => setNewShortcut(e.target.value)}
            placeholder="e.g., 'hey lexi'"
          />
          <div className="panel__label">Value</div>
          <textarea
            className="form-input form-input--lg"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="e.g., 'Hello, this is Lexi'"
            rows={4}
          />
          <div className="btn-row">
            <button
              type="button"
              onClick={() => {
                setShowCreateShortcut(false);
                setNewShortcut("");
                setNewValue("");
              }}
              className="btn btn--secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateShortcut}
              disabled={!newShortcut.trim() || !newValue.trim()}
              className="btn btn--primary"
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div>
        <div className="vocab-header">
          <h3 className="vocab-header__title">ALL SHORTCUTS</h3>
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
              onClick={loadShortcuts}
              className="btn btn--icon"
              aria-label="Refresh"
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreateShortcut(true);
                setNewShortcut("");
                setNewValue("");
              }}
              className="btn btn--icon"
              aria-label="Add shortcut"
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
              placeholder="Search shortcuts..."
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

        {/* Shortcuts List */}
        {isLoading ? (
          <ScreenSkeleton
            variant="shortcuts"
            className="page__empty--sm"
          />
        ) : filteredShortcuts.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "60px 20px",
              color: "#9ca3af",
            }}
          >
            <p style={{ margin: 0, fontSize: "14px" }}>
              {searchQuery
                ? "No shortcuts match your search"
                : "No shortcuts found"}
            </p>
          </div>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            {filteredShortcuts.map((shortcut) => {
              const isEditing = editingShortcut?.id === shortcut.id;
              return (
                <div
                  key={shortcut.id}
                  style={{
                    backgroundColor: "#ffffff",
                    border:
                      hoveredShortcutId === shortcut.id && !isEditing
                        ? "1px solid #d1d5db"
                        : "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "16px",
                    transition: "all 0.2s ease",
                    position: "relative",
                    boxShadow:
                      hoveredShortcutId === shortcut.id && !isEditing
                        ? "0 1px 3px rgba(0, 0, 0, 0.05)"
                        : "none",
                  }}
                  onMouseEnter={() => setHoveredShortcutId(shortcut.id)}
                  onMouseLeave={() => setHoveredShortcutId(null)}
                >
                  {isEditing ? (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            color: "#9ca3af",
                            marginBottom: "6px",
                          }}
                        >
                          Shortcut
                        </div>
                        <input
                          type="text"
                          value={editingShortcut.shortcut}
                          onChange={(e) =>
                            setEditingShortcut({
                              ...editingShortcut,
                              shortcut: e.target.value,
                            })
                          }
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            fontSize: "14px",
                            backgroundColor: "#ffffff",
                            border: "1px solid #e5e7eb",
                            borderRadius: "8px",
                            color: "#111827",
                            outline: "none",
                            transition: "all 0.2s ease",
                          }}
                          onFocus={(e) => {
                            e.currentTarget.style.borderColor = "#d1d5db";
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.borderColor = "#e5e7eb";
                          }}
                        />
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            color: "#9ca3af",
                            marginBottom: "6px",
                          }}
                        >
                          Value
                        </div>
                        <textarea
                          value={editingShortcut.value}
                          onChange={(e) =>
                            setEditingShortcut({
                              ...editingShortcut,
                              value: e.target.value,
                            })
                          }
                          rows={4}
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            fontSize: "14px",
                            fontFamily: "inherit",
                            backgroundColor: "#ffffff",
                            border: "1px solid #e5e7eb",
                            borderRadius: "8px",
                            color: "#111827",
                            outline: "none",
                            transition: "all 0.2s ease",
                            resize: "vertical",
                            minHeight: "80px",
                          }}
                          onFocus={(e) => {
                            e.currentTarget.style.borderColor = "#d1d5db";
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.borderColor = "#e5e7eb";
                          }}
                        />
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          onClick={() => setEditingShortcut(null)}
                          style={{
                            padding: "8px 16px",
                            backgroundColor: "#f3f4f6",
                            color: "#6b7280",
                            border: "none",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "14px",
                            fontWeight: 500,
                            transition: "all 0.2s ease",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = "#e5e7eb";
                            e.currentTarget.style.color = "#111827";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = "#f3f4f6";
                            e.currentTarget.style.color = "#6b7280";
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleUpdateShortcut(shortcut)}
                          style={{
                            padding: "8px 16px",
                            backgroundColor: "#111827",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "14px",
                            fontWeight: 500,
                            transition: "all 0.2s ease",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = "#374151";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = "#111827";
                          }}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Action buttons */}
                      <div
                        style={{
                          position: "absolute",
                          top: "12px",
                          right: "12px",
                          display: "flex",
                          gap: "6px",
                        }}
                      >
                        <button
                          onClick={() => handleUpdateShortcut(shortcut)}
                          style={{
                            padding: "6px",
                            backgroundColor: "#f3f4f6",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#6b7280",
                            transition: "all 0.2s ease",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = "#e5e7eb";
                            e.currentTarget.style.color = "#111827";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = "#f3f4f6";
                            e.currentTarget.style.color = "#6b7280";
                          }}
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={() => openDeleteConfirm(shortcut.id)}
                          disabled={!!deletingId}
                          style={{
                            padding: "6px",
                            backgroundColor: "#fef2f2",
                            border: "none",
                            borderRadius: "4px",
                            cursor: deletingId ? "not-allowed" : "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#ef4444",
                            transition: "all 0.2s ease",
                            opacity: deletingId ? 0.6 : 1,
                          }}
                          onMouseEnter={(e) => {
                            if (!deletingId) {
                              e.currentTarget.style.backgroundColor = "#fee2e2";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!deletingId) {
                              e.currentTarget.style.backgroundColor = "#fef2f2";
                            }
                          }}
                          title="Delete shortcut"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div style={{ paddingRight: "60px" }}>
                        <div
                          style={{
                            fontSize: "15px",
                            color: "#111827",
                            fontWeight: 500,
                            marginBottom: "4px",
                          }}
                        >
                          {shortcut.shortcut}
                        </div>
                        <div
                          style={{
                            fontSize: "14px",
                            color: "#6b7280",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          → {shortcut.value}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {deleteConfirmId && (
        <div className="delete-modal-overlay" onClick={closeDeleteConfirm}>
          <div
            className="delete-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Delete shortcut?</h3>
            <p>
              This action cannot be undone. The shortcut will be permanently
              removed.
            </p>
            <div className="delete-modal-actions">
              <button
                type="button"
                className="delete-modal-btn-cancel"
                onClick={closeDeleteConfirm}
                disabled={!!deletingId}
              >
                Cancel
              </button>
              <button
                type="button"
                className="delete-modal-btn-delete"
                onClick={handleConfirmDeleteShortcut}
                disabled={!!deletingId}
              >
                {deletingId ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
