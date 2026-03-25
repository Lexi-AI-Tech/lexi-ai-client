/**
 * TranscriptsList Component
 *
 * Displays a list of transcripts fetched from the backend API.
 * Requires authentication to view transcripts.
 */

import React, { useCallback, useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, Check, Trash2, Play, Pause } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { Transcript } from "../types";
import { formatDateRelative } from "../lib/dateUtils";
import { useAuthStore } from "../store/authStore";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";
import { useToast } from "./toast/useToast";
import { ScreenSkeleton } from "./ui/ScreenSkeleton";
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

  // Audio playback state
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // App icons for the App column (macOS: data URLs from get_app_icon)
  const [appIcons, setAppIcons] = useState<Record<string, string | null>>({});
  const appIconsRequestedRef = useRef<Set<string>>(new Set());

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
    [loading, page, totalPages],
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
          page === 1
            ? response.transcripts
            : [...prev, ...response.transcripts],
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

  // Fetch app icons for unique focused_app names (macOS only; Tauri returns data URL or null)
  useEffect(() => {
    transcripts.forEach((t) => {
      const name = (t.focused_app || "").trim();
      if (!name || appIconsRequestedRef.current.has(name)) return;
      appIconsRequestedRef.current.add(name);
      invoke<string | null>("get_app_icon", { appName: name })
        .then((url) => {
          setAppIcons((prev) => ({ ...prev, [name]: url ?? null }));
        })
        .catch(() => {
          setAppIcons((prev) => ({ ...prev, [name]: null }));
        });
    });
  }, [transcripts]);

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
    setPlayingId(transcriptId);
    setAudioProgress(0);
  };

  // Same as HomePage: always show the page shell; show loading/login/content inside (no full-page gate)
  const showContent =
    authStore.isInitialized &&
    (!authStore.isAuthenticated || !!authStore.tokens?.access_token);
  const showLogin = authStore.isInitialized && !authStore.isAuthenticated;

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

  return (
    <div className="transcripts-page">
      <h2 className="transcripts-page-title">Transcripts</h2>
      {loading ? (
        <p className="app-page-subtitle">Loading…</p>
      ) : total > 0 ? (
        <p className="app-page-subtitle">
          {total} voice {total === 1 ? "transcription" : "transcriptions"}
        </p>
      ) : null}

      {!showContent && (
        <div className="transcripts-page">
          <h2 className="transcripts-page-title">Transcripts</h2>
          <ScreenSkeleton
            variant="transcripts"
            className="page__empty"
          />
        </div>
      )}

      {showLogin && showContent && (
        <div className="transcripts-login-wrap">
          <p className="permission-text">
            Sign in to view your transcription history
          </p>
          <GoogleLoginButton onSuccess={() => {}} onError={() => {}} />
        </div>
      )}

      <div className="transcripts-page__content">
        <AnimatePresence mode="wait">
          {showContent && !showLogin && loading && transcripts.length === 0 && (
            <motion.div
              key="transcripts-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <ScreenSkeleton
                variant="transcripts"
                className="transcripts-loading-inline"
              />
            </motion.div>
          )}

          {showContent && !showLogin && !loading && transcripts.length === 0 && (
            <motion.div
              key="transcripts-empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <div className="transcripts-empty-wrap">
                <p>No transcripts yet.</p>
                <p className="transcripts-empty-sub">
                  Start recording to create your first transcript!
                </p>
              </div>
            </motion.div>
          )}

          {showContent && !showLogin && transcripts.length > 0 && (
            <motion.div
              key="transcripts-cards"
              className="transcripts-cards"
              variants={GRID_VARIANTS}
              initial="hidden"
              animate="visible"
            >
              {transcripts.map((transcript, index) => {
                const isLastElement = index === transcripts.length - 1;
                const appName = (transcript.focused_app || "").trim();
                const iconUrl = appName
                  ? appIcons[appName] ?? undefined
                  : undefined;

                const isEnhanced =
                  transcript.is_enhanced && !!transcript.enhanced_text;
                const displayText = isEnhanced
                  ? transcript.enhanced_text!
                  : transcript.original_text || "";
                const hasText = !!displayText;
                const isPlaying = playingId === transcript.id;

                const copyText =
                  isEnhanced && transcript.enhanced_text
                    ? transcript.enhanced_text
                    : transcript.original_text || "";

                return (
                  <motion.div
                    ref={isLastElement ? lastElementRef : undefined}
                    key={transcript.id}
                    className="transcript-card"
                    variants={CARD_VARIANTS}
                  >
                    <div className="transcript-card__header">
                      <div className="transcript-card__date">
                        {formatDateRelative(transcript.created_at)}
                      </div>
                      <div className="transcript-card__app">
                        <div className="transcript-cell-app__content">
                          {iconUrl ? (
                            <img
                              src={iconUrl}
                              alt=""
                              className="transcript-cell-app__icon"
                              title={appName || undefined}
                            />
                          ) : null}
                          <span className="transcript-cell-app__name">
                            {appName || "—"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="transcript-card__body">
                      <div className="transcript-card__row">
                        <div className="transcript-display-cell transcript-display-cell--card transcript-card__main">
                          {/* Minimal Audio Player */}
                          {transcript.audio_file_url && (
                            <div className="transcript-audio-cell">
                              <button
                                type="button"
                                onClick={() =>
                                  handlePlayAudio(
                                    transcript.id,
                                    transcript.audio_file_url as string,
                                  )
                                }
                                className={`transcript-play-btn ${
                                  isPlaying ? "playing" : ""
                                }`}
                                title={isPlaying ? "Pause" : "Play audio"}
                              >
                                {isPlaying && (
                                  <svg
                                    className="transcript-progress-ring"
                                    aria-hidden
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
                                  <Play
                                    size={12}
                                    fill="currentColor"
                                    className="icon-play-offset"
                                  />
                                )}
                              </button>
                            </div>
                          )}

                          {/* Transcript Text */}
                          <div className="transcript-text-cell">
                            {hasText ? (
                              <span className="transcript-item-text">
                                {displayText}
                              </span>
                            ) : (
                              <span className="transcript-item-empty">
                                {transcript.status === "processing"
                                  ? "Processing..."
                                  : "No text available"}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="transcript-card__actions">
                          <div className="transcript-actions-cell">
                            {copyText ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyToClipboard(
                                    copyText,
                                    transcript.id,
                                  )
                                }
                                className={`transcript-action-btn transcript-action-btn--copy ${
                                  copiedId === transcript.id ? "copied" : ""
                                }`}
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
                            ) : null}

                            <button
                              type="button"
                              onClick={() =>
                                openDeleteConfirm(transcript.id)
                              }
                              disabled={!!deletingId}
                              className="transcript-action-btn transcript-action-btn--delete"
                              title="Delete transcript"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {loading && page > 1 && (
        <div className="transcripts-load-more">
          <ScreenSkeleton variant="transcriptsRows" />
        </div>
      )}

      {deleteConfirmId && (
        <div className="delete-modal-overlay" onClick={closeDeleteConfirm}>
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
