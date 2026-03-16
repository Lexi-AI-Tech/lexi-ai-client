import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, Mic, Trash2 } from "lucide-react";
import "./meetings-list.css";

export interface Meeting {
    id: string;
    name: string;
    platform: string | null;
    created_at: string;
    summary?: string | null;
}

interface MeetingsListPageProps {
    meetings: Meeting[];
    onRefreshMeetings: () => void;
    /** When openToSummary is true, the detail page will open on the Summary tab instead of Transcript. */
    onSelectMeeting: (meetingId: string, openToSummary?: boolean) => void;
    onStartNewMeeting: () => void;
    isRecording: boolean;
    isGeneratingSummary: boolean;
}

export const MeetingsListPage: React.FC<MeetingsListPageProps> = ({
    meetings,
    onRefreshMeetings,
    onSelectMeeting,
    onStartNewMeeting,
    isRecording,
    isGeneratingSummary,
}) => {
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

    const formatDateShort = (createdAt: string) => {
        try {
            if (!createdAt) return "";
            const d = new Date(createdAt);
            return d.toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            });
        } catch {
            return "";
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
        visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 0.61, 0.36, 1] } },
    };

    return (
        <div className="meetings-list-page">
            <AnimatePresence mode="wait">
                {meetings.length === 0 ? (
                    <motion.div
                        key="empty"
                        className="meetings-list-page__empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4 }}
                    >
                        <div className="meetings-list-page__empty-icon">
                            <Mic size={40} strokeWidth={1.5} />
                        </div>
                        <p className="meetings-list-page__empty-text">No captured meetings yet</p>
                        <p className="meetings-list-page__empty-hint">
                            Start a meeting to capture transcripts and generate AI summaries.
                        </p>
                        <button
                            type="button"
                            className="meetings-list-page__cta"
                            onClick={onStartNewMeeting}
                            disabled={isRecording || isGeneratingSummary}
                        >
                            <Mic size={18} strokeWidth={2} />
                            Start New Meeting
                        </button>
                    </motion.div>
                ) : (
                    <>
                        <header className="meetings-list-page__header">
                            <div className="meetings-list-page__header-inner">
                                <h1 className="meetings-list-page__title">Meetings</h1>
                                <p className="meetings-list-page__subtitle">
                                    {meetings.length} {meetings.length === 1 ? "meeting" : "meetings"} captured
                                </p>
                            </div>
                            <button
                                type="button"
                                className="meetings-list-page__cta"
                                onClick={onStartNewMeeting}
                                disabled={isRecording || isGeneratingSummary}
                            >
                                <Mic size={18} strokeWidth={2} />
                                Start New Meeting
                            </button>
                        </header>
                        <motion.div
                            className="meetings-list-page__grid"
                            variants={GRID_VARIANTS}
                            initial="hidden"
                            animate="visible"
                        >
                            {meetings.map((m) => (
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
                                            <span className="meetings-list-page__card-badge">
                                                {m.platform || "Lexi AI"}
                                            </span>
                                            {formatDateShort(m.created_at) && (
                                                <span className="meetings-list-page__card-date">
                                                    {formatDateShort(m.created_at)}
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
                                            <ChevronRight size={16} strokeWidth={2.5} className="meetings-list-page__card-link-arrow" />
                                        </span>
                                        <button
                                            type="button"
                                            className="meetings-list-page__card-delete"
                                            onClick={(e) => openDeleteConfirm(e, m.id)}
                                            disabled={!!deletingId}
                                            title="Delete meeting"
                                        >
                                            <Trash2 size={16} strokeWidth={1.5} />
                                        </button>
                                    </div>
                                </motion.div>
                            ))}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {deleteConfirmId && (
                <div className="delete-modal-overlay" onClick={() => !deletingId && setDeleteConfirmId(null)}>
                    <div
                        className="delete-modal-content"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3>Delete meeting?</h3>
                        <p>
                            This action cannot be undone. The meeting and its entire transcript will be permanently
                            removed.
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
