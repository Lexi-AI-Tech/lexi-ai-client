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
  starttime?: number;
  endtime?: number;
  text: string;
  speaker?: number;
}

export const RoomLiveView: React.FC<RoomLiveViewProps> = ({
  roomId,
  onBack,
}) => {
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] =
    useState<StreamingTranscript | null>(null);
  const [segments, setSegments] = useState<RoomTranscriptSegment[]>([]);
  const [showSpeakerNaming, setShowSpeakerNaming] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(
    null,
  );
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Refs for cleanup
  const transcriptUnlistenRef = useRef<(() => void) | null>(null);
  const errorUnlistenRef = useRef<(() => void) | null>(null);

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
        const sorted = [...data.transcripts].sort(
          (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
        );
        setSegments(sorted);
      }
    } catch (err) {
      console.error("Failed to load room:", err);
    } finally {
      setLoading(false);
    }
  };

  const stopRecording = async () => {
    // Stop Rust recording (handles WebSocket cleanup)
    if (isRecording) {
      try {
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

    // Unlisten Tauri events
    if (transcriptUnlistenRef.current) {
      transcriptUnlistenRef.current();
      transcriptUnlistenRef.current = null;
    }
    if (errorUnlistenRef.current) {
      errorUnlistenRef.current();
      errorUnlistenRef.current = null;
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

  const startRecording = async () => {
    if (isRecording) return;

    try {
      // 1. Setup listeners FIRST before triggering the backend action
      // This prevents race conditions where backend emits events before frontend is listneing
      console.log("🎧 Setting up 'room-transcript' event listener...");

      // Clear existing listener if any
      if (transcriptUnlistenRef.current) {
        transcriptUnlistenRef.current();
        transcriptUnlistenRef.current = null;
      }

      transcriptUnlistenRef.current = await listen<any>(
        "room-transcript",
        (event) => {
          console.log("📥 Received transcript event from Tauri:", event);
          const data = event.payload;

          // Debug payload structure
          if (!data) {
            console.error("❌ Received null/undefined payload");
            return;
          }

          // Robust validation
          // Check type match
          const isTranscript = data.type === "transcript";
          // Check text exists (allow empty string technically, but usually we want content)
          const hasText = typeof data.text === "string";
          // Check speaker exists (handle 0, null, undefined)
          // Note: We accept null/undefined speaker and default to 0

          if (isTranscript && hasText) {
            const newSegment: RoomTranscriptSegment = {
              id: Math.random().toString(), // temp id
              segment_index: segments.length,
              start_time: data.start_time ?? new Date().toISOString(),
              end_time: data.end_time ?? new Date().toISOString(),
              speaker_label: `speaker_${data.speaker_id ?? 0}`,
              text: data.text,
            };

            console.log("✅ Adding segment to UI:", newSegment);
            setSegments((prev) => {
              const updated = [...prev, newSegment];
              console.log(`📊 Segments updated: ${prev.length} -> ${updated.length}`);
              return updated;
            });
            setLiveTranscript(null); // Clear pending
          } else {
            console.warn("⚠️ Invalid transcript data:", {
              type: data.type,
              hasText,
              text: data.text
            });
          }
        },
      );
      console.log("✅ Transcript listener set up successfully");

      // Listen for WebSocket errors
      if (errorUnlistenRef.current) {
        errorUnlistenRef.current();
        errorUnlistenRef.current = null;
      }

      errorUnlistenRef.current = await listen<string>(
        "room-websocket-error",
        (event) => {
          console.error("WebSocket error:", event.payload);
          alert(`Transcription error: ${event.payload}`);
          stopRecording();
        },
      );

      // 2. Start recording - Rust backend handles WebSocket connection
      // Language is read from app config
      console.log("🚀 Invoking start_room_recording...");
      await invoke("start_room_recording", { roomId });
      setIsRecording(true);
      setRecordingStartTime(Date.now());
      console.log("✅ Recording started successfully");

    } catch (err) {
      console.error("Failed to start recording:", err);
      alert(`Failed to start recording: ${err}`);
      stopRecording();
    }
  };

  const handleExportTranscript = async () => {
    try {
      const exportData = await invoke<any[]>("export_room_transcript", {
        roomId,
      });

      // Create download
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
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

  const formatTime = (isoString: string) => {
    // Parse ISO string to gets absolute seconds, but usually for UI we just show HH:MM:SS or MM:SS
    // However, the previous logic assumed relative seconds. 
    // If we want relative time from room start, we'd need room start time.
    // For now, let's just parse the Date and show local time HH:MM:SS
    try {
      if (!isoString) return "00:00";
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return "00:00";
      return date.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch (e) {
      return "00:00";
    }
  };

  if (loading && !room) {
    return <div style={{ padding: 20 }}>Loading room...</div>;
  }

  return (
    <div
      className="room-live-view"
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onBack}
            className="icon-button"
            style={{
              background: "none",
              border: "none",
              color: "white",
              cursor: "pointer",
            }}
          >
            ←
          </button>
          <h2 style={{ margin: 0, fontSize: "18px" }}>{room?.name}</h2>
          <span
            style={{
              fontSize: "12px",
              padding: "2px 8px",
              borderRadius: "10px",
              backgroundColor: isRecording
                ? "rgba(255, 59, 48, 0.2)"
                : "rgba(255, 255, 255, 0.1)",
              color: isRecording ? "#ff3b30" : "rgba(255, 255, 255, 0.6)",
            }}
          >
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
              style={{
                backgroundColor: "#ff3b30",
                color: "white",
                border: "none",
              }} // Red for stop
            >
              Stop Recording
            </button>
          )}
        </div>
      </div>

      {/* Transcript Area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxWidth: "800px",
            margin: "0 auto",
          }}
        >
          {segments.map((seg, idx) => (
            <div
              key={seg.id || idx}
              style={{
                padding: "12px 0",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <div style={{ fontSize: "15px", lineHeight: 1.6 }}>
                <span
                  style={{
                    color: "rgba(255,255,255,0.7)",
                    fontWeight: 500,
                    marginRight: "8px",
                  }}
                >
                  {getSpeakerName(seg.speaker_label)} →
                </span>
                <span style={{ color: "rgba(255,255,255,0.9)" }}>
                  {seg.text}
                </span>
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "rgba(255,255,255,0.4)",
                  marginTop: "4px",
                }}
              >
                {formatTime(seg.start_time)}
              </div>
            </div>
          ))}

          {/* Live Segment */}
          {liveTranscript && (
            <div
              style={{
                padding: "12px 0",
                opacity: 0.7,
                borderBottom: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <div style={{ fontSize: "15px", lineHeight: 1.6 }}>
                <span
                  style={{
                    color: "rgba(255,255,255,0.7)",
                    fontWeight: 500,
                    marginRight: "8px",
                    fontStyle: "italic",
                  }}
                >
                  {liveTranscript.speaker !== undefined
                    ? `${getSpeakerName(`speaker_${liveTranscript.speaker}`)} →`
                    : "... →"}
                </span>
                <span
                  style={{
                    color: "rgba(255,255,255,0.9)",
                    fontStyle: "italic",
                  }}
                >
                  {liveTranscript.text}
                </span>
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
