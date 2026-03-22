import React, { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, Pause, Trash2 } from "lucide-react";
import type { PaginatedActionHistoryResponse, AppConfig } from "../types";
import { formatDateTime } from "../lib/dateUtils";
import { KEY_SYMBOLS } from "../lib/keySymbols";
import { useAuthStore } from "../store/authStore";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";
import { useToast } from "./toast/useToast";
import "../styles/components/hotkey-selector.css";
import { ScreenSkeleton } from "./ui/ScreenSkeleton";
import "./home/home.css";

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
      <div
        style={{
          padding: "2rem 2.5rem",
          background: "#ffffff",
          minHeight: "100vh",
          fontFamily: "var(--lexi-font-body)",
        }}
      >
        <h2
          style={{
            margin: 0,
            marginBottom: "2rem",
            fontSize: "24px",
            fontWeight: 600,
            color: "#111827",
            letterSpacing: "-0.025em",
          }}
        >
          Actions
        </h2>
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <p
            style={{
              fontSize: "0.875rem",
              color: "#6b7280",
              marginBottom: "16px",
            }}
          >
            Sign in to access your actions
          </p>
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
    <div
      style={{
        padding: "2rem 2.5rem",
        background: "#ffffff",
        minHeight: "100vh",
        fontFamily: "var(--lexi-font-body)",
      }}
    >
      <h2
        style={{
          margin: 0,
          marginBottom: "2rem",
          fontSize: "24px",
          fontWeight: 600,
          color: "#111827",
          letterSpacing: "-0.025em",
        }}
      >
        Actions
      </h2>

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
        <h3
          style={{
            margin: 0,
            marginBottom: "1.5rem",
            fontSize: "18px",
            fontWeight: 500,
            color: "#111827",
          }}
        >
          Action History
        </h3>

        {isLoading ? (
          <ScreenSkeleton variant="actionsHistory" />
        ) : !actionHistory || actionHistory.actions.length === 0 ? (
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
            No action history yet. Actions will appear here as you use them.
          </div>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              {actionHistory.actions.map((action) => (
                <div
                  key={action.id}
                  style={{
                    padding: "1.25rem",
                    backgroundColor: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.75rem",
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
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: "0.75rem",
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
                        {action.action_command}
                      </div>
                      {action.app_name && (
                        <div
                          style={{
                            fontSize: "0.8125rem",
                            color: "#6b7280",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                          }}
                        >
                          <span
                            style={{
                              width: "6px",
                              height: "6px",
                              borderRadius: "50%",
                              backgroundColor: "#e5e7eb",
                            }}
                          />
                          Context: {action.app_name}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => openDeleteConfirm(action.id)}
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
                        marginLeft: "1rem",
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
                      title="Delete action"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {action.selected_text && (
                    <div
                      style={{
                        marginTop: "0.5rem",
                        paddingTop: "0.5rem",
                        borderTop: "1px solid #f3f4f6",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "#9ca3af",
                          fontWeight: 500,
                          marginBottom: "0.25rem",
                          textTransform: "uppercase",
                          letterSpacing: "0.025em",
                        }}
                      >
                        Input
                      </div>
                      <div
                        style={{
                          fontSize: "0.8125rem",
                          color: "#4b5563",
                          lineHeight: 1.5,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          display: "-webkit-box",
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: "vertical" as const,
                        }}
                      >
                        {action.selected_text}
                      </div>
                    </div>
                  )}

                  {/* Text action: show output value. Voice action: show output value + audio player (transcripts-style) */}
                  {(action.output_value || action.output_audio_file_url) && (
                    <div
                      style={{
                        marginTop: "0.75rem",
                        paddingTop: "0.75rem",
                        borderTop: "1px solid #f3f4f6",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "10px",
                      }}
                    >
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
                            style={{
                              width: "28px",
                              height: "28px",
                              borderRadius: "50%",
                              border: "none",
                              background:
                                playingId === action.id ? "#1a1a1a" : "#f3f4f6",
                              color:
                                playingId === action.id ? "#fff" : "#6b7280",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                              transition: "all 0.2s ease",
                              position: "relative",
                              overflow: "hidden",
                            }}
                            onMouseEnter={(e) => {
                              if (playingId !== action.id) {
                                e.currentTarget.style.background = "#e5e7eb";
                                e.currentTarget.style.color = "#374151";
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (playingId !== action.id) {
                                e.currentTarget.style.background = "#f3f4f6";
                                e.currentTarget.style.color = "#6b7280";
                              }
                            }}
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
                                  stroke="#fff"
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
                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: "0.8125rem",
                            color: "#4b5563",
                            lineHeight: 1.5,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            display: "-webkit-box",
                            WebkitLineClamp: 4,
                            WebkitBoxOrient: "vertical" as const,
                          }}
                        >
                          {action.output_value}
                        </div>
                      )}
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      fontSize: "0.75rem",
                      color: "#9ca3af",
                      borderTop: "1px solid #f3f4f6",
                      paddingTop: "0.75rem",
                      marginTop: "0.75rem",
                    }}
                  >
                    <span>{formatDateTime(action.created_at)}</span>
                    <span>•</span>
                    <span style={{ textTransform: "capitalize" }}>
                      {action.action_type.replace("_", " ")}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {actionHistory.total_pages > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: "0.5rem",
                  marginTop: "2rem",
                }}
              >
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.875rem",
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.5rem",
                    background: page === 1 ? "#f3f4f6" : "#ffffff",
                    color: page === 1 ? "#9ca3af" : "#374151",
                    cursor: page === 1 ? "not-allowed" : "pointer",
                  }}
                >
                  Previous
                </button>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "0 1rem",
                    fontSize: "0.875rem",
                    color: "#6b7280",
                  }}
                >
                  Page {page} of {actionHistory.total_pages}
                </div>
                <button
                  onClick={() =>
                    setPage((p) => Math.min(actionHistory.total_pages, p + 1))
                  }
                  disabled={page === actionHistory.total_pages}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.875rem",
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.5rem",
                    background:
                      page === actionHistory.total_pages
                        ? "#f3f4f6"
                        : "#ffffff",
                    color:
                      page === actionHistory.total_pages
                        ? "#9ca3af"
                        : "#374151",
                    cursor:
                      page === actionHistory.total_pages
                        ? "not-allowed"
                        : "pointer",
                  }}
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
