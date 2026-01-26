/**
 * RoomLiveView Component
 *
 * Handles the live meeting experience:
 * - WebSocket connection to server for real-time transcription
 * - Audio capture via Tauri command
 * - Displaying transcripts with speaker labels
 */

import React, { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Room, RoomTranscriptSegment } from "../types";
import { SpeakerNamingModal } from "./SpeakerNamingModal";

interface RoomLiveViewProps {
    roomId: string;
    onBack: () => void;
}

interface StreamingTranscript {
    words: any[];
    transcript: string;
    is_final: boolean;
}

export const RoomLiveView: React.FC<RoomLiveViewProps> = ({ roomId, onBack }) => {
    const [room, setRoom] = useState<Room | null>(null);
    const [loading, setLoading] = useState(true);
    const [isRecording, setIsRecording] = useState(false);
    const [liveTranscript, setLiveTranscript] = useState<StreamingTranscript | null>(null);
    const [segments, setSegments] = useState<RoomTranscriptSegment[]>([]);
    const [showSpeakerNaming, setShowSpeakerNaming] = useState(false);
    const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Refs for cleanup
    const wsRef = useRef<WebSocket | null>(null);
    const unlistenRef = useRef<(() => void) | null>(null);

    // Load initial room data
    useEffect(() => {
        fetchRoomDetails();
        return () => {
            stopRecording(); // Cleanup on unmount
        };
    }, [roomId]);

    // Auto-scroll
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [segments, liveTranscript]);

    const fetchRoomDetails = async () => {
        try {
            setLoading(true);
            const data = await invoke<Room>("get_room_details", { roomId });
            setRoom(data);
            if (data.transcripts) {
                // Sort by start_time just in case
                const sorted = [...data.transcripts].sort((a, b) => a.start_time - b.start_time);
                setSegments(sorted);
            }
        } catch (err) {
            console.error("Failed to load room:", err);
        } finally {
            setLoading(false);
        }
    };

    const startRecording = async () => {
        if (isRecording) return;

        try {
            // 1. Get auth token and construct WebSocket URL
            const authToken = await invoke<string>("get_auth_token").catch(() => null);
            if (!authToken) {
                alert("Please sign in to start recording");
                return;
            }

            // Get API base URL from config
            const apiBaseUrl = await invoke<string>("get_api_base_url").catch(() => "http://localhost:3000");
            
            // Convert http/https to ws/wss
            const wsBaseUrl = apiBaseUrl.replace(/^http/, "ws");
            const wsUrl = `${wsBaseUrl}/api/v1/rooms/${roomId}/stream?token=${encodeURIComponent(authToken)}&provider=deepgram`;
            
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = async () => {
                console.log("WebSocket connected");

                // 2. Start Audio Recording (Rust)
                await invoke("start_room_recording");
                setIsRecording(true);
                setRecordingStartTime(Date.now());

                // 3. Listen for Audio Chunks from Rust
                // The event name must match what we emit in Rust ("audio-chunk")
                unlistenRef.current = await listen<number[]>("audio-chunk", (event) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        // Convert to Uint8Array and send
                        const bytes = new Uint8Array(event.payload);
                        ws.send(bytes);
                    }
                });
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === "transcript") {
                        if (data.is_final) {
                            // Final segment received - append to list
                            const words = data.words || [];
                            
                            // Deepgram format (timing in seconds, speaker per word)
                            let startTime = 0;
                            let endTime = 0;
                            let speaker = 0;
                            
                            if (words.length > 0) {
                                // Deepgram provides timing in seconds in words array
                                startTime = words[0].start || 0;
                                endTime = words[words.length - 1].end || 0;
                                // Use speaker from result (dominant speaker) or from first word
                                speaker = data.speaker !== undefined ? data.speaker : (words[0].speaker || 0);
                            }

                            const newSegment: RoomTranscriptSegment = {
                                id: Math.random().toString(), // temp id
                                segment_index: segments.length,
                                start_time: startTime,
                                end_time: endTime,
                                speaker_label: `speaker_${speaker}`,
                                text: data.transcript
                            };

                            setSegments(prev => [...prev, newSegment]);
                            setLiveTranscript(null); // Clear pending
                        } else {
                            // Partial/interim transcript
                            setLiveTranscript(data);
                        }
                    } else if (data.type === "error") {
                        console.error("WebSocket error:", data.message);
                        alert(`Transcription error: ${data.message}`);
                        stopRecording();
                    } else if (data.type === "session_start") {
                        console.log("Transcription session started:", data.session_id);
                    } else if (data.type === "session_end") {
                        console.log("Transcription session ended:", data.reason);
                    }
                } catch (e) {
                    console.error("Error parsing WS message:", e);
                }
            };

            ws.onclose = () => {
                console.log("WebSocket disconnected");
                stopRecording();
            };

            ws.onerror = (e) => {
                console.error("WebSocket error:", e);
                stopRecording();
            };

        } catch (err) {
            console.error("Failed to start recording:", err);
            alert("Failed to start recording");
            stopRecording();
        }
    };

    const stopRecording = async () => {
        // Stop Rust recording
        if (isRecording) {
            try {
                // Send stop message to WebSocket
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: "stop" }));
                }
                
                await invoke("stop_room_recording_and_process", { roomId });
                
                // Finalize room
                try {
                    await invoke("finalize_room", { roomId });
                } catch (e) {
                    console.error("Failed to finalize room:", e);
                }
            } catch (e) { 
                console.error("Error stopping recording:", e);
            }
        }

        // Unlisten tauri event
        if (unlistenRef.current) {
            unlistenRef.current();
            unlistenRef.current = null;
        }

        // Close WebSocket
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        setIsRecording(false);
        setLiveTranscript(null);
        setRecordingStartTime(null);

        // Refresh room details to get latest transcripts
        await fetchRoomDetails();
        
        // Show speaker naming modal if there are transcripts
        if (segments.length > 0) {
            setShowSpeakerNaming(true);
        }
    };

    const handleExportTranscript = async () => {
        try {
            const exportData = await invoke<any[]>("export_room_transcript", { roomId });
            
            // Create download
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${room?.name || "transcript"}_${new Date().toISOString().split("T")[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Failed to export transcript:", err);
            alert("Failed to export transcript. Please try again.");
        }
    };

    const getSpeakerName = (label: string) => {
        return room?.speaker_map?.[label] || label.replace("speaker_", "Speaker ");
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    if (loading && !room) {
        return <div style={{ padding: 20 }}>Loading room...</div>;
    }

    return (
        <div className="room-live-view" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Header */}
            <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.1)"
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button onClick={onBack} className="icon-button" style={{ background: "none", border: "none", color: "white", cursor: "pointer" }}>
                        ←
                    </button>
                    <h2 style={{ margin: 0, fontSize: "18px" }}>{room?.name}</h2>
                    <span style={{
                        fontSize: "12px", padding: "2px 8px", borderRadius: "10px",
                        backgroundColor: isRecording ? "rgba(255, 59, 48, 0.2)" : "rgba(255, 255, 255, 0.1)",
                        color: isRecording ? "#ff3b30" : "rgba(255, 255, 255, 0.6)"
                    }}>
                        {isRecording ? "● Live" : room?.status}
                    </span>
                </div>

                <div style={{ display: "flex", gap: "12px" }}>
                    {!isRecording ? (
                        <>
                            {segments.length > 0 && (
                                <>
                                    <button
                                        onClick={() => setShowSpeakerNaming(true)}
                                        className="settings-button"
                                        style={{ fontSize: "12px", padding: "6px 12px" }}
                                    >
                                        Name Speakers
                                    </button>
                                    <button
                                        onClick={handleExportTranscript}
                                        className="settings-button"
                                        style={{ fontSize: "12px", padding: "6px 12px" }}
                                    >
                                        Export
                                    </button>
                                </>
                            )}
                            <button
                                onClick={startRecording}
                                className="settings-button primary"
                                style={{ backgroundColor: "#34c759" }} // Green for start
                            >
                                Start Recording
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={stopRecording}
                            className="settings-button"
                            style={{ backgroundColor: "#ff3b30", color: "white", border: "none" }} // Red for stop
                        >
                            Stop Recording
                        </button>
                    )}
                </div>
            </div>

            {/* Transcript Area */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "24px", maxWidth: "800px", margin: "0 auto" }}>

                    {segments.map((seg, idx) => (
                        <div key={seg.id || idx} style={{ display: "flex", gap: "16px" }}>
                            <div style={{ minWidth: "100px", fontSize: "13px", color: "rgba(255,255,255,0.5)", marginTop: "4px" }}>
                                <div>{getSpeakerName(seg.speaker_label)}</div>
                                <div style={{ fontSize: "11px", opacity: 0.7 }}>
                                    {formatTime(seg.start_time)}
                                </div>
                            </div>
                            <div style={{ flex: 1, lineHeight: 1.5, fontSize: "15px" }}>
                                {seg.text}
                            </div>
                        </div>
                    ))}

                    {/* Live Segment */}
                    {liveTranscript && (
                        <div style={{ display: "flex", gap: "16px", opacity: 0.7 }}>
                            <div style={{ minWidth: "100px", fontSize: "13px", color: "rgba(255,255,255,0.5)", marginTop: "4px" }}>
                                <div>...</div>
                            </div>
                            <div style={{ flex: 1, lineHeight: 1.5, fontSize: "15px", fontStyle: "italic" }}>
                                {liveTranscript.transcript}
                            </div>
                        </div>
                    )}

                    <div ref={chatEndRef} />
                </div>
            </div>

            {showSpeakerNaming && room && (
                <SpeakerNamingModal
                    room={room}
                    onClose={() => setShowSpeakerNaming(false)}
                    onSave={(updatedRoom) => {
                        setRoom(updatedRoom);
                        setShowSpeakerNaming(false);
                    }}
                />
            )}
        </div>
    );
};
