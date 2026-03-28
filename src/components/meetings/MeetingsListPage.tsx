import React, { useId, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, Video, Trash2, Info } from "lucide-react";
import "./meetings-list.css";
import { formatAppDateTime } from "../../lib/dateUtils";

const MEETINGS_HELP =
  "Lexi runs meeting auto-detect in the background—when it recognizes a supported call, you can start capturing from the prompt. You can also start anytime from the Lexi menu bar tray (Start Meeting) or with Start New Meeting here. Open a meeting for live transcript, AI summary, and chat; end recording from the meeting view or the tray when you’re done.";

export interface Meeting {
  id: string;
  name: string;
  platform: string | null;
  created_at: string;
  /** Server lifecycle: draft | live | paused | ended */
  status?: string;
  summary?: string | null;
}

interface MeetingsListPageProps {
  meetings: Meeting[];
  onRefreshMeetings: () => void;
  /** When openToSummary is true, the detail page will open on the Summary tab instead of Transcript. */
  onSelectMeeting: (meetingId: string, openToSummary?: boolean) => void;
  onStartNewMeeting: () => void;
  isRecording: boolean;
  activeRecordingMeetingId?: string | null;
  isGeneratingSummary: boolean;
  isLoading?: boolean;
}

export const MeetingsListPage: React.FC<MeetingsListPageProps> = ({
  meetings,
  onRefreshMeetings,
  onSelectMeeting,
  onStartNewMeeting,
  isRecording,
  activeRecordingMeetingId = null,
  isGeneratingSummary,
  isLoading = false,
}) => {
  const meetingsTooltipId = useId();
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleConfirmDelete = async () => {
    if (!deleteConfirmId) return;
    setDeletingId(deleteConfirmId);
    try {
      await invoke("delete_meeting", { meetingId: deleteConfirmId });
      onRefreshMeetings();
      setDeleteConfirmId(null);
    } catch (error) {
      console.error("Failed to delete meeting:", error);
    } finally {
      setDeletingId(null);
    }
  };

  const openDeleteConfirm = (e: React.MouseEvent, meetingId: string) => {
    e.stopPropagation();
    setDeleteConfirmId(meetingId);
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

  const showInitialSkeleton = isLoading && meetings.length === 0;
  const showEmpty = !isLoading && meetings.length === 0;
  const showGrid = meetings.length > 0;

  const subtitle =
    isLoading && meetings.length === 0 ? (
      <p className="app-page-subtitle">
        <span
          className="skeleton-block app-page-subtitle-skeleton"
          style={{ width: 170, height: 12, borderRadius: 10 }}
        />
      </p>
    ) : meetings.length > 0 ? (
      <p className="app-page-subtitle">
        {meetings.length} {meetings.length === 1 ? "meeting" : "meetings"}{" "}
        captured
      </p>
    ) : null;

  return (
    <div className="meetings-list-page">
      <header className="meetings-list-page__header">
        <div className="meetings-list-page__header-inner">
          <h1 className="meetings-list-page__title meetings-list-page__title--with-icon">
            <Video
              className="meetings-list-page__title__icon"
              size={22}
              strokeWidth={2}
              aria-hidden
            />
            Meetings
            <span className="transcripts-page-tooltip-wrap">
              <button
                type="button"
                className="transcripts-page-tooltip-trigger"
                aria-label="How meetings work"
                aria-describedby={meetingsTooltipId}
              >
                <Info size={16} strokeWidth={2} aria-hidden />
              </button>
              <span
                id={meetingsTooltipId}
                className="transcripts-page-tooltip"
                role="tooltip"
              >
                {MEETINGS_HELP}
              </span>
            </span>
          </h1>
          {subtitle}
        </div>
        <button
          type="button"
          className="meetings-list-page__cta"
          onClick={onStartNewMeeting}
          disabled={isRecording || isGeneratingSummary}
        >
          <Video size={18} strokeWidth={2} />
          Start New Meeting
        </button>
      </header>

      <div className="meetings-list-page__content">
        <AnimatePresence mode="wait">
          {showInitialSkeleton ? (
            <motion.div
              key="meetings-loading-content"
              className="meetings-list-page__loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="meetings-list-page__grid">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="meetings-list-page__card meetings-list-page__card--skeleton"
                  >
                    <div className="meetings-list-page__skeleton-line meetings-list-page__skeleton-line--sm" />
                    <div className="meetings-list-page__skeleton-line meetings-list-page__skeleton-line--md" />
                    <div className="meetings-list-page__skeleton-line meetings-list-page__skeleton-line--lg" />
                    <div className="meetings-list-page__skeleton-line meetings-list-page__skeleton-line--lg" />
                  </div>
                ))}
              </div>
            </motion.div>
          ) : showEmpty ? (
            <motion.div
              key="meetings-empty"
              className="meetings-list-page__empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <div className="meetings-list-page__empty-icon">
                <Video size={40} strokeWidth={1.5} />
              </div>
              <p className="meetings-list-page__empty-text">
                No captured meetings yet
              </p>
              <p className="meetings-list-page__empty-hint">
                Start a meeting to capture transcripts and generate AI
                summaries.
              </p>
            </motion.div>
          ) : showGrid ? (
            <motion.div
              key="meetings-grid"
              className="meetings-list-page__grid"
              variants={GRID_VARIANTS}
              initial="hidden"
              animate="visible"
            >
              {meetings.map((m) => {
                const isLiveMeeting =
                  m.status === "live" || activeRecordingMeetingId === m.id;
                return (
                  <motion.div
                    key={m.id}
                    className="meetings-list-page__card"
                    variants={CARD_VARIANTS}
                    onClick={() => onSelectMeeting(m.id, true)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectMeeting(m.id, true);
                      }
                    }}
                  >
                    <div className="meetings-list-page__card-body">
                      <div className="meetings-list-page__card-meta-row">
                        {isLiveMeeting && (
                          <span className="meetings-page-header__badge meetings-page-header__badge--live">
                            <span className="meetings-page-header__badge-dot" />
                            Live
                          </span>
                        )}
                        {formatAppDateTime(m.created_at) && (
                          <span className="meetings-list-page__card-date">
                            {formatAppDateTime(m.created_at)}
                          </span>
                        )}
                      </div>
                      <h3 className="meetings-list-page__card-title">
                        {m.name || "Untitled Meeting"}
                      </h3>
                      {m.summary ? (
                        <div className="meetings-list-page__card-summary meetings-list-page__card-summary--preview">
                          <div className="meetings-list-page__card-summary-markdown">
                            <ReactMarkdown>{m.summary}</ReactMarkdown>
                          </div>
                        </div>
                      ) : (
                        <p className="meetings-list-page__card-summary meetings-list-page__card-summary--muted">
                          No summary yet
                        </p>
                      )}
                    </div>
                    <div className="meetings-list-page__card-actions">
                      <span className="meetings-list-page__card-link">
                        View details
                        <ChevronRight
                          size={16}
                          strokeWidth={2.5}
                          className="meetings-list-page__card-link-arrow"
                        />
                      </span>
                      <button
                        type="button"
                        className="meetings-list-page__card-delete"
                        onClick={(e) => openDeleteConfirm(e, m.id)}
                        disabled={!!deletingId || isLiveMeeting}
                        title={
                          isLiveMeeting
                            ? "Cannot delete while meeting is live"
                            : "Delete meeting"
                        }
                      >
                        <Trash2 size={16} strokeWidth={1.5} />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {deleteConfirmId && (
        <div
          className="delete-modal-overlay"
          onClick={() => !deletingId && setDeleteConfirmId(null)}
        >
          <div
            className="delete-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Delete meeting?</h3>
            <p>
              This action cannot be undone. The meeting and its entire
              transcript will be permanently removed.
            </p>
            <div className="delete-modal-actions">
              <button
                type="button"
                className="delete-modal-btn-cancel"
                onClick={() => setDeleteConfirmId(null)}
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
