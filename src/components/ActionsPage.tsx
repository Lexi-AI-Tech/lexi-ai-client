import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, Pause, Trash2, Copy, Check, Atom, Info } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { KEY_SYMBOLS } from "../lib/keySymbols";
import type {
  ActionHistory,
  PaginatedActionHistoryResponse,
  TauriAppConfig,
} from "../types";
import { formatDateRelative } from "../lib/dateUtils";
import { useAuthStore } from "../store/authStore";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";
import { useToast } from "./toast/useToast";
import {
  isAuthErrorFromUnknown,
  isUsageQuotaExceededError,
} from "../utils/userFacingApiError";
import { ScreenSkeleton } from "./ui/ScreenSkeleton";
import "./home/home.css";
import "./actions/actions.css";
import "../styles/components/hotkey-selector.css";

const ACTIONS_HELP =
  "Hold your Action hotkey (configure it in Settings) and speak your command. With text selected in the active app, Lexi uses that selection as context—rewrite, summarize, or build on it. With nothing selected, you get a fresh generation from scratch. Output is pasted at the cursor and saved in this list.";

function renderHeadingKeyCap(key: string, keyIndex: number, totalKeys: number) {
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

function ActionsPageHeading() {
  const tooltipId = useId();
  return (
    <h2 className="transcripts-page-title transcripts-page-title--with-icon">
      <Atom
        className="transcripts-page-title__icon"
        size={22}
        strokeWidth={2}
        aria-hidden
      />
      Actions
      <span className="transcripts-page-tooltip-wrap actions-page-heading__tooltip-wrap">
        <button
          type="button"
          className="transcripts-page-tooltip-trigger actions-page-heading__tooltip-trigger"
          aria-label="How actions work"
          aria-describedby={tooltipId}
        >
          <Info size={14} strokeWidth={2} aria-hidden />
        </button>
        <span
          id={tooltipId}
          className="transcripts-page-tooltip actions-page-heading__tooltip"
          role="tooltip"
        >
          {ACTIONS_HELP}
        </span>
      </span>
    </h2>
  );
}

function ActionsPageHeader({ actionHotkeys }: { actionHotkeys: string[] }) {
  return (
    <div className="actions-page__header">
      <ActionsPageHeading />
      {actionHotkeys.length > 0 ? (
        <div
          className="actions-page-header__hotkeys hotkey-selector__chips"
          aria-label={`Action hotkeys: ${actionHotkeys.join(", ")}`}
        >
          {actionHotkeys.map((hotkey, index) => {
            const keys = hotkey.split("+");
            return (
              <div
                key={`header-hotkey-${index}-${hotkey}`}
                className="hotkey-selector__chip-wrapper"
              >
                <div className="hotkey-selector__chip">
                  {keys.map((k, keyIndex) =>
                    renderHeadingKeyCap(k, keyIndex, keys.length),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export const ActionsPage: React.FC = () => {
  const authStore = useAuthStore();
  const toast = useToast();
  const [actions, setActions] = useState<ActionHistory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedOutputId, setCopiedOutputId] = useState<string | null>(null);
  const [appIcons, setAppIcons] = useState<Record<string, string | null>>({});
  const appIconsRequestedRef = useRef<Set<string>>(new Set());
  const observer = useRef<IntersectionObserver | null>(null);
  const [actionHotkeys, setActionHotkeys] = useState<string[]>([]);

  const pageSize = 20;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await invoke<TauriAppConfig>("get_app_config");
        if (cancelled) return;
        const list = (cfg.action_hotkeys ?? []).filter(Boolean).slice(0, 3);
        setActionHotkeys(list);
      } catch (e) {
        console.warn("Failed to load action hotkeys:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const lastElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isLoading) return;
      if (observer.current) observer.current.disconnect();

      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && page < totalPages) {
          setPage((prevPage) => prevPage + 1);
        }
      });

      if (node) observer.current.observe(node);
    },
    [isLoading, page, totalPages],
  );

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

  const openDeleteConfirm = (actionId: string) => {
    setDeleteConfirmId(actionId);
  };

  const closeDeleteConfirm = () => {
    if (!deletingId) setDeleteConfirmId(null);
  };

  const handleConfirmDeleteAction = async () => {
    if (!deleteConfirmId) return;

    setDeletingId(deleteConfirmId);
    try {
      await invoke("delete_action_history", { actionId: deleteConfirmId });
      setDeleteConfirmId(null);
      setActions((prev) => prev.filter((a) => a.id !== deleteConfirmId));
      setTotal((prev) => Math.max(0, prev - 1));
      toast.success("Action deleted");
    } catch (err: any) {
      const errorMessage = err?.message || "Failed to delete action";
      if (isUsageQuotaExceededError(errorMessage)) {
        toast.error(errorMessage);
        return;
      }
      if (isAuthErrorFromUnknown(err)) {
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

  useEffect(() => {
    if (!authStore.isInitialized) return;
    if (!authStore.isAuthenticated) {
      setActions([]);
      setIsLoading(false);
      setTotal(0);
      setTotalPages(1);
      setPage(1);
      return;
    }

    setIsLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const data = await invoke<PaginatedActionHistoryResponse>(
          "get_action_history",
          { page, pageSize },
        );
        if (cancelled) return;
        setActions((prev) =>
          page === 1 ? data.actions : [...prev, ...data.actions],
        );
        setTotalPages(data.total_pages);
        setTotal(data.total);
      } catch (err: any) {
        if (cancelled) return;
        console.error("Failed to load action history:", err);
        const errorMessage = err?.message || "Failed to load action history";
        if (isUsageQuotaExceededError(errorMessage)) {
          toast.error(errorMessage);
          return;
        }
        if (isAuthErrorFromUnknown(err)) {
          console.log("Auth error loading action history, clearing auth");
          authStore.clearAuth();
          setActions([]);
          setTotal(0);
          setTotalPages(1);
          setPage(1);
        } else {
          toast.error(errorMessage);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authStore.isInitialized, authStore.isAuthenticated, page]);

  useEffect(() => {
    if (!actions.length) return;
    actions.forEach((action) => {
      const name = (action.app_name || "").trim();
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
  }, [actions]);

  const handleCopyOutput = async (text: string, actionId: string) => {
    try {
      await invoke("copy_to_clipboard", { text });
      setCopiedOutputId(actionId);
      setTimeout(() => setCopiedOutputId(null), 250);
      toast.success("Copied to clipboard");
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      toast.error("Failed to copy to clipboard");
    }
  };

  // Show loading while waiting for auth to initialize
  if (!authStore.isInitialized) {
    return (
      <div className="actions-page">
        <ActionsPageHeader actionHotkeys={actionHotkeys} />
        <p className="app-page-subtitle">
          <span
            className="skeleton-block app-page-subtitle-skeleton"
            style={{ width: 160, height: 12, borderRadius: 10 }}
          />
        </p>
        <div className="actions-page__content">
          <ScreenSkeleton
            variant="actionsHistory"
            className="actions-loading-inline"
          />
        </div>
      </div>
    );
  }

  // Show login prompt if not authenticated
  if (!authStore.isAuthenticated) {
    return (
      <div className="actions-page">
        <ActionsPageHeader actionHotkeys={actionHotkeys} />
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

  const totalActions = total;

  return (
    <div className="actions-page">
      <ActionsPageHeader actionHotkeys={actionHotkeys} />
      {isLoading && actions.length === 0 ? (
        <p className="app-page-subtitle">
          <span
            className="skeleton-block app-page-subtitle-skeleton"
            style={{ width: 160, height: 12, borderRadius: 10 }}
          />
        </p>
      ) : totalActions > 0 ? (
        <p className="app-page-subtitle">
          {totalActions} {totalActions === 1 ? "action" : "actions"} performed
        </p>
      ) : null}

      <div className="actions-page__content">
        <AnimatePresence mode="wait">
          {isLoading && actions.length === 0 && (
            <motion.div
              key="actions-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <ScreenSkeleton
                variant="actionsHistory"
                className="actions-loading-inline"
              />
            </motion.div>
          )}

          {!isLoading && actions.length === 0 && (
            <motion.div
              key="actions-empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <div className="actions-empty-wrap">
                <div className="actions-empty-icon" aria-hidden>
                  <Atom size={36} strokeWidth={1.75} />
                </div>
                <p>No actions yet.</p>
                <p className="actions-empty-sub">
                  Voice actions you run will show up here.
                </p>
              </div>
            </motion.div>
          )}

          {actions.length > 0 && (
            <motion.div
              key="actions-cards"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="actions-history-block"
            >
              <motion.div
                className="actions-cards"
                variants={GRID_VARIANTS}
                initial="hidden"
                animate="visible"
              >
                {actions.map((action, index) => {
                  const appName = (action.app_name || "").trim();
                  const iconUrl = appName
                    ? (appIcons[appName] ?? undefined)
                    : undefined;
                  const isLastElement = index === actions.length - 1;

                  return (
                    <motion.div
                      ref={isLastElement ? lastElementRef : undefined}
                      key={action.id}
                      className="action-card"
                      variants={CARD_VARIANTS}
                    >
                      <div className="action-card__header">
                        <div className="transcript-card__meta">
                          <div className="transcript-card__date">
                            {formatDateRelative(action.created_at)}
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
                      </div>

                      <div className="action-card__top">
                        <div className="action-card__command-wrap">
                          <div className="action-card__command">
                            {action.action_command}
                          </div>
                        </div>
                        <div className="action-card__actions">
                          {action.output_value ? (
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyOutput(
                                  action.output_value!,
                                  action.id,
                                )
                              }
                              className={`transcript-action-btn transcript-action-btn--copy ${
                                copiedOutputId === action.id ? "copied" : ""
                              }`}
                              title={
                                copiedOutputId === action.id
                                  ? "Copied!"
                                  : "Copy result"
                              }
                            >
                              {copiedOutputId === action.id ? (
                                <Check size={16} strokeWidth={2.5} />
                              ) : (
                                <Copy size={16} />
                              )}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => openDeleteConfirm(action.id)}
                            disabled={!!deletingId}
                            className="action-delete-btn"
                            title="Delete action"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {(action.output_value ||
                        action.output_audio_file_url) && (
                        <div className="action-card__block action-card__block--output">
                          {action.output_audio_file_url ? (
                            <div className="action-card__audio-wrap">
                              <button
                                type="button"
                                onClick={() =>
                                  handlePlayActionAudio(
                                    action.id,
                                    action.output_audio_file_url!,
                                  )
                                }
                                className={`action-audio-btn ${playingId === action.id ? "action-audio-btn--playing" : ""}`}
                                title={
                                  playingId === action.id
                                    ? "Pause"
                                    : "Play audio"
                                }
                              >
                                {playingId === action.id && (
                                  <svg
                                    className="action-audio-btn__ring"
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
                                    className="icon-play-offset"
                                  />
                                )}
                              </button>
                            </div>
                          ) : null}
                          {action.output_value ? (
                            <div className="action-card__output-text">
                              {action.output_value}
                            </div>
                          ) : null}
                        </div>
                      )}

                      {action.selected_text ? (
                        <div className="action-card__block">
                          <div className="action-card__label">Context</div>
                          <div className="action-card__text action-card__text--clamp">
                            {action.selected_text}
                          </div>
                        </div>
                      ) : null}
                    </motion.div>
                  );
                })}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {isLoading && page > 1 && (
        <div className="transcripts-load-more">
          <ScreenSkeleton variant="actionsHistory" />
        </div>
      )}

      {deleteConfirmId ? (
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
      ) : null}
    </div>
  );
};
