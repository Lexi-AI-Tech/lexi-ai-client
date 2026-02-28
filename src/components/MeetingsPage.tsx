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
    transcripts?: TranscriptSegment[];
}
const APP_PLATFORM_NAME = "Lexi AI";

export const MeetingsPage: React.FC = () => {
    const { tokens } = useAuthStore();
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);

    // Real-time state
    const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);
    const [isRecording, setIsRecording] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Deletion state
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

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
            } catch (error) {
                console.error("Failed to fetch meeting details:", error);
                setLiveSegments([]);
            }
        };

        if (activeMeetingId && !isRecording) {
            fetchMeetingDetails();
        }
    }, [activeMeetingId, isRecording]);

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
            const meetingName = `Meeting - ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            const newMeeting = await invoke<Meeting>("create_meeting", {
                name: meetingName,
                platform: APP_PLATFORM_NAME
            });

            // Add to list immediately
            setMeetings(prev => [newMeeting, ...prev]);

            // Start recording automatically
            await startRecording(newMeeting.id);
        } catch (error) {
            console.error("Failed to create new meeting:", error);
        }
    };

    const startRecording = async (meetingId: string) => {
        if (!tokens?.access_token) return;
        setIsRecording(true);
        setActiveMeetingId(meetingId);
        setLiveSegments([]);

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
                                        {m.platform || APP_PLATFORM_NAME} • {dateStr} {timeStr}
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
                    >
                        + Start New Meeting
                    </button>
                </aside>

                {/* Right Side: Live View */}
                <main className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", padding: "16px" }}>
                    {activeMeetingId ? (
                        <>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                                <div className="panel__label" style={{ margin: 0 }}>Live Transcript - {activeMeetingId}</div>
                                {isRecording ? (
                                    <button
                                        className="btn"
                                        onClick={stopRecording}
                                        style={{ backgroundColor: "#ef4444", color: "white", padding: "6px 12px", border: "none", borderRadius: "6px" }}
                                    >
                                        Stop Capture
                                    </button>
                                ) : (
                                    <button
                                        className="btn btn--primary"
                                        onClick={() => startRecording(activeMeetingId)}
                                    >
                                        Resume Capture
                                    </button>
                                )}
                            </div>

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
        </div>
    );
};
