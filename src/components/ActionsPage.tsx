import React, { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, Pause, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { PaginatedActionHistoryResponse, AppConfig } from "../types";
import { formatAppDateTime } from "../lib/dateUtils";
import { KEY_SYMBOLS } from "../lib/keySymbols";
import { useAuthStore } from "../store/authStore";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";
import { useToast } from "./toast/useToast";
import "../styles/components/hotkey-selector.css";
import { ScreenSkeleton } from "./ui/ScreenSkeleton";
import "./home/home.css";
import "./actions/actions.css";

export const ActionsPage: React.FC = () => {
  const authStore = useAuthStore();
  const toast = useToast();
  const [actionHistory, setActionHistory] =
    useState<PaginatedActionHistoryResponse | null>(null);
  const [actionHotkeys, setActionHotkeys] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Track which action IDs are newly added so we animate them in.
  const prevActionIdsRef = useRef<Set<string>>(new Set());
  const [enteringActionOrder, setEnteringActionOrder] = useState<string[]>([]);

  const pageSize = 20;

  const openDeleteConfirm = (actionId: string) => {
    setDeleteConfirmId(actionId);
  };

  const closeDeleteConfirm = () => {
    if (!deletingId) setDeleteConfirmId(null);
  };

  const handleConfirmDeleteAction = async () => {
    if (!deleteConfirmId) return;
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      toast.error("Please sign in to delete actions");
      return;
    }

    setDeletingId(deleteConfirmId);
    try {
      await invoke("delete_action_history", { actionId: deleteConfirmId });
      setDeleteConfirmId(null);
      await loadActionHistory();
      toast.success("Action deleted");
    } catch (err: any) {
      const errorMessage = err?.message || "Failed to delete action";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error deleting action, clearing auth");
        authStore.clearAuth();
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handlePlayActionAudio = (actionId: string, audioUrl: string) => {
    if (playingId === actionId && audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.addEventListener("timeupdate", () => {
      if (audio.duration) {
        setAudioProgress((audio.currentTime / audio.duration) * 100);
      }
    });
    audio.addEventListener("ended", () => {
      setPlayingId(null);
      setAudioProgress(0);
    });
    audio.play();
    setPlayingId(actionId);
    setAudioProgress(0);
  };

  // Load action history
  const loadActionHistory = async () => {
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      setActionHistory(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const data = await invoke<PaginatedActionHistoryResponse>(
        "get_action_history",
        {
          page,
          pageSize,
        },
      );
      setActionHistory(data);
    } catch (err: any) {
      console.error("Failed to load action history:", err);
      const errorMessage = err?.message || "Failed to load action history";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error loading action history, clearing auth");
        authStore.clearAuth();
        setActionHistory(null);
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Load app config (for hotkey)
  const loadConfig = async () => {
    try {
      const config = await invoke<AppConfig>("get_app_config");
      setActionHotkeys(config.action_hotkeys || []);
    } catch (err) {
      console.error("Failed to load app config:", err);
    }
  };

  useEffect(() => {
    if (authStore.isInitialized) {
      loadActionHistory();
    }
  }, [page, authStore.isAuthenticated, authStore.isInitialized]);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    const nextIds = new Set((actionHistory?.actions ?? []).map((a) => a.id));
    const newlyAdded: string[] = [];
    for (const a of actionHistory?.actions ?? []) {
      if (!prevActionIdsRef.current.has(a.id)) newlyAdded.push(a.id);
    }

    prevActionIdsRef.current = nextIds;
    if (newlyAdded.length === 0) return;

    setEnteringActionOrder(newlyAdded);
    const id = window.setTimeout(() => setEnteringActionOrder([]), 700);
    return () => window.clearTimeout(id);
  }, [actionHistory]);

  // Show loading while waiting for auth to initialize
  if (!authStore.isInitialized) {
    return (
      <div className="page">
        <h2 className="page__title">Actions</h2>
        <ScreenSkeleton
          variant="actions"
          className="page__empty"
        />
      </div>
    );
  }

  // Show login prompt if not authenticated
  if (!authStore.isAuthenticated) {
    return (
      <div className="actions-page">
        <h2 className="actions-page__title">Actions</h2>
        <div className="actions-login">
          <p className="actions-login__hint">Sign in to access your actions</p>
          <GoogleLoginButton
            onSuccess={() => {
              // Actions will be loaded automatically via useEffect
            }}
            onError={() => {}}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="actions-page">
      <h2 className="actions-page__title">Actions</h2>

      {/* Global Hotkey Section */}
      <div style={{ marginBottom: "3rem" }}>
        <div className="hotkey-selector">
          <div className="hotkey-selector__header">
            <label className="hotkey-selector__label">Action Hotkeys</label>
            <p className="hotkey-selector__description">
              {`Hold ${actionHotkeys.length > 0 && !actionHotkeys[0].includes("+") ? "this key" : "this hotkey combination"} to record a voice command for actions`}
            </p>
          </div>

          <div className="hotkey-selector__chips">
            {actionHotkeys.length > 0 ? (
              actionHotkeys.map((hotkey, index) => {
                const keys = hotkey.split("+");
                return (
                  <div
                    key={`hotkey-${index}-${hotkey}`}
                    className="hotkey-selector__chip-wrapper"
                    style={{ paddingRight: 0 }}
                  >
                    <div className="hotkey-selector__chip">
                      {keys.map((key, keyIndex) => {
                        const keyName = key.trim().toLowerCase();
                        const keyInfo = KEY_SYMBOLS[keyName];
                        return (
                          <span
                            key={`${keyIndex}-${key}`}
                            className="hotkey-selector__key-row"
                          >
                            <span className="hotkey-selector__key-cap">
                              {keyInfo && (
                                <span className="hotkey-selector__key-symbol">
                                  {keyInfo.symbol}
                                </span>
                              )}
                              <span className="hotkey-selector__key-label">
                                {keyInfo ? keyInfo.label : key.trim()}
                              </span>
                            </span>
                            {keyIndex < keys.length - 1 && (
                              <span className="hotkey-selector__plus">+</span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            ) : (
              <div
                style={{
                  color: "#9ca3af",
                  fontSize: "14px",
                  padding: "12px 16px",
                }}
              >
                No action hotkeys configured.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action History Section */}
      <div>
        <h3 className="actions-page__section-title">Action History</h3>

        {isLoading ? (
          <ScreenSkeleton variant="actionsHistory" />
        ) : !actionHistory || actionHistory.actions.length === 0 ? (
          <div className="actions-page__empty">
            No action history yet. Actions will appear here as you use them.
          </div>
        ) : (
          <>
            <div className="actions-history">
              <AnimatePresence initial={false}>
                {actionHistory.actions.map((action) => {
                  const enterIdx = enteringActionOrder.indexOf(action.id);
                  const isEntering = enterIdx !== -1;
                  return (
                    <motion.div
                      key={action.id}
                      className="action-card"
                      initial={isEntering ? { opacity: 0, y: 8 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.22,
                        delay: isEntering ? Math.min(enterIdx, 24) * 0.03 : 0,
                      }}
                      layout
                      exit={{ opacity: 0, y: -8, transition: { duration: 0.12 } }}
                    >
                  <div className="action-card__top">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="action-card__command">
                        {action.action_command}
                      </div>
                      {action.app_name && (
                        <div className="action-card__context">
                          <span className="action-card__context-dot" />
                          Context: {action.app_name}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => openDeleteConfirm(action.id)}
                      disabled={!!deletingId}
                      className="action-delete-btn"
                      title="Delete action"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {action.selected_text && (
                    <div className="action-card__divider">
                      <div className="action-card__label">Input</div>
                      <div
                        className="action-card__text"
                        style={{ WebkitLineClamp: 3 }}
                      >
                        {action.selected_text}
                      </div>
                    </div>
                  )}

                  {/* Text action: show output value. Voice action: show output value + audio player (transcripts-style) */}
                  {(action.output_value || action.output_audio_file_url) && (
                    <div className="action-card__divider">
                      {action.output_audio_file_url && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            flexShrink: 0,
                          }}
                        >
                          <button
                            onClick={() =>
                              handlePlayActionAudio(
                                action.id,
                                action.output_audio_file_url!,
                              )
                            }
                            className={`action-audio-btn ${playingId === action.id ? "action-audio-btn--playing" : ""}`}
                            title={
                              playingId === action.id ? "Pause" : "Play audio"
                            }
                          >
                            {playingId === action.id && (
                              <svg
                                style={{
                                  position: "absolute",
                                  width: "28px",
                                  height: "28px",
                                  transform: "rotate(-90deg)",
                                }}
                              >
                                <circle
                                  cx="14"
                                  cy="14"
                                  r="12"
                                  fill="none"
                                  stroke="rgba(255,255,255,0.2)"
                                  strokeWidth="2"
                                />
                                <circle
                                  cx="14"
                                  cy="14"
                                  r="12"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeDasharray={`${audioProgress * 0.754} 75.4`}
                                  strokeLinecap="round"
                                />
                              </svg>
                            )}
                            {playingId === action.id ? (
                              <Pause size={12} fill="currentColor" />
                            ) : (
                              <Play
                                size={12}
                                fill="currentColor"
                                style={{ marginLeft: "2px" }}
                              />
                            )}
                          </button>
                        </div>
                      )}
                      {action.output_value && (
                        <div className="action-card__text">
                          {action.output_value}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="action-card__bottom">
                    <span>{formatAppDateTime(action.created_at)}</span>
                    <span>•</span>
                    <span style={{ textTransform: "capitalize" }}>
                      {action.action_type.replace("_", " ")}
                    </span>
                  </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {/* Pagination */}
            {actionHistory.total_pages > 1 && (
              <div className="action-pagination">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="action-pagination__btn"
                >
                  Previous
                </button>
                <div className="action-pagination__label">
                  Page {page} of {actionHistory.total_pages}
                </div>
                <button
                  onClick={() =>
                    setPage((p) => Math.min(actionHistory.total_pages, p + 1))
                  }
                  disabled={page === actionHistory.total_pages}
                  className="action-pagination__btn"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}

        {deleteConfirmId && (
          <div className="delete-modal-overlay" onClick={closeDeleteConfirm}>
            <div
              className="delete-modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <h3>Delete action?</h3>
              <p>
                This action cannot be undone. The action history entry will be
                permanently removed.
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
                  onClick={handleConfirmDeleteAction}
                  disabled={!!deletingId}
                >
                  {deletingId ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
