import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, Plus, Edit, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const showContent =
    authStore.isInitialized &&
    (!authStore.isAuthenticated || !!authStore.tokens?.access_token);
  const showLogin = authStore.isInitialized && !authStore.isAuthenticated;

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

  const GRID_VARIANTS = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.06, delayChildren: 0.08 },
    },
  };

  const CARD_VARIANTS = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, ease: [0.22, 0.61, 0.36, 1] as const },
    },
  };

  const listEmpty = !isLoading && shortcuts.length === 0;

  return (
    <div className="transcripts-page">
      <h2 className="transcripts-page-title">Shortcuts</h2>
      {authStore.isInitialized && isLoading ? (
        <p className="app-page-subtitle">Loading…</p>
      ) : authStore.isInitialized && shortcuts.length > 0 ? (
        <p className="app-page-subtitle">
          {shortcuts.length} {shortcuts.length === 1 ? "shortcut" : "shortcuts"}
        </p>
      ) : null}

      {!showContent && (
        <ScreenSkeleton variant="shortcuts" className="page__empty" />
      )}

      {showLogin && showContent && (
        <div className="transcripts-login-wrap">
          <p className="permission-text">
            Sign in to manage your text shortcuts
          </p>
          <GoogleLoginButton onSuccess={() => {}} onError={() => {}} />
        </div>
      )}

      <div className="transcripts-page__content">
        {showContent && !showLogin && showCreateShortcut && (
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

        {showContent && !showLogin && (
          <>
            <div className="shortcuts-toolbar">
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
          </>
        )}

        <AnimatePresence mode="wait">
          {showContent && !showLogin && isLoading && shortcuts.length === 0 && (
            <motion.div
              key="shortcuts-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <ScreenSkeleton
                variant="shortcuts"
                className="transcripts-loading-inline"
              />
            </motion.div>
          )}

          {showContent && !showLogin && listEmpty && (
            <motion.div
              key="shortcuts-empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <div className="transcripts-empty-wrap">
                <p>No shortcuts yet.</p>
                <p className="transcripts-empty-sub">
                  Add a shortcut to expand a phrase whenever you use it.
                </p>
              </div>
            </motion.div>
          )}

          {showContent && !showLogin && shortcuts.length > 0 && (
            <motion.div
              key="shortcuts-cards"
              className="transcripts-cards"
              variants={GRID_VARIANTS}
              initial="hidden"
              animate="visible"
            >
              {shortcuts.map((shortcut) => {
                const isEditing = editingShortcut?.id === shortcut.id;
                return (
                  <motion.div
                    key={shortcut.id}
                    className={`transcript-card ${isEditing ? "shortcut-card--editing" : ""}`}
                    variants={CARD_VARIANTS}
                  >
                    {isEditing && editingShortcut ? (
                      <>
                        <div className="panel__label">Shortcut</div>
                        <input
                          type="text"
                          className="form-input form-input--lg"
                          value={editingShortcut.shortcut}
                          onChange={(e) =>
                            setEditingShortcut({
                              ...editingShortcut,
                              shortcut: e.target.value,
                            })
                          }
                        />
                        <div className="panel__label">Value</div>
                        <textarea
                          className="form-input form-input--lg"
                          value={editingShortcut.value}
                          onChange={(e) =>
                            setEditingShortcut({
                              ...editingShortcut,
                              value: e.target.value,
                            })
                          }
                          rows={4}
                        />
                        <div className="btn-row">
                          <button
                            type="button"
                            onClick={() => setEditingShortcut(null)}
                            className="btn btn--secondary"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateShortcut(shortcut)}
                            className="btn btn--primary"
                          >
                            Save
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="transcript-card__body">
                        <div className="transcript-card__row">
                          <div className="transcript-card__main">
                            <div className="shortcut-card__trigger">
                              {shortcut.shortcut}
                            </div>
                            <div className="shortcut-card__value">
                              → {shortcut.value}
                            </div>
                          </div>
                          <div className="transcript-card__actions">
                            <div className="transcript-actions-cell">
                              <button
                                type="button"
                                onClick={() => handleUpdateShortcut(shortcut)}
                                className="transcript-action-btn"
                                title="Edit shortcut"
                              >
                                <Edit size={16} />
                              </button>
                              <button
                                type="button"
                                onClick={() => openDeleteConfirm(shortcut.id)}
                                disabled={!!deletingId}
                                className="transcript-action-btn transcript-action-btn--delete"
                                title="Delete shortcut"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
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
