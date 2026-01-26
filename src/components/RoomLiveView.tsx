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
            // 1. Connect WebSocket
            // Default to localhost for dev if config missing, but better to use base url
            // We can't easily get the config base URL here without an invoke, assume logic or hardcode relative
            // Tauri apps usually know their backend. 
            // For now, let's try to construct it from a known constant or invoke 'get_app_config' if strictly needed.
            // But for simplicity, assuming localhost:8000 (standard for this project) or using the fetch logic.
            // Let's use a hardcoded dev URL or environment variable.

            const wsUrl = `ws://localhost:3000/api/v1/rooms/${roomId}/stream`;
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = async () => {
                console.log("WebSocket connected");

                // 2. Start Audio Recording (Rust)
                await invoke("start_room_recording");
                setIsRecording(true);

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
                            // We construct a temporary segment object. Ideally server sends ID, but we can mock for UI.
                            // Actually, server persists it asynchronously. We should trust the server's data or our constructed one.
                            // To avoid duplicates if we reload, we just append locally.

                            const words = data.words || [];
                            const startTime = words.length > 0 ? words[0].start : 0;
                            const endTime = words.length > 0 ? words[words.length - 1].end : 0;
                            const speaker = words.length > 0 && words[0].speaker ? `speaker_${words[0].speaker}` : "speaker_0";

                            const newSegment: RoomTranscriptSegment = {
                                id: Math.random().toString(), // temp id
                                segment_index: segments.length,
                                start_time: startTime,
                                end_time: endTime,
                                speaker_label: speaker,
                                text: data.transcript
                            };

                            setSegments(prev => [...prev, newSegment]);
                            setLiveTranscript(null); // Clear pending
                        } else {
                            // Partial
                            setLiveTranscript(data);
                        }
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
                await invoke("stop_room_recording_and_process", { roomId });
            } catch (e) { /* ignore */ }
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

        // Optionally refresh full list from DB to ensure sync
        // fetchRoomDetails(); 
    };

    const getSpeakerName = (label: string) => {
        return room?.speaker_map?.[label] || label.replace("speaker_", "Speaker ");
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

                <div>
                    {!isRecording ? (
                        <button
                            onClick={startRecording}
                            className="settings-button primary"
                            style={{ backgroundColor: "#34c759" }} // Green for start
                        >
                            Start Recording
                        </button>
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
                                    {new Date(seg.start_time * 1000).toISOString().substr(14, 5)}
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
        </div>
    );
};
