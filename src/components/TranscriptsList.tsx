/**
 * TranscriptsList Component
 *
 * Displays a list of transcripts fetched from the backend API.
 * Requires authentication to view transcripts.
 */

import React, { useCallback, useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, Check, Trash2, Sparkles, Play, Pause } from "lucide-react";
import type { Transcript } from "../types";
import { formatDateRelative } from "../lib/dateUtils";
import { useAuthStore } from "../store/authStore";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";
import { useToast } from "./toast/useToast";
import "./home/home.css";

export const TranscriptsList: React.FC = () => {
  const authStore = useAuthStore();
  const toast = useToast();
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [originalTooltipId, setOriginalTooltipId] = useState<string | null>(null);

  // Audio playback state
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Infinite scrolling observer
  const observer = useRef<IntersectionObserver | null>(null);
  const lastElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loading) return;
      if (observer.current) observer.current.disconnect();

      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && page < totalPages) {
          setPage((prevPage) => prevPage + 1);
        }
      });

      if (node) observer.current.observe(node);
    },
    [loading, page, totalPages]
  );

  // Fetch transcripts when authenticated and page changes (same pattern as HomePage: single effect, no callback in deps to avoid double fetch)
  useEffect(() => {
    if (!authStore.isInitialized) return;
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      setTranscripts([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    let cancelled = false;
    (async () => {
      try {
        const response = await invoke<{
          transcripts: Transcript[];
          total: number;
          page: number;
          page_size: number;
          total_pages: number;
        }>("get_transcripts", { page, pageSize: 10 });

        if (cancelled) return;
        setTranscripts((prev) =>
          page === 1 ? response.transcripts : [...prev, ...response.transcripts]
        );
        setTotalPages(response.total_pages);
        setTotal(response.total);
      } catch (err: any) {
        if (cancelled) return;
        console.error("Failed to fetch transcripts:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authStore.isInitialized,
    authStore.isAuthenticated,
    authStore.tokens?.access_token,
    page,
  ]);

  const openDeleteConfirm = (transcriptId: string) => {
    setDeleteConfirmId(transcriptId);
  };

  const closeDeleteConfirm = () => {
    if (!deletingId) setDeleteConfirmId(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmId) return;

    setDeletingId(deleteConfirmId);
    try {
      await invoke("delete_transcript", { transcriptId: deleteConfirmId });
      setDeleteConfirmId(null);
      setTranscripts((prev) => prev.filter((t) => t.id !== deleteConfirmId));
      setTotal((prev) => Math.max(0, prev - 1));
      toast.success("Transcript deleted");
    } catch (err: any) {
      console.error("Failed to delete transcript:", err);
      toast.error(err.message || "Failed to delete transcript");
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopyToClipboard = async (text: string, transcriptId: string) => {
    try {
      await invoke("copy_to_clipboard", { text });
      setCopiedId(transcriptId);
      setTimeout(() => setCopiedId(null), 250);
      toast.success("Copied to clipboard");
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      toast.error("Failed to copy to clipboard");
    }
  };

  // Audio playback handlers
  const handlePlayAudio = (transcriptId: string, audioUrl: string) => {
    // If same audio is playing, pause it
    if (playingId === transcriptId && audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
      return;
    }

    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
    }

    // Create new audio element
    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    audio.addEventListener('timeupdate', () => {
      if (audio.duration) {
        setAudioProgress((audio.currentTime / audio.duration) * 100);
      }
    });

    audio.addEventListener('ended', () => {
      setPlayingId(null);
      setAudioProgress(0);
    });

    audio.play();
    setPlayingId(transcriptId);
    setAudioProgress(0);
  };

  // Same as HomePage: always show the page shell; show loading/login/content inside (no full-page gate)
  const showContent =
    authStore.isInitialized &&
    (!authStore.isAuthenticated || !!authStore.tokens?.access_token);
  const showLogin =
    authStore.isInitialized && !authStore.isAuthenticated;

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
        Transcripts{" "}
        {total > 0 && (
          <span
            style={{ fontSize: "14px", fontWeight: "normal", color: "#6b7280" }}
          >
            ({total})
          </span>
        )}
      </h2>

      {!showContent && (
        <div
          style={{
            textAlign: "center",
            padding: "24px",
            color: "#6b7280",
          }}
        >
          Loading...
        </div>
      )}

      {showLogin && showContent && (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <p className="permission-text" style={{ marginBottom: "16px" }}>
            Sign in to view your transcription history
          </p>
          <GoogleLoginButton
            onSuccess={() => { }}
            onError={() => {}}
          />
        </div>
      )}

      {showContent && !showLogin && loading && transcripts.length === 0 && (
        <div
          className="loading-state"
          style={{
            width: "100%",
            flex: 1,
            justifyContent: "center",
          }}
        >
          <div className="loading-spinner" />
        </div>
      )}

      {showContent && !showLogin && !loading && transcripts.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "24px",
            color: "#6b7280",
          }}
        >
          <p>No transcripts yet.</p>
          <p style={{ fontSize: "11px", marginTop: "8px", opacity: 0.7 }}>
            Start recording to create your first transcript!
          </p>
        </div>
      )}

      {showContent && !showLogin && transcripts.length > 0 && (
        <div className="transcripts-list transcripts-table" style={{ position: "relative" }}>
          {loading && page === 1 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(255, 255, 255, 0.7)",
                borderRadius: "8px",
                zIndex: 10,
              }}
            >
              <div className="loading-spinner" />
            </div>
          )}
          <div className="transcripts-table-header">
            <span>Date</span>
            <span>Transcript</span>
            <span>Actions</span>
          </div>
          {transcripts.map((transcript, index) => {
            const isLastElement = index === transcripts.length - 1;
            return (
              <div
                ref={isLastElement ? lastElementRef : null}
                key={transcript.id}
                className="transcript-item transcripts-table-row"
              >
                <div className="transcript-cell transcript-cell-date">
                  {formatDateRelative(transcript.created_at)}
                </div>
                <div className="transcript-cell transcript-cell-text">
                  {(() => {
                    const isEnhanced =
                      transcript.is_enhanced && !!transcript.enhanced_text;
                    const displayText = isEnhanced
                      ? transcript.enhanced_text!
                      : transcript.original_text || "";
                    const hasText = !!displayText;
                    const isPlaying = playingId === transcript.id;

                    return (
                      <div className="transcript-display-cell" style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                        {/* Minimal Audio Player */}
                        {transcript.audio_file_url && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              flexShrink: 0,
                            }}
                          >
                            <button
                              onClick={() => handlePlayAudio(transcript.id, transcript.audio_file_url as string)}
                              style={{
                                width: "28px",
                                height: "28px",
                                borderRadius: "50%",
                                border: "none",
                                background: isPlaying
                                  ? "#1a1a1a"
                                  : "#f3f4f6",
                                color: isPlaying ? "#fff" : "#6b7280",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                transition: "all 0.2s ease",
                                position: "relative",
                                overflow: "hidden",
                              }}
                              onMouseEnter={(e) => {
                                if (!isPlaying) {
                                  e.currentTarget.style.background = "#e5e7eb";
                                  e.currentTarget.style.color = "#374151";
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!isPlaying) {
                                  e.currentTarget.style.background = "#f3f4f6";
                                  e.currentTarget.style.color = "#6b7280";
                                }
                              }}
                              title={isPlaying ? "Pause" : "Play audio"}
                            >
                              {/* Progress ring when playing */}
                              {isPlaying && (
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
                              {isPlaying ? (
                                <Pause size={12} fill="currentColor" />
                              ) : (
                                <Play size={12} fill="currentColor" style={{ marginLeft: "2px" }} />
                              )}
                            </button>
                          </div>
                        )}

                        {/* Transcript Text */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {hasText ? (
                            <>
                              <span className="transcript-item-text">
                                {displayText}
                              </span>
                              {isEnhanced && (
                                <div className="transcript-enhanced-badges">
                                  <span
                                    className="transcript-enhanced-badge"
                                    title="This is an enhanced version of the transcript (improved grammar and clarity)"
                                  >
                                    <Sparkles size={12} />
                                    Enhanced
                                  </span>
                                  <span
                                    className="transcript-view-original-trigger"
                                    onMouseEnter={() =>
                                      setOriginalTooltipId(transcript.id)
                                    }
                                    onMouseLeave={() =>
                                      setOriginalTooltipId(null)
                                    }
                                  >
                                    View original
                                    {originalTooltipId === transcript.id && (
                                      <div
                                        className="transcript-original-tooltip"
                                        onMouseEnter={() =>
                                          setOriginalTooltipId(transcript.id)
                                        }
                                        onMouseLeave={() =>
                                          setOriginalTooltipId(null)
                                        }
                                      >
                                        <div className="transcript-original-tooltip-label">
                                          Original transcription
                                        </div>
                                        <div className="transcript-original-tooltip-text">
                                          {transcript.original_text}
                                        </div>
                                      </div>
                                    )}
                                  </span>
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="transcript-item-empty">
                              {transcript.status === "processing"
                                ? "Processing..."
                                : "No text available"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className="transcript-cell transcript-cell-meta">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                    }}
                  >
                    {(() => {
                      const isEnhanced =
                        transcript.is_enhanced && !!transcript.enhanced_text;
                      const copyText =
                        isEnhanced && transcript.enhanced_text
                          ? transcript.enhanced_text
                          : transcript.original_text || "";
                      return copyText ? (
                        <button
                          onClick={() =>
                            handleCopyToClipboard(copyText, transcript.id)
                          }
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "32px",
                            height: "32px",
                            padding: 0,
                            background:
                              copiedId === transcript.id ? "#dcfce7" : "#ffffff",
                            border:
                              copiedId === transcript.id
                                ? "1px solid #22c55e"
                                : "1px solid #e5e7eb",
                            borderRadius: "0.5rem",
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                            color:
                              copiedId === transcript.id ? "#16a34a" : "#6b7280",
                          }}
                          onMouseEnter={(e) => {
                            if (copiedId !== transcript.id) {
                              e.currentTarget.style.background = "#f9fafb";
                              e.currentTarget.style.borderColor = "#d1d5db";
                              e.currentTarget.style.color = "#111827";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (copiedId !== transcript.id) {
                              e.currentTarget.style.background = "#ffffff";
                              e.currentTarget.style.borderColor = "#e5e7eb";
                              e.currentTarget.style.color = "#6b7280";
                            }
                          }}
                          title={
                            copiedId === transcript.id
                              ? "Copied!"
                              : "Copy transcript"
                          }
                        >
                          {copiedId === transcript.id ? (
                            <Check size={16} strokeWidth={2.5} />
                          ) : (
                            <Copy size={16} />
                          )}
                        </button>
                      ) : null;
                    })()}
                    {/* <button
                    onClick={() => {
                      // Regenerate action - placeholder for now
                      console.log(
                        "Regenerate clicked for transcript:",
                        transcript.id,
                      );
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "32px",
                      height: "32px",
                      padding: 0,
                      background: "#ffffff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "0.5rem",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      color: "#6b7280",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#f9fafb";
                      e.currentTarget.style.borderColor = "#d1d5db";
                      e.currentTarget.style.color = "#111827";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "#ffffff";
                      e.currentTarget.style.borderColor = "#e5e7eb";
                      e.currentTarget.style.color = "#6b7280";
                    }}
                    title="Regenerate transcript"
                  >
                    <RefreshCw size={16} />
                  </button> */}
                    <button
                      onClick={() => openDeleteConfirm(transcript.id)}
                      disabled={!!deletingId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "32px",
                        height: "32px",
                        padding: 0,
                        background: "#ffffff",
                        border: "1px solid #e5e7eb",
                        borderRadius: "0.5rem",
                        cursor: deletingId ? "not-allowed" : "pointer",
                        transition: "all 0.2s ease",
                        color: "#6b7280",
                        opacity: deletingId ? 0.6 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (!deletingId) {
                          e.currentTarget.style.background = "#fef2f2";
                          e.currentTarget.style.borderColor = "#fecaca";
                          e.currentTarget.style.color = "#dc2626";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!deletingId) {
                          e.currentTarget.style.background = "#ffffff";
                          e.currentTarget.style.borderColor = "#e5e7eb";
                          e.currentTarget.style.color = "#6b7280";
                        }
                      }}
                      title="Delete transcript"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {loading && page > 1 && (
            <div style={{ padding: "16px", display: "flex", justifyContent: "center", width: "100%" }}>
              <div className="loading-spinner" />
            </div>
          )}
        </div>
      )}

      {deleteConfirmId && (
        <div
          className="delete-modal-overlay"
          onClick={closeDeleteConfirm}
        >
          <div
            className="delete-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Delete transcript?</h3>
            <p>
              This action cannot be undone. The transcript will be permanently
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
                onClick={handleConfirmDelete}
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
