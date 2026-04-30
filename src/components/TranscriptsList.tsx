/**
 * TranscriptsList Component
 *
 * Displays a list of transcripts fetched from the backend API.
 * Requires authentication to view transcripts.
 */

import React, { useCallback, useEffect, useState, useRef, useId } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Copy, Check, Trash2, AudioLines, Info } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { KEY_SYMBOLS } from "../lib/keySymbols";
import type { Transcript, TauriAppConfig } from "../types";
import { formatDateRelative } from "../lib/dateUtils";
import { useAuthStore } from "../store/authStore";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";
import { useToast } from "./toast/useToast";
import { ScreenSkeleton } from "./ui/ScreenSkeleton";
import "./home/home.css";
import "../styles/components/hotkey-selector.css";

const TRANSCRIPTION_HELP =
  "Press and hold your configured hotkey in any app while you speak. Release to stop—text is inserted at the cursor and saved here. Copy or delete entries from the list below.";

function renderTranscriptsHeaderKeyCap(
  key: string,
  keyIndex: number,
  totalKeys: number,
) {
  const keyName = key.trim().toLowerCase();
  const keyInfo = KEY_SYMBOLS[keyName];
  return (
    <span key={`${keyIndex}-${key}`} className="hotkey-selector__key-row">
      <span className="hotkey-selector__key-cap">
        {keyInfo ? (
          <span className="hotkey-selector__key-symbol">{keyInfo.symbol}</span>
        ) : null}
        <span className="hotkey-selector__key-label">
          {keyInfo ? keyInfo.label : key.trim()}
        </span>
      </span>
      {keyIndex < totalKeys - 1 ? (
        <span className="hotkey-selector__plus">+</span>
      ) : null}
    </span>
  );
}

function TranscriptsPageHeading() {
  const tooltipId = useId();
  return (
    <h2 className="transcripts-page-title transcripts-page-title--with-icon">
      <AudioLines
        className="transcripts-page-title__icon"
        size={22}
        strokeWidth={2}
        aria-hidden
      />
      Transcripts
      <span className="transcripts-page-tooltip-wrap transcripts-page-heading__tooltip-wrap">
        <button
          type="button"
          className="transcripts-page-tooltip-trigger transcripts-page-heading__tooltip-trigger"
          aria-label="How transcription works"
          aria-describedby={tooltipId}
        >
          <Info size={14} strokeWidth={2} aria-hidden />
        </button>
        <span
          id={tooltipId}
          className="transcripts-page-tooltip transcripts-page-heading__tooltip"
          role="tooltip"
        >
          {TRANSCRIPTION_HELP}
        </span>
      </span>
    </h2>
  );
}

function TranscriptsPageHeader({
  transcriptionHotkeys,
  onOpenHotkeysSettings,
}: {
  transcriptionHotkeys: string[];
  onOpenHotkeysSettings?: () => void;
}) {
  return (
    <div className="transcripts-page__header">
      <TranscriptsPageHeading />
      {transcriptionHotkeys.length > 0 ? (
        <button
          type="button"
          className="transcripts-page-header__hotkeys-btn transcripts-page-header__hotkeys hotkey-selector__chips"
          onClick={onOpenHotkeysSettings}
          aria-label="Open Settings — Hotkeys to change transcription shortcuts"
        >
          {transcriptionHotkeys.map((hotkey, index) => {
            const keys = hotkey.split("+");
            return (
              <div
                key={`transcripts-header-hotkey-${index}-${hotkey}`}
                className="hotkey-selector__chip-wrapper"
              >
                <div className="hotkey-selector__chip">
                  {keys.map((k, keyIndex) =>
                    renderTranscriptsHeaderKeyCap(k, keyIndex, keys.length),
                  )}
                </div>
              </div>
            );
          })}
        </button>
      ) : null}
    </div>
  );
}

type TranscriptsListProps = {
  onOpenHotkeysSettings?: () => void;
};

export const TranscriptsList: React.FC<TranscriptsListProps> = ({
  onOpenHotkeysSettings,
}) => {
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

  // App icons for the App column (macOS: data URLs from get_app_icon)
  const [appIcons, setAppIcons] = useState<Record<string, string | null>>({});
  const appIconsRequestedRef = useRef<Set<string>>(new Set());
  const [transcriptionHotkeys, setTranscriptionHotkeys] = useState<string[]>(
    [],
  );

  const refreshTranscripts = useCallback(async () => {
    if (!authStore.isInitialized || !authStore.isAuthenticated) return;
    setLoading(true);
    try {
      const response = await invoke<{
        transcripts: Transcript[];
        total: number;
        page: number;
        page_size: number;
        total_pages: number;
      }>("get_transcripts", { page: 1, pageSize: 10 });
      setTranscripts(response.transcripts);
      setTotalPages(response.total_pages);
      setTotal(response.total);
      setPage(1);
    } catch (err: any) {
      console.error("Failed to refresh transcripts:", err);
      toast.error(err?.message || "Failed to refresh transcripts");
    } finally {
      setLoading(false);
    }
  }, [authStore.isAuthenticated, authStore.isInitialized, toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await invoke<TauriAppConfig>("get_app_config");
        if (cancelled) return;
        const list = (cfg.hotkeys ?? []).filter(Boolean).slice(0, 3);
        setTranscriptionHotkeys(list);
      } catch (e) {
        console.warn("Failed to load transcription hotkeys:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (!authStore.isAuthenticated) {
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
        if (authStore.isInitialized && authStore.isAuthenticated) {
          toast.error(err?.message || "Failed to load transcripts");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authStore.isInitialized, authStore.isAuthenticated, page]);

  // Live-update: when a transcription completes in the background, refresh this list.
  useEffect(() => {
    if (!authStore.isInitialized || !authStore.isAuthenticated) return;
    let mounted = true;
    const unlistens: Array<() => void> = [];
    (async () => {
      try {
        const unlistenSuccess = await listen("transcription_success", () => {
          if (!mounted) return;
          void refreshTranscripts();
        });
        if (mounted) unlistens.push(unlistenSuccess);
        else unlistenSuccess();
      } catch (e) {
        console.warn("Failed to subscribe to transcription_success:", e);
      }
    })();
    return () => {
      mounted = false;
      unlistens.forEach((fn) => fn());
    };
  }, [authStore.isAuthenticated, authStore.isInitialized, refreshTranscripts]);

  // Safety net: when the window is focused again, refresh page 1 once.
  useEffect(() => {
    if (!authStore.isInitialized || !authStore.isAuthenticated) return;
    const onFocus = () => {
      void refreshTranscripts();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [authStore.isAuthenticated, authStore.isInitialized, refreshTranscripts]);

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

  // Same as HomePage: always show the page shell; show loading/login/content inside (no full-page gate)
  const showContent = authStore.isInitialized;
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
      <TranscriptsPageHeader
        transcriptionHotkeys={transcriptionHotkeys}
        onOpenHotkeysSettings={onOpenHotkeysSettings}
      />
      {loading ? (
        <p className="app-page-subtitle">
          <span
            className="skeleton-block app-page-subtitle-skeleton"
            style={{ width: 190, height: 12, borderRadius: 10 }}
          />
        </p>
      ) : total > 0 ? (
        <p className="app-page-subtitle">
          {total} voice {total === 1 ? "transcription" : "transcriptions"}
        </p>
      ) : null}

      {!showContent && (
        <div className="transcripts-page__init-skeleton">
          <ScreenSkeleton variant="transcripts" className="page__empty" />
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

          {showContent &&
            !showLogin &&
            !loading &&
            transcripts.length === 0 && (
              <motion.div
                key="transcripts-empty"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
              >
                <div className="transcripts-empty-wrap">
                  <div className="transcripts-empty-icon">
                    <AudioLines size={28} strokeWidth={1.5} />
                  </div>
                  <p className="transcripts-empty-title">
                    No transcriptions yet
                  </p>
                  <p className="transcripts-empty-sub">
                    Press and hold your hotkey while speaking — your
                    transcriptions will appear here.
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
                  ? (appIcons[appName] ?? undefined)
                  : undefined;

                const isEnhanced =
                  transcript.is_enhanced && !!transcript.enhanced_text;
                const displayText = isEnhanced
                  ? transcript.enhanced_text!
                  : transcript.original_text || "";
                const hasText = !!displayText;

                const copyText =
                  isEnhanced && transcript.enhanced_text
                    ? transcript.enhanced_text
                    : transcript.original_text || "";

                const wordCount = isEnhanced
                  ? transcript.enhanced_text_word_count
                  : transcript.original_text_word_count;

                return (
                  <motion.div
                    ref={isLastElement ? lastElementRef : undefined}
                    key={transcript.id}
                    className="transcript-card"
                    variants={CARD_VARIANTS}
                  >
                    {/* Hover-reveal actions — top-right */}
                    <div className="transcript-card__actions">
                      {copyText ? (
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyToClipboard(copyText, transcript.id)
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
                            <Check size={14} strokeWidth={2.5} />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => openDeleteConfirm(transcript.id)}
                        disabled={!!deletingId}
                        className="transcript-action-btn transcript-action-btn--delete"
                        title="Delete transcript"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Text — the hero */}
                    <div className="transcript-card__text">
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

                    {/* Metadata footer */}
                    <div className="transcript-card__footer">
                      <span className="transcript-card__date">
                        {formatDateRelative(transcript.created_at)}
                      </span>
                      <span className="transcript-card__dot" />
                      <span className="transcript-card__app">
                        {iconUrl ? (
                          <img
                            src={iconUrl}
                            alt=""
                            className="transcript-card__app-icon"
                            title={appName || undefined}
                          />
                        ) : null}
                        <span className="transcript-card__app-name">
                          {appName || "Unknown"}
                        </span>
                      </span>
                      {wordCount ? (
                        <>
                          <span className="transcript-card__dot" />
                          <span className="transcript-card__words">
                            {wordCount} {wordCount === 1 ? "word" : "words"}
                          </span>
                        </>
                      ) : null}
                      {isEnhanced ? (
                        <>
                          <span className="transcript-card__dot" />
                          <span className="transcript-card__enhanced-badge">
                            Enhanced
                          </span>
                        </>
                      ) : null}
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
