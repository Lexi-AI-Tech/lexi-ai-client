import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { ArrowLeft, FileText, FilePlus, MessageCircle, Mic, MicOff, RefreshCw } from "lucide-react";
import { useAuthStore } from "../../store/authStore";
import type { Doc } from "../../types";
import type { Meeting } from "./MeetingsListPage";
import type { SummaryLine } from "./StreamingSummaryDisplay";
import { StreamingSummaryDisplay, createSummaryLine } from "./StreamingSummaryDisplay";
import "../meetings.css";
import "./meetings-list.css";
import "./meeting-detail-product.css";

interface TranscriptSegment {
    id: string;
    segment_index: number;
    start_time: string;
    end_time: string;
    text: string;
    message_type: string;
}

interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    created_at: string;
}

interface MeetingDetailPageProps {
    meetingId: string;
    meeting: Meeting | null;
    onBackToList: () => void;
    onMeetingDeleted: () => void;
    onMeetingsUpdated: (updater: (prev: Meeting[]) => Meeting[]) => void;
    /** When this meeting is the one being recorded */
    isThisMeetingRecording: boolean;
    /** Live transcript segments (only when isThisMeetingRecording) */
    liveSegments: TranscriptSegment[];
    /** Append a segment to live transcript (e.g. when adding a note during recording) */
    onLiveSegmentAdded?: (segment: TranscriptSegment) => void;
    /** When tray triggers end meeting */
    triggerEndMeetingFromTray?: boolean;
    onEndMeetingFromTrayConsumed?: () => void;
    /** Called when recording is stopped (so parent can clear recording state) */
    onRecordingStopped?: () => void;
    /** When set, the detail page opens on this tab (e.g. "summary" when coming from list "View details"). */
    initialTab?: "transcript" | "summary";
}

export const MeetingDetailPage: React.FC<MeetingDetailPageProps> = ({
    meetingId,
    meeting,
    onBackToList,
    onMeetingDeleted,
    onMeetingsUpdated,
    isThisMeetingRecording,
    liveSegments,
    onLiveSegmentAdded,
    triggerEndMeetingFromTray,
    onEndMeetingFromTrayConsumed,
    onRecordingStopped,
    initialTab,
}) => {
    const { tokens } = useAuthStore();
    const [activeTab, setActiveTab] = useState<"transcript" | "summary">(initialTab ?? "transcript");
    const [fetchedSegments, setFetchedSegments] = useState<TranscriptSegment[]>([]);
    const [activeSummary, setActiveSummary] = useState<string | null>(null);
    const [streamingLines, setStreamingLines] = useState<SummaryLine[]>([]);
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [isSendingChat, setIsSendingChat] = useState(false);
    const [noteInput, setNoteInput] = useState("");
    const [isAddingNote, setIsAddingNote] = useState(false);
    const [isInitializingMeeting, setIsInitializingMeeting] = useState(false);
    const [showCreateDocModal, setShowCreateDocModal] = useState(false);
    const [docTitleInput, setDocTitleInput] = useState("");
    const [docInstructionsInput, setDocInstructionsInput] = useState("");
    const [isCreatingDocFromSummary, setIsCreatingDocFromSummary] = useState(false);
    const [showEndConfirm, setShowEndConfirm] = useState(false);
    const [isEnding, setIsEnding] = useState(false);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [suggestedQuestions, setSuggestedQuestions] = useState<string[] | null>(null);
    const [isLoadingSuggestedQuestions, setIsLoadingSuggestedQuestions] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const chatScrollRef = useRef<HTMLDivElement>(null);

    const DEFAULT_SUGGESTED_QUESTIONS = [
        "What were the action items?",
        "Summarize key decisions",
        "Who is responsible for follow-ups?",
        "Any risks or blockers mentioned?",
    ];

    const segments = isThisMeetingRecording ? liveSegments : fetchedSegments;

    const summaryLines = useMemo(() => {
        if (streamingLines.length > 0) return streamingLines;
        if (!activeSummary) return [];
        return activeSummary
            .split("\n")
            .map((raw, i) => createSummaryLine(raw, i))
            .filter((l) => l.type !== "empty");
    }, [streamingLines, activeSummary]);


    useEffect(() => {
        const fetchDetails = async () => {
            if (!meetingId) return;
            try {
                const details = await invoke<{ transcripts?: TranscriptSegment[]; summary?: string | null }>(
                    "get_meeting_details",
                    { meetingId }
                );
                setFetchedSegments(details.transcripts ?? []);
                setActiveSummary(details.summary ?? null);
            } catch (error) {
                console.error("Failed to fetch meeting details:", error);
                setFetchedSegments([]);
            }
        };
        fetchDetails();
    }, [meetingId]);

    useEffect(() => {
        setSuggestedQuestions(null);
    }, [meetingId]);

    useEffect(() => {
        if (!meetingId || !activeSummary?.trim() || suggestedQuestions !== null) return;
        let cancelled = false;
        setIsLoadingSuggestedQuestions(true);
        (async () => {
            try {
                const questions = await invoke<string[]>("get_meeting_suggested_questions", {
                    meetingId,
                });
                if (!cancelled) setSuggestedQuestions(Array.isArray(questions) ? questions : []);
            } catch {
                if (!cancelled) setSuggestedQuestions([]);
            } finally {
                if (!cancelled) setIsLoadingSuggestedQuestions(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [meetingId, activeSummary, suggestedQuestions]);

    useEffect(() => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
    }, [chatMessages, isSendingChat]);

    useEffect(() => {
        if (!triggerEndMeetingFromTray) return;
        setActiveTab("summary");
        setShowEndConfirm(true);
        onEndMeetingFromTrayConsumed?.();
    }, [triggerEndMeetingFromTray, onEndMeetingFromTrayConsumed]);

    const startRecording = async () => {
        if (!tokens?.access_token) return;
        setIsInitializingMeeting(true);
        try {
            await invoke("start_meeting_recording", { meetingId });
        } catch (error) {
            console.error("Failed to start meeting recording:", error);
        } finally {
            setIsInitializingMeeting(false);
        }
    };

    const stopRecording = async () => {
        try {
            await invoke("stop_meeting_recording", { meetingId });
            onRecordingStopped?.();
        } catch (error) {
            console.error("Failed to stop meeting recording:", error);
        }
    };

    const handleGenerateSummary = async () => {
        if (!meetingId || isGeneratingSummary) return;
        const isRegenerate = !!activeSummary; // capture before clearing state
        setIsGeneratingSummary(true);
        setStreamingLines([]);
        setActiveSummary(null);
        setSuggestedQuestions(null); // refetch after new summary is saved

        let unlistenLine: UnlistenFn | null = null;
        let unlistenDone: UnlistenFn | null = null;
        const allLines: string[] = [];

        try {
            unlistenLine = await listen<{ meetingId: string; line: string }>(
                "meeting-summary-line",
                (event) => {
                    if (event.payload.meetingId !== meetingId) return;
                    const text = event.payload.line;
                    allLines.push(text);
                    setStreamingLines((prev) => [
                        ...prev,
                        createSummaryLine(text, prev.length),
                    ]);
                },
            );

            unlistenDone = await listen<{ meetingId: string; summary?: string; error?: string }>(
                "meeting-summary-done",
                (event) => {
                    if (event.payload.meetingId !== meetingId) return;
                    if (event.payload.error) {
                        console.error("Failed to generate meeting summary:", event.payload.error);
                        setIsGeneratingSummary(false);
                        setStreamingLines([]);
                        return;
                    }
                    const fullSummary = event.payload.summary ?? allLines.join("\n");
                    setActiveSummary(fullSummary || null);
                    setStreamingLines([]);
                    if (fullSummary && meeting) {
                        onMeetingsUpdated((prev) =>
                            prev.map((m) =>
                                m.id === meetingId ? { ...m, summary: fullSummary } : m,
                            ),
                        );
                    }
                    setIsGeneratingSummary(false);
                },
            );

            await invoke("stream_meeting_summary", {
                meetingId,
                regenerate: isRegenerate,
            });
        } catch (error) {
            console.error("Failed to start streaming meeting summary:", error);
            setIsGeneratingSummary(false);
            setStreamingLines([]);
        } finally {
            // listeners are cleaned up when "done" event fires; this is a safety net
            const cleanup = async () => {
                if (unlistenLine) await unlistenLine();
                if (unlistenDone) await unlistenDone();
            };
            cleanup().catch(() => undefined);
        }
    };

    const handleCreateDocFromSummary = async () => {
        const title = docTitleInput.trim();
        const instructions = docInstructionsInput.trim();
        if (!meetingId || !title || !instructions || isCreatingDocFromSummary) return;
        setIsCreatingDocFromSummary(true);
        try {
            const doc = await invoke<Doc>("create_doc_from_meeting", {
                meetingId,
                title,
                instructions,
            });
            setShowCreateDocModal(false);
            setDocTitleInput("");
            setDocInstructionsInput("");
            window.dispatchEvent(
                new CustomEvent("lexi-navigate-to-doc", { detail: { docId: doc.id } })
            );
        } catch (error) {
            console.error("Failed to create doc from meeting summary:", error);
        } finally {
            setIsCreatingDocFromSummary(false);
        }
    };

    const handleSendChatMessage = async (e?: React.FormEvent, contentOverride?: string) => {
        if (e) e.preventDefault();
        const text = (contentOverride != null ? contentOverride : chatInput).trim();
        if (!text || !meetingId || isSendingChat) return;
        const tempId = Math.random().toString();
        const newMessage: ChatMessage = {
            id: tempId,
            role: "user",
            content: text,
            created_at: new Date().toISOString(),
        };
        setChatMessages((prev) => [...prev, newMessage]);
        setChatInput("");
        setIsSendingChat(true);
        try {
            const apiHistory = chatMessages.map((msg) => ({ role: msg.role, content: msg.content }));
            const raw = await invoke<{ id?: string; role?: string; content?: string; created_at?: string }>(
                "send_meeting_chat",
                { meetingId, content: text, history: apiHistory }
            );
            const assistantMessage: ChatMessage = {
                id: raw?.id ?? crypto.randomUUID(),
                role: "assistant",
                content: typeof raw?.content === "string" ? raw.content : String(raw?.content ?? ""),
                created_at: typeof raw?.created_at === "string" ? raw.created_at : new Date().toISOString(),
            };
            setChatMessages((prev) => [...prev, assistantMessage]);
        } catch (error) {
            console.error("Failed to send meeting chat:", error);
            const errorText = error instanceof Error ? error.message : String(error);
            setChatMessages((prev) => [
                ...prev,
                {
                    id: `err-${tempId}`,
                    role: "assistant" as const,
                    content: `Unable to get a response. ${errorText || "Please try again."}`,
                    created_at: new Date().toISOString(),
                },
            ]);
        } finally {
            setIsSendingChat(false);
        }
    };

    const handleAddNote = async (e: React.FormEvent) => {
        e.preventDefault();
        const text = noteInput.trim();
        if (!meetingId || !text || isAddingNote) return;
        setIsAddingNote(true);
        try {
            const segment = await invoke<TranscriptSegment>("add_meeting_note", { meetingId, text });
            if (isThisMeetingRecording && onLiveSegmentAdded) {
                onLiveSegmentAdded(segment);
            } else {
                setFetchedSegments((prev) => [...prev, segment]);
            }
            setNoteInput("");
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        } catch (error) {
            console.error("Failed to add meeting note:", error);
        } finally {
            setIsAddingNote(false);
        }
    };

    const handleConfirmDelete = async () => {
        if (!deleteConfirmId) return;
        setDeletingId(deleteConfirmId);
        try {
            await invoke("delete_meeting", { meetingId: deleteConfirmId });
            onMeetingDeleted();
            setDeleteConfirmId(null);
        } catch (error) {
            console.error("Failed to delete meeting:", error);
        } finally {
            setDeletingId(null);
        }
    };

    const handleEndMeeting = async () => {
        setIsEnding(true);
        try {
            if (isThisMeetingRecording) await stopRecording();
            setShowEndConfirm(false);
            setActiveTab("summary");
            await handleGenerateSummary();
        } catch (error) {
            console.error("Failed to end meeting:", error);
        } finally {
            setIsEnding(false);
        }
    };

    const formatMeetingDate = (createdAt: string) => {
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

    const PAGE_VARIANTS = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: { staggerChildren: 0.06, delayChildren: 0.1 },
        },
    };

    const SECTION_VARIANTS = {
        hidden: { opacity: 0, y: 16 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 0.61, 0.36, 1] } },
    };

    return (
        <motion.div
            className="meeting-detail-product"
            initial="hidden"
            animate="visible"
            variants={PAGE_VARIANTS}
        >
            {/* Toolbar */}
            <motion.div className="meeting-detail-toolbar" variants={SECTION_VARIANTS}>
                <div className="meeting-detail-toolbar__left">
                    <div className="meeting-detail-tabs">
                        <button
                            type="button"
                            className={`meeting-detail-tabs__btn ${activeTab === "summary" ? "meeting-detail-tabs__btn--active" : ""}`}
                            onClick={() => setActiveTab("summary")}
                            disabled={isThisMeetingRecording}
                        >
                            <FileText size={16} style={{ marginRight: 6, verticalAlign: -3 }} />
                            Summary
                        </button>
                        <button
                            type="button"
                            className={`meeting-detail-tabs__btn ${activeTab === "transcript" ? "meeting-detail-tabs__btn--active" : ""}`}
                            onClick={() => setActiveTab("transcript")}
                        >
                            <Mic size={16} style={{ marginRight: 6, verticalAlign: -3 }} />
                            Transcript
                        </button>
                    </div>
                    {!activeSummary && !isGeneratingSummary && !isInitializingMeeting && (segments.length === 0 || isThisMeetingRecording) && (
                        <div className="meeting-detail-controls">
                            <button
                                type="button"
                                className={`meeting-detail-controls__btn meeting-detail-controls__btn--resume ${isThisMeetingRecording ? "meeting-detail-controls__btn--recording" : ""}`}
                                onClick={() => (isThisMeetingRecording ? stopRecording() : startRecording())}
                            >
                                {isThisMeetingRecording ? (
                                    <>
                                        <MicOff size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                                        Pause
                                    </>
                                ) : (
                                    <>
                                        <Mic size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                                        Resume
                                    </>
                                )}
                            </button>
                            <button
                                type="button"
                                className="meeting-detail-controls__btn meeting-detail-controls__btn--end"
                                onClick={() => setShowEndConfirm(true)}
                            >
                                End
                            </button>
                        </div>
                    )}
                </div>
                <div className="meeting-detail-toolbar__right">
                    <button
                        type="button"
                        className="meeting-detail-toolbar__delete"
                        onClick={() => setDeleteConfirmId(meetingId)}
                        disabled={!!deletingId}
                    >
                        Delete
                    </button>
                </div>
            </motion.div>

            {/* Content */}
            <div className="meeting-detail-content">
                <AnimatePresence mode="wait">
                    {activeTab === "transcript" && (
                        <motion.div
                            key="transcript"
                            className="meeting-detail-transcript"
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 8 }}
                            transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
                        >
                            <div ref={scrollRef} className="meeting-detail-transcript__scroll">
                                {isInitializingMeeting ? (
                                    <div className="meeting-detail-transcript__initializing">
                                        <div className="meeting-detail-transcript__initializing-spinner" />
                                        <p className="meeting-detail-transcript__initializing-text">Getting ready…</p>
                                    </div>
                                ) : segments.length === 0 ? (
                                    <p className="meeting-detail-transcript__empty">
                                        {isThisMeetingRecording ? "Listening for speech..." : "Click Resume to start capturing."}
                                    </p>
                                ) : null}
                                {segments.map((seg, idx) => {
                                    let timeString = "00:00:00";
                                    try {
                                        if (seg.start_time) {
                                            const d = new Date(seg.start_time);
                                            timeString = d.toLocaleTimeString([], {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                                second: "2-digit",
                                            });
                                        }
                                    } catch {
                                        // ignore
                                    }
                                    const msgType = seg.message_type;
                                    const isUser = msgType === "user_audio" || msgType === "user_note";
                                    const isSystem = msgType === "system_audio";
                                    const segmentAlign = isUser ? "user" : isSystem ? "system" : "unknown";
                                    const bubbleVariant = isUser ? "user" : isSystem ? "system" : "unknown";
                                    return (
                                        <div
                                            key={seg.id ?? idx}
                                            className={`meeting-detail-transcript__segment meeting-detail-transcript__segment--${segmentAlign}`}
                                        >
                                            <div className={`meeting-detail-transcript__bubble meeting-detail-transcript__bubble--${bubbleVariant}`}>
                                                <span className="meeting-detail-transcript__time">[{timeString}]</span>
                                                <span>{seg.text}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <form onSubmit={handleAddNote} className="meeting-detail-transcript-notes">
                                <input
                                    type="text"
                                    className="meeting-detail-transcript-notes__input"
                                    value={noteInput}
                                    onChange={(e) => setNoteInput(e.target.value)}
                                    placeholder="Add a note..."
                                    disabled={isAddingNote || !meetingId || isInitializingMeeting}
                                />
                                <button
                                    type="submit"
                                    className="meeting-detail-btn meeting-detail-btn--primary"
                                    disabled={isAddingNote || !noteInput.trim() || !meetingId || isInitializingMeeting}
                                >
                                    {isAddingNote ? "Adding…" : "Add note"}
                                </button>
                            </form>
                        </motion.div>
                    )}

                    {activeTab === "summary" && (
                        <motion.div
                            key="summary"
                            className={`meeting-detail-split ${activeSummary ? "" : "meeting-detail-split--no-rail"}`}
                            initial={{ opacity: 0, x: 8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -8 }}
                            transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
                        >
                            <div className="meeting-detail-main">
                                <div className="meeting-detail-card meeting-detail-summary-panel">
                                    <div className="meeting-detail-summary-panel__header">
                                        <h3 className="meeting-detail-summary-panel__title">AI Summary</h3>
                                        <div className="meeting-detail-summary-panel__actions">
                                            {activeSummary && (
                                                <>
                                                    <button
                                                        type="button"
                                                        className="meeting-detail-btn meeting-detail-btn--secondary"
                                                        onClick={() => setShowCreateDocModal(true)}
                                                        title="Create a document from this meeting"
                                                    >
                                                        <FilePlus size={14} className="meeting-detail-btn__icon" aria-hidden />
                                                        Create doc
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="meeting-detail-btn meeting-detail-btn--secondary"
                                                        onClick={handleGenerateSummary}
                                                        disabled={!meetingId || isGeneratingSummary}
                                                        title="Generate a new summary"
                                                    >
                                                        <RefreshCw
                                                            size={14}
                                                            className={`meeting-detail-btn__icon ${isGeneratingSummary ? "meeting-detail-btn__icon--spin" : ""}`}
                                                            aria-hidden
                                                        />
                                                        {isGeneratingSummary ? "Regenerating…" : "Regenerate"}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="meeting-detail-summary-panel__body">
                                        {summaryLines.length > 0 ? (
                                            <StreamingSummaryDisplay
                                                lines={summaryLines}
                                                isStreaming={isGeneratingSummary}
                                                className="meetings-summary-body"
                                            />
                                        ) : isGeneratingSummary ? (
                                            <div className="meeting-detail-generating">
                                                <div className="meeting-detail-generating__spinner" />
                                                <p className="meeting-detail-generating__text">Generating summary…</p>
                                            </div>
                                        ) : (
                                            <div className="meeting-detail-empty-state">
                                                <div className="meeting-detail-empty-state__icon">✨</div>
                                                <h4 className="meeting-detail-empty-state__title">Generate AI Summary</h4>
                                                <p className="meeting-detail-empty-state__hint">
                                                    Transform your transcript into a structured summary with key topics, decisions, and action items.
                                                </p>
                                                <button
                                                    type="button"
                                                    className="meeting-detail-empty-state__btn"
                                                    onClick={handleGenerateSummary}
                                                    disabled={!meetingId || isGeneratingSummary}
                                                >
                                                    Generate summary
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            {activeSummary && (
                                <aside className="meeting-detail-rail">
                                    <div className="meeting-detail-rail__header">
                                        <span className="meeting-detail-rail__label">
                                            <MessageCircle size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                                            Q&A
                                        </span>
                                        <p className="meeting-detail-rail__hint">
                                            Ask about this meeting. Use suggested questions or type your own.
                                        </p>
                                    </div>
                                    <div className="meeting-detail-rail__section">
                                        <div className="meeting-detail-rail__section-title">Suggested questions</div>
                                        {isLoadingSuggestedQuestions ? (
                                            <p className="meeting-detail-rail__suggestions-loading">
                                                Loading…
                                            </p>
                                        ) : (
                                            (suggestedQuestions && suggestedQuestions.length > 0
                                                ? suggestedQuestions
                                                : DEFAULT_SUGGESTED_QUESTIONS
                                            ).map((q) => (
                                                <button
                                                    key={q}
                                                    type="button"
                                                    className="meeting-detail-rail__chip"
                                                    onClick={() => handleSendChatMessage(undefined, q)}
                                                    disabled={!activeSummary || isSendingChat || isThisMeetingRecording}
                                                >
                                                    {q}
                                                </button>
                                            ))
                                        )}
                                    </div>
                                    <div className="meeting-detail-rail__section meeting-detail-rail__section--conversation">
                                        <div className="meeting-detail-rail__section-title">Conversation</div>
                                        <div ref={chatScrollRef} className="meeting-detail-rail__messages">
                                            {chatMessages.length === 0 && !isSendingChat ? (
                                                <p className="meeting-detail-rail__empty">
                                                    Your questions and answers appear here.
                                                </p>
                                            ) : (
                                                <>
                                                    {chatMessages.map((msg) => (
                                                        <div
                                                            key={msg.id}
                                                            className={`meeting-detail-rail__msg meeting-detail-rail__msg--${msg.role}`}
                                                        >
                                                            <div className="meeting-detail-rail__msg-body">
                                                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {isSendingChat && (
                                                        <div className="meeting-detail-rail__msg meeting-detail-rail__msg--assistant meeting-detail-rail__msg--loading">
                                                            <span className="meeting-detail-rail__loading-dots" />
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                        <form onSubmit={handleSendChatMessage} className="meeting-detail-rail__form">
                                            <input
                                                type="text"
                                                className="meeting-detail-rail__input"
                                                value={chatInput}
                                                onChange={(e) => setChatInput(e.target.value)}
                                                placeholder="Ask a question..."
                                                disabled={isSendingChat || isThisMeetingRecording}
                                            />
                                            <button
                                                type="submit"
                                                className="meeting-detail-btn meeting-detail-btn--primary meeting-detail-rail__submit"
                                                disabled={isSendingChat || !chatInput.trim() || isThisMeetingRecording}
                                            >
                                                Send
                                            </button>
                                        </form>
                                    </div>
                                </aside>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {deleteConfirmId && (
                <div className="delete-modal-overlay" onClick={() => !deletingId && setDeleteConfirmId(null)}>
                    <div className="delete-modal-content" onClick={(e) => e.stopPropagation()}>
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

            {showEndConfirm && (
                <div className="delete-modal-overlay" onClick={() => !isEnding && setShowEndConfirm(false)}>
                    <div className="delete-modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3>End meeting?</h3>
                        <p>
                            The transcript will be finalized and a summary will be generated. You won't be able to
                            resume recording after this.
                        </p>
                        <div className="delete-modal-actions">
                            <button
                                type="button"
                                className="delete-modal-btn-cancel"
                                onClick={() => setShowEndConfirm(false)}
                                disabled={isEnding}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="delete-modal-btn-delete"
                                onClick={handleEndMeeting}
                                disabled={isEnding}
                            >
                                {isEnding ? "Ending..." : "End Meeting"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showCreateDocModal && (
                <div
                    className="delete-modal-overlay"
                    onClick={() => !isCreatingDocFromSummary && setShowCreateDocModal(false)}
                >
                    <div className="delete-modal-content meetings-create-doc-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Create document from this meeting</h3>
                        <p>Describe what you want to extract. The AI will generate a structured document from the meeting context.</p>
                        <label className="meetings-create-doc-label">Document name</label>
                        <input
                            type="text"
                            className="meetings-create-doc-input"
                            placeholder="e.g. Project Brief, Action Items"
                            value={docTitleInput}
                            onChange={(e) => setDocTitleInput(e.target.value)}
                            disabled={isCreatingDocFromSummary}
                        />
                        <label className="meetings-create-doc-label">What would you like to get out of this meeting?</label>
                        <textarea
                            className="meetings-create-doc-textarea"
                            placeholder="e.g. Extract key decisions and action items. Include who is responsible for each task and any deadlines mentioned."
                            value={docInstructionsInput}
                            onChange={(e) => setDocInstructionsInput(e.target.value)}
                            disabled={isCreatingDocFromSummary}
                            rows={4}
                        />
                        <div className="delete-modal-actions">
                            <button
                                type="button"
                                className="delete-modal-btn-cancel"
                                onClick={() => setShowCreateDocModal(false)}
                                disabled={isCreatingDocFromSummary}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="delete-modal-btn-delete"
                                onClick={handleCreateDocFromSummary}
                                disabled={isCreatingDocFromSummary || !docTitleInput.trim() || !docInstructionsInput.trim()}
                            >
                                {isCreatingDocFromSummary ? "Creating…" : "Create"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </motion.div>
    );
};
