import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trash2 } from "lucide-react";
import { useAuthStore } from "../store/authStore";
import "./meetings.css";

interface TranscriptSegment {
    id: string;
    segment_index: number;
    start_time: string;
    end_time: string;
    text: string;
    /** "user" (mic) = render right; "system" (system audio) = render left; from UI/backend only */
    speaker_type: string;
}

interface Meeting {
    id: string;
    name: string;
    platform: string | null;
    created_at: string;
    summary?: string | null;
    transcripts?: TranscriptSegment[];
}

interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    created_at: string;
}

interface MeetingsPageProps {
    autoStart?: boolean;
    autoStartPlatform?: string | null;
    onAutoStartConsumed?: () => void;
    /** When a meeting is started from the pill overlay, focus that meeting and show transcript tab. */
    pillMeetingId?: string | null;
    onPillMeetingConsumed?: () => void;
}

export const MeetingsPage: React.FC<MeetingsPageProps> = ({
    autoStart,
    autoStartPlatform,
    onAutoStartConsumed,
    pillMeetingId,
    onPillMeetingConsumed,
}) => {
    const { tokens } = useAuthStore();
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);

    // Tab state: Summary & Q/A first (primary), Transcript second
    const [activeTab, setActiveTab] = useState<"transcript" | "summary">("summary");

    // Real-time state
    const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);
    const [isRecording, setIsRecording] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Summary & Chat state
    const [activeSummary, setActiveSummary] = useState<string | null>(null);
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [isSendingChat, setIsSendingChat] = useState(false);
    const chatScrollRef = useRef<HTMLDivElement>(null);

    // Deletion state
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // End meeting confirmation state
    const [showEndConfirm, setShowEndConfirm] = useState(false);
    const [isEnding, setIsEnding] = useState(false);

    // 1. Fetch historical meetings
    const fetchMeetings = async () => {
        try {
            const result = await invoke<Meeting[]>("list_meetings");
            // The API returns an array of meetings
            setMeetings(result);
        } catch (error) {
            console.error("Failed to fetch meetings:", error);
        }
    };

    useEffect(() => {
        if (tokens?.access_token) {
            fetchMeetings();
        }
    }, [tokens]);

    // Fetch transcripts when a meeting is selected
    useEffect(() => {
        const fetchMeetingDetails = async () => {
            if (!activeMeetingId) return;
            try {
                const meetingDetails = await invoke<Meeting>("get_meeting_details", { meetingId: activeMeetingId });
                if (meetingDetails.transcripts) {
                    setLiveSegments(meetingDetails.transcripts);
                } else {
                    setLiveSegments([]);
                }

                // Set the summary block
                if (meetingDetails.summary) {
                    setActiveSummary(meetingDetails.summary);
                } else {
                    setActiveSummary(null);
                }

                // Fetch Chat History
                try {
                    const msgs = await invoke<ChatMessage[]>("get_meeting_messages", { meetingId: activeMeetingId });
                    setChatMessages(msgs);
                } catch (err) {
                    console.error("Failed to load meeting chat history:", err);
                    setChatMessages([]);
                }
            } catch (error) {
                console.error("Failed to fetch meeting details:", error);
                setLiveSegments([]);
            }
        };

        if (activeMeetingId) {
            fetchMeetingDetails();
        }
    }, [activeMeetingId]);

    // Auto-scroll chat to bottom
    useEffect(() => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
    }, [chatMessages]);

    // 2. Real-time streaming logic via Tauri
    useEffect(() => {
        let isMounted = true;
        let unlistenFn: (() => void) | undefined;

        const setupListener = async () => {
            const { listen } = await import('@tauri-apps/api/event');
            const unlisten = await listen<TranscriptSegment>("meeting-transcript", (event) => {
                if (!isMounted) return;
                setLiveSegments((prev) => [...prev, event.payload]);
                // Auto-scroll to bottom
                if (scrollRef.current) {
                    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
            });
            unlistenFn = unlisten;
        };

        setupListener();

        return () => {
            isMounted = false;
            if (unlistenFn) unlistenFn();
        };
    }, []);

    const handleCreateAndStartMeeting = async () => {
        if (!tokens?.access_token) return;

        try {
            const platform = autoStartPlatform ?? null;
            const name =
                typeof autoStartPlatform === "string" && autoStartPlatform.trim().length > 0
                    ? `${autoStartPlatform} Meeting`
                    : "Meeting Session";

            const newMeeting = await invoke<Meeting>("create_meeting", {
                name,
                platform
            });

            // Add to list immediately
            setMeetings(prev => [newMeeting, ...prev]);

            // Start recording automatically
            await startRecording(newMeeting.id);
        } catch (error) {
            console.error("Failed to create new meeting:", error);
        }
    };

    // Auto-start meeting when triggered from system tray
    useEffect(() => {
        if (autoStart && !isRecording) {
            handleCreateAndStartMeeting();
            onAutoStartConsumed?.();
        }
    }, [autoStart]);

    // Focus an already-started meeting when triggered from the pill overlay
    useEffect(() => {
        if (!pillMeetingId) return;

        // Refresh meetings so the newly created meeting appears in the sidebar
        fetchMeetings();
        setActiveMeetingId(pillMeetingId);
        setActiveTab("transcript");
        setIsRecording(true);

        onPillMeetingConsumed?.();
    }, [pillMeetingId]);

    const startRecording = async (meetingId: string) => {
        if (!tokens?.access_token) return;
        setIsRecording(true);
        setActiveMeetingId(meetingId);
        setActiveTab("transcript");

        try {
            await invoke("start_meeting_recording", { meetingId });
        } catch (error) {
            console.error("Failed to start meeting recording:", error);
            setIsRecording(false);
        }
    };

    const stopRecording = async () => {
        try {
            // Note: In reality, we might not always have activeMeetingId here if called globally, 
            // but for this UI, we do.
            if (activeMeetingId) {
                await invoke("stop_meeting_recording", { meetingId: activeMeetingId });
            }
        } catch (error) {
            console.error("Failed to stop meeting recording:", error);
        } finally {
            setIsRecording(false);
        }
    };

    const handleSendChatMessage = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        const text = chatInput.trim();
        if (!text || !activeMeetingId || isSendingChat) return;

        // Optimistic UI Append
        const tempId = Math.random().toString();
        const newMessage: ChatMessage = {
            id: tempId,
            role: "user",
            content: text,
            created_at: new Date().toISOString()
        };

        setChatMessages(prev => [...prev, newMessage]);
        setChatInput("");
        setIsSendingChat(true);

        try {
            const apiHistory = chatMessages.map(msg => ({ role: msg.role, content: msg.content }));
            const aiResponse = await invoke<ChatMessage>("send_meeting_chat", {
                meetingId: activeMeetingId,
                content: text,
                history: apiHistory
            });

            setChatMessages(prev => [...prev, aiResponse]);
        } catch (error) {
            console.error("Failed to send meeting chat:", error);
            // Revert optimistic insert
            setChatMessages(prev => prev.filter(m => m.id !== tempId));
            setChatInput(text); // Give them their text back
        } finally {
            setIsSendingChat(false);
        }
    };

    const openDeleteConfirm = (e: React.MouseEvent, meetingId: string) => {
        e.stopPropagation();
        setDeleteConfirmId(meetingId);
    };

    const closeDeleteConfirm = () => {
        if (!deletingId) setDeleteConfirmId(null);
    };

    const handleConfirmDeleteMeeting = async () => {
        if (!deleteConfirmId) return;

        setDeletingId(deleteConfirmId);
        try {
            await invoke("delete_meeting", { meetingId: deleteConfirmId });

            // Remove from list
            setMeetings(prev => prev.filter(m => m.id !== deleteConfirmId));

            // If we deleted the active meeting, clear the right pane
            if (deleteConfirmId === activeMeetingId) {
                setActiveMeetingId(null);
                setLiveSegments([]);
                if (isRecording) {
                    await stopRecording();
                }
            }

            setDeleteConfirmId(null);
        } catch (error) {
            console.error("Failed to delete meeting:", error);
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="page">
            <h2 className="page__title">Meetings</h2>

            <div className="meetings-content">

                {/* Left Side: Meetings List */}
                <aside className="panel meetings-sidebar">
                    <div className="panel__label">Recent Meetings</div>
                    {meetings.length === 0 ? <p className="meetings-sidebar__empty">No captured meetings yet.</p> : null}

                    <div className="meetings-list">
                        {meetings.map((m) => {
                            let dateStr = "Unknown Date";
                            let timeStr = "";
                            try {
                                if (m.created_at) {
                                    const d = new Date(m.created_at);
                                    dateStr = d.toLocaleDateString();
                                    timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                }
                            } catch (e) {
                                // Ignore
                            }
                            return (
                                <div
                                    key={m.id}
                                    className={`meeting-item ${activeMeetingId === m.id ? "active" : ""}`}
                                    onClick={() => setActiveMeetingId(m.id)}
                                >
                                    <div className="meeting-item__title">{m.name || "Untitled Meeting"}</div>
                                    <div className="meeting-item__meta">
                                        {m.platform || "Lexi AI"} • {dateStr} {timeStr}
                                    </div>
                                    <button
                                        type="button"
                                        className="meeting-item__delete"
                                        onClick={(e) => openDeleteConfirm(e, m.id)}
                                        disabled={!!deletingId}
                                        title="Delete meeting"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    <button
                        type="button"
                        className="btn btn--secondary meetings-sidebar__cta"
                        onClick={handleCreateAndStartMeeting}
                        disabled={isRecording || isGeneratingSummary}
                    >
                        + Start New Meeting
                    </button>
                </aside>

                {/* Right Side: Live View */}
                <main className="panel meetings-main">
                    {activeMeetingId ? (
                        <>
                            <div className="meetings-toolbar">
                                <div className="meetings-tabs">
                                    <button
                                        type="button"
                                        className={`btn meetings-tabs__btn ${activeTab === "summary" ? "btn--primary" : ""}`}
                                        onClick={() => setActiveTab("summary")}
                                        disabled={isRecording}
                                    >
                                        Summary
                                    </button>
                                    <button
                                        type="button"
                                        className={`btn meetings-tabs__btn ${activeTab === "transcript" ? "btn--primary" : ""}`}
                                        onClick={() => setActiveTab("transcript")}
                                    >
                                        Transcript
                                    </button>
                                </div>
                                {!activeSummary && (
                                    <div className="meetings-actions">
                                        <button
                                            type="button"
                                            className={`btn meetings-actions__resume ${isRecording ? "recording" : "btn--primary"}`}
                                            onClick={() => isRecording ? stopRecording() : startRecording(activeMeetingId)}
                                        >
                                            {isRecording ? "Pause" : "Resume"}
                                        </button>
                                        <button
                                            type="button"
                                            className="btn meetings-actions__end"
                                            onClick={() => setShowEndConfirm(true)}
                                        >
                                            End
                                        </button>
                                    </div>
                                )}
                            </div>

                            {activeTab === "transcript" && (
                                <div ref={scrollRef} className="meetings-transcript">
                                    {liveSegments.length === 0 ? (
                                        <p className="meetings-transcript__empty">
                                            {isRecording ? "Listening for speech..." : "Click Resume Capture to start."}
                                        </p>
                                    ) : null}

                                    {liveSegments.map((seg, idx) => {
                                        let timeString = "00:00:00";
                                        try {
                                            if (seg.start_time) {
                                                const d = new Date(seg.start_time);
                                                timeString = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                            }
                                        } catch (e) {
                                            // Ignore parsing errors
                                        }
                                        const isUser = seg.speaker_type === "user";
                                        const isSystem = seg.speaker_type === "system";
                                        const segmentAlign = isUser ? "user" : isSystem ? "system" : "unknown";
                                        const bubbleVariant = isUser ? "user" : isSystem ? "system" : "unknown";
                                        return (
                                            <div
                                                key={seg.id ?? idx}
                                                className={`meetings-transcript__segment meetings-transcript__segment--${segmentAlign}`}
                                            >
                                                <div className={`meetings-transcript__bubble meetings-transcript__bubble--${bubbleVariant}`}>
                                                    <span className="meetings-transcript__time">[{timeString}]</span>
                                                    <span className="meetings-transcript__text">{seg.text}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {activeTab === "summary" && (
                                <div className="meetings-summary-layout">
                                    <div className="meetings-summary-block">
                                        <h3>AI Summary</h3>
                                        {!activeSummary ? (
                                            <div className="meetings-summary-empty">
                                                {isGeneratingSummary ? (
                                                    <p className="meetings-summary-empty__generating">Generating summary...</p>
                                                ) : (
                                                    <p className="meetings-summary-empty__hint">
                                                        End the meeting to generate a summary.
                                                    </p>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="meetings-summary-body">{activeSummary}</div>
                                        )}
                                    </div>

                                    <div className="meetings-qa-block">
                                        <div className="meetings-qa-header">
                                            <h4>Q&A</h4>
                                        </div>
                                        <div ref={chatScrollRef} className="meetings-qa-messages">
                                            {chatMessages.length === 0 ? (
                                                <p className="meetings-qa-messages__empty">Ask questions about the meeting here.</p>
                                            ) : (
                                                chatMessages.map(msg => (
                                                    <div
                                                        key={msg.id}
                                                        className={`meetings-qa-msg meetings-qa-msg--${msg.role}`}
                                                    >
                                                        {msg.content}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                        <form onSubmit={handleSendChatMessage} className="meetings-qa-form">
                                            <input
                                                type="text"
                                                className="meetings-qa-form__input"
                                                value={chatInput}
                                                onChange={e => setChatInput(e.target.value)}
                                                placeholder="Ask a question..."
                                                disabled={isSendingChat || isRecording}
                                            />
                                            <button
                                                type="submit"
                                                className="btn btn--primary"
                                                disabled={isSendingChat || !chatInput.trim() || isRecording}
                                            >
                                                Send
                                            </button>
                                        </form>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="meetings-empty-state">
                            Select a meeting to view transcripts.
                        </div>
                    )}
                </main>
            </div>

            {deleteConfirmId && (
                <div className="delete-modal-overlay" onClick={closeDeleteConfirm}>
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
                                onClick={closeDeleteConfirm}
                                disabled={!!deletingId}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="delete-modal-btn-delete"
                                onClick={handleConfirmDeleteMeeting}
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
                    <div
                        className="delete-modal-content"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3>End meeting?</h3>
                        <p>
                            The transcript will be finalized. Summary and title will generate in the background—you can keep using the app.
                            You won't be able to resume recording after this.
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
                                onClick={async () => {
                                    setIsEnding(true);
                                    const meetingId = activeMeetingId;
                                    try {
                                        if (isRecording) await stopRecording();
                                        setShowEndConfirm(false);
                                        setIsEnding(false);
                                        if (!meetingId) return;
                                        setIsGeneratingSummary(true);
                                        invoke<Meeting>("summarize_meeting", { meetingId })
                                            .then((updatedMeeting) => {
                                                setActiveSummary(updatedMeeting.summary || null);
                                                setMeetings(prev => prev.map(m => m.id === updatedMeeting.id ? updatedMeeting : m));
                                            })
                                            .catch((error) => {
                                                console.error("Failed to generate meeting summary:", error);
                                            })
                                            .finally(() => setIsGeneratingSummary(false));
                                    } catch (error) {
                                        console.error("Failed to end meeting:", error);
                                        setIsEnding(false);
                                        setShowEndConfirm(false);
                                    }
                                }}
                                disabled={isEnding}
                            >
                                {isEnding ? "Ending..." : "End Meeting"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
