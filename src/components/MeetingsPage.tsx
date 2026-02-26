import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
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

export const MeetingsPage: React.FC = () => {
    const { tokens } = useAuthStore();
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);

    // Real-time state
    const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);
    const [isRecording, setIsRecording] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // 1. Fetch historical meetings
    useEffect(() => {
        const fetchMeetings = async () => {
            // NOTE: Normally use a fetch tool or axios configured with API_URL
            // const res = await fetchClient.get(`/api/v1/meetings`);
            // setMeetings(res.data);
        };
        fetchMeetings();
    }, []);

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

    return (
        <div className="meetings-page">
            <header className="page-header">
                <h1>Meetings</h1>
                <p>Live Transcription</p>
            </header>

            <div className="meetings-content" style={{ display: "flex", gap: "2rem", height: "calc(100vh - 120px)" }}>

                {/* Left Side: Meetings List */}
                <aside className="meetings-sidebar" style={{ width: "300px", borderRight: "1px solid #eee", overflowY: "auto" }}>
                    <h2>Recent Meetings</h2>
                    {meetings.length === 0 ? <p>No captured meetings yet.</p> : null}
                    {meetings.map((m) => (
                        <div
                            key={m.id}
                            className={`meeting-item ${activeMeetingId === m.id ? "active" : ""}`}
                            onClick={() => setActiveMeetingId(m.id)}
                            style={{ padding: "12px", cursor: "pointer", borderBottom: "1px solid #f0f0f0", background: activeMeetingId === m.id ? "#f5f5f5" : "transparent" }}
                        >
                            <h4>{m.name}</h4>
                            <small>{m.platform || "Unknown"} • {new Date(m.created_at).toLocaleDateString()}</small>
                        </div>
                    ))}
                    <button
                        style={{ width: "100%", marginTop: "1rem" }}
                        onClick={() => startRecording("new-uuid-here")} // Mocking
                    >
                        + Start Fake Meeting
                    </button>
                </aside>

                {/* Right Side: Live View */}
                <main className="meeting-live-view" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                    {activeMeetingId ? (
                        <>
                            <div className="live-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                                <h2>Live Transcript - {activeMeetingId}</h2>
                                {isRecording ? (
                                    <button onClick={stopRecording} style={{ background: "#ff4d4f", color: "white" }}>
                                        Stop Capture
                                    </button>
                                ) : (
                                    <button onClick={() => startRecording(activeMeetingId)} style={{ background: "#52c41a", color: "white" }}>
                                        Resume Capture
                                    </button>
                                )}
                            </div>

                            <div className="transcript-box" ref={scrollRef} style={{ flex: 1, overflowY: "auto", background: "#fafafa", padding: "1.5rem", borderRadius: "8px", border: "1px solid #e8e8e8" }}>
                                {liveSegments.length === 0 ? (
                                    <p style={{ color: "#aaa", textAlign: "center", fontStyle: "italic", marginTop: "2rem" }}>
                                        {isRecording ? "Listening for speech..." : "Click Resume Capture to start."}
                                    </p>
                                ) : null}

                                {liveSegments.map((seg, idx) => (
                                    <div key={idx} className="transcript-segment" style={{ marginBottom: "1rem" }}>
                                        <span style={{ fontSize: "0.8rem", color: "#888", marginRight: "8px" }}>
                                            [{seg.start_time.split("T")[1].substring(0, 8)}]
                                        </span>
                                        <span style={{ fontSize: "1rem", lineHeight: "1.5" }}>{seg.text}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa" }}>
                            Select a meeting to view transcripts.
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};
