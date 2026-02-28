import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trash2 } from "lucide-react";
import { useAuthStore } from "../store/authStore";

interface TranscriptSegment {
    id: string;
    segment_index: number;
    start_time: string;
    end_time: string;
    text: string;
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
    onAutoStartConsumed?: () => void;
}

export const MeetingsPage: React.FC<MeetingsPageProps> = ({ autoStart, onAutoStartConsumed }) => {
    const { tokens } = useAuthStore();
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);

    // Tab state (Transcript vs Summary/QA)
    const [activeTab, setActiveTab] = useState<"transcript" | "summary">("transcript");

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
            const newMeeting = await invoke<Meeting>("create_meeting", {
                name: "Meeting Session",
                platform: null
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

    const startRecording = async (meetingId: string) => {
        if (!tokens?.access_token) return;
        setIsRecording(true);
        setActiveMeetingId(meetingId);

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

    const handleGenerateSummary = async () => {
        if (!activeMeetingId || isGeneratingSummary) return;

        setIsGeneratingSummary(true);
        try {
            const updatedMeeting = await invoke<Meeting>("summarize_meeting", { meetingId: activeMeetingId });

            // Update the locally cached active Summary
            setActiveSummary(updatedMeeting.summary || null);

            // Update the meeting list item so it technically persists globally
            setMeetings(prev => prev.map(m => m.id === updatedMeeting.id ? updatedMeeting : m));

        } catch (error) {
            console.error("Failed to generate meeting summary:", error);
            alert("Failed to generate meeting summary.");
        } finally {
            setIsGeneratingSummary(false);
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

            <div className="meetings-content" style={{ display: "flex", gap: "2rem", height: "calc(100vh - 120px)" }}>

                {/* Left Side: Meetings List */}
                <aside className="panel" style={{ width: "300px", display: "flex", flexDirection: "column", overflowY: "auto", padding: "16px" }}>
                    <div className="panel__label">Recent Meetings</div>
                    {meetings.length === 0 ? <p style={{ color: "#aaa", fontSize: "14px" }}>No captured meetings yet.</p> : null}

                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
                        {meetings.map((m) => {
                            // Ensure date is valid before formatting
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
                                    style={{
                                        padding: "16px",
                                        borderRadius: "8px",
                                        cursor: "pointer",
                                        position: "relative",
                                        border: activeMeetingId === m.id ? "1px solid #d1d5db" : "1px solid #e5e7eb",
                                        backgroundColor: activeMeetingId === m.id ? "#f9fafb" : "#ffffff",
                                        transition: "all 0.2s ease"
                                    }}
                                >
                                    <div style={{ fontWeight: 500, color: "#111827", marginBottom: "4px" }}>{m.name || "Untitled Meeting"}</div>
                                    <div style={{ fontSize: "12px", color: "#6b7280" }}>
                                        {m.platform || "Lexi AI"} • {dateStr} {timeStr}
                                    </div>
                                    <button
                                        onClick={(e) => openDeleteConfirm(e, m.id)}
                                        disabled={!!deletingId}
                                        style={{
                                            position: "absolute",
                                            top: "12px",
                                            right: "12px",
                                            padding: "6px",
                                            backgroundColor: "transparent",
                                            border: "none",
                                            borderRadius: "4px",
                                            cursor: deletingId ? "not-allowed" : "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            color: "#ef4444",
                                            transition: "all 0.2s ease",
                                            opacity: deletingId ? 0.6 : 1,
                                        }}
                                        title="Delete meeting"
                                        onMouseEnter={(e) => {
                                            if (!deletingId) {
                                                e.currentTarget.style.backgroundColor = "#fee2e2";
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!deletingId) {
                                                e.currentTarget.style.backgroundColor = "transparent";
                                            }
                                        }}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    <button
                        className="btn btn--secondary"
                        style={{ marginTop: "1rem", width: "100%" }}
                        onClick={handleCreateAndStartMeeting}
                        disabled={isRecording || isGeneratingSummary}
                    >
                        + Start New Meeting
                    </button>
                </aside>

                {/* Right Side: Live View */}
                <main className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", padding: "16px" }}>
                    {activeMeetingId ? (
                        <>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                                <div style={{ display: "flex", gap: "12px" }}>
                                    <button
                                        className={`btn ${activeTab === "transcript" ? "btn--primary" : ""}`}
                                        style={activeTab !== "transcript" ? { backgroundColor: "transparent", color: "#6b7280", border: "1px solid #d1d5db" } : {}}
                                        onClick={() => setActiveTab("transcript")}
                                    >
                                        Transcript
                                    </button>
                                    <button
                                        className={`btn ${activeTab === "summary" ? "btn--primary" : ""}`}
                                        style={activeTab !== "summary" ? { backgroundColor: "transparent", color: "#6b7280", border: "1px solid #d1d5db" } : {}}
                                        onClick={() => setActiveTab("summary")}
                                        disabled={isRecording}
                                    >
                                        Summary & Q/A
                                    </button>
                                </div>
                                {activeSummary ? (
                                    <div style={{ color: "#10b981", fontSize: "14px", fontWeight: 500 }}>
                                        Meeting Completed
                                    </div>
                                ) : (
                                    <div style={{ display: "flex", gap: "8px" }}>
                                        {isGeneratingSummary ? (
                                            <span style={{ color: "#3b82f6", fontSize: "14px", fontWeight: 500, marginRight: "1rem", alignSelf: "center" }}>
                                                Generating AI Summary...
                                            </span>
                                        ) : (
                                            <>
                                                <button
                                                    className={`btn ${!isRecording ? "btn--primary" : ""}`}
                                                    onClick={() => isRecording ? stopRecording() : startRecording(activeMeetingId)}
                                                    style={isRecording ? { backgroundColor: "#f59e0b", color: "white", padding: "6px 12px", border: "none", borderRadius: "6px" } : { padding: "6px 12px" }}
                                                >
                                                    {isRecording ? "Pause" : "Resume"}
                                                </button>
                                                <button
                                                    className="btn"
                                                    onClick={() => setShowEndConfirm(true)}
                                                    style={{ backgroundColor: "#ef4444", color: "white", padding: "6px 12px", border: "none", borderRadius: "6px" }}
                                                >
                                                    End
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            {activeTab === "transcript" && (
                                <div
                                    ref={scrollRef}
                                    style={{
                                        flex: 1,
                                        overflowY: "auto",
                                        backgroundColor: "#f9fafb",
                                        padding: "1.5rem",
                                        borderRadius: "8px",
                                        border: "1px solid #e5e7eb"
                                    }}
                                >
                                    {liveSegments.length === 0 ? (
                                        <p style={{ color: "#9ca3af", textAlign: "center", fontStyle: "italic", marginTop: "2rem" }}>
                                            {isRecording ? "Listening for speech..." : "Click Resume Capture to start."}
                                        </p>
                                    ) : null}

                                    {liveSegments.map((seg, idx) => {
                                        let timeString = "00:00:00";
                                        try {
                                            if (seg.start_time) {
                                                const d = new Date(seg.start_time);
                                                // Format as localized time depending on user OS preferences
                                                timeString = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                            }
                                        } catch (e) {
                                            // Ignore parsing errors and fallback
                                        }

                                        return (
                                            <div key={idx} style={{ marginBottom: "1rem", display: "flex", gap: "10px" }}>
                                                <span style={{ fontSize: "12px", color: "#6b7280", marginTop: "3px", minWidth: "90px" }}>
                                                    [{timeString}]
                                                </span>
                                                <span style={{ fontSize: "15px", lineHeight: "1.6", color: "#111827" }}>
                                                    {seg.text}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {activeTab === "summary" && (
                                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem", overflow: "hidden" }}>

                                    {/* Top Half: Summary */}
                                    <div style={{
                                        flex: 1,
                                        overflowY: "auto",
                                        backgroundColor: "#ffffff",
                                        padding: "1.5rem",
                                        borderRadius: "8px",
                                        border: "1px solid #e5e7eb",
                                        display: "flex",
                                        flexDirection: "column"
                                    }}>
                                        <h3 style={{ margin: "0 0 1rem 0", fontSize: "16px", color: "#111827" }}>AI Summary</h3>

                                        {!activeSummary ? (
                                            <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "1rem", textAlign: "center" }}>
                                                {isGeneratingSummary ? (
                                                    <p style={{ color: "#3b82f6", margin: 0 }}>Generating AI Summary...</p>
                                                ) : (
                                                    <p style={{ color: "#6b7280", margin: 0 }}>
                                                        No summary generated yet. Click "End" when the meeting is over to generate one.
                                                    </p>
                                                )}
                                            </div>
                                        ) : (
                                            <div style={{ whiteSpace: "pre-wrap", color: "#374151", fontSize: "14px", lineHeight: "1.6" }}>
                                                {activeSummary}
                                            </div>
                                        )}
                                    </div>

                                    {/* Bottom Half: Chat / Q&A */}
                                    <div style={{
                                        flex: 1,
                                        display: "flex",
                                        flexDirection: "column",
                                        backgroundColor: "#f9fafb",
                                        borderRadius: "8px",
                                        border: "1px solid #e5e7eb",
                                        overflow: "hidden"
                                    }}>
                                        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb", backgroundColor: "#f3f4f6" }}>
                                            <h4 style={{ margin: 0, fontSize: "14px", color: "#374151" }}>Meeting Q&A</h4>
                                        </div>

                                        <div ref={chatScrollRef} style={{ flex: 1, overflowY: "auto", padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
                                            {chatMessages.length === 0 ? (
                                                <p style={{ color: "#9ca3af", textAlign: "center", fontSize: "14px", marginTop: "auto", marginBottom: "auto" }}>
                                                    Ask questions about the meeting transcript here.
                                                </p>
                                            ) : (
                                                chatMessages.map(msg => (
                                                    <div
                                                        key={msg.id}
                                                        style={{
                                                            alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                                                            backgroundColor: msg.role === "user" ? "#3b82f6" : "#e5e7eb",
                                                            color: msg.role === "user" ? "white" : "#111827",
                                                            padding: "8px 12px",
                                                            borderRadius: "8px",
                                                            maxWidth: "80%",
                                                            fontSize: "14px",
                                                            lineHeight: "1.5"
                                                        }}
                                                    >
                                                        {msg.content}
                                                    </div>
                                                ))
                                            )}
                                        </div>

                                        <form onSubmit={handleSendChatMessage} style={{ padding: "1rem", borderTop: "1px solid #e5e7eb", display: "flex", gap: "8px" }}>
                                            <input
                                                type="text"
                                                value={chatInput}
                                                onChange={e => setChatInput(e.target.value)}
                                                placeholder="Ask a question..."
                                                style={{ flex: 1, padding: "8px 12px", borderRadius: "6px", border: "1px solid #d1d5db" }}
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
                        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af" }}>
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
                            The transcript will be finalized and AI will generate a title and summary automatically.
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
                                    try {
                                        if (isRecording) await stopRecording();
                                        await new Promise(r => setTimeout(r, 500));
                                        await handleGenerateSummary();
                                    } catch (error) {
                                        console.error("Failed to end meeting:", error);
                                    } finally {
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
