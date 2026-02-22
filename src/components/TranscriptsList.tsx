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
    <div className="transcripts-page">
      <h2 className="transcripts-page-title">
        Transcripts{" "}
        {total > 0 && (
          <span className="transcripts-page-title-count">({total})</span>
        )}
      </h2>

      {!showContent && (
        <div className="transcripts-empty-wrap">Loading...</div>
      )}

      {showLogin && showContent && (
        <div className="transcripts-login-wrap">
          <p className="permission-text">
            Sign in to view your transcription history
          </p>
          <GoogleLoginButton
            onSuccess={() => { }}
            onError={() => {}}
          />
        </div>
      )}

      {showContent && !showLogin && loading && transcripts.length === 0 && (
        <div className="loading-state transcripts-loading-inline">
          <div className="loading-spinner" />
        </div>
      )}

      {showContent && !showLogin && !loading && transcripts.length === 0 && (
        <div className="transcripts-empty-wrap">
          <p>No transcripts yet.</p>
          <p className="transcripts-empty-sub">
            Start recording to create your first transcript!
          </p>
        </div>
      )}

      {showContent && !showLogin && transcripts.length > 0 && (
        <div className="transcripts-list transcripts-table transcripts-list-wrapper">
          {loading && page === 1 && (
            <div className="transcripts-loading-overlay">
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
                      <div className="transcript-display-cell">
                        {/* Minimal Audio Player */}
                        {transcript.audio_file_url && (
                          <div className="transcript-audio-cell">
                            <button
                              type="button"
                              onClick={() => handlePlayAudio(transcript.id, transcript.audio_file_url as string)}
                              className={`transcript-play-btn ${isPlaying ? "playing" : ""}`}
                              title={isPlaying ? "Pause" : "Play audio"}
                            >
                              {isPlaying && (
                                <svg className="transcript-progress-ring" aria-hidden>
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
                                <Play size={12} fill="currentColor" className="icon-play-offset" />
                              )}
                            </button>
                          </div>
                        )}

                        {/* Transcript Text */}
                        <div className="transcript-text-cell">
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
                  <div className="transcript-actions-cell">
                    {(() => {
                      const isEnhanced =
                        transcript.is_enhanced && !!transcript.enhanced_text;
                      const copyText =
                        isEnhanced && transcript.enhanced_text
                          ? transcript.enhanced_text
                          : transcript.original_text || "";
                      return copyText ? (
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyToClipboard(copyText, transcript.id)
                          }
                          className={`transcript-action-btn transcript-action-btn--copy ${copiedId === transcript.id ? "copied" : ""}`}
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
                    <button
                      type="button"
                      onClick={() => openDeleteConfirm(transcript.id)}
                      disabled={!!deletingId}
                      className="transcript-action-btn transcript-action-btn--delete"
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
            <div className="transcripts-load-more">
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
