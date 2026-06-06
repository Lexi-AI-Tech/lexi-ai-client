/**
 * RoomLiveView Component
 *
 * Displays a live room transcription stream and basic controls.
 */

import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Room } from "../types";
import { useToast } from "./toast/useToast";
import { SpeakerNamingModal } from "./SpeakerNamingModal";

interface RoomLiveViewProps {
  roomId: string;
  onBack: () => void;
}

type TranscriptMsg = {
  type: string;
  text?: string | null;
  speaker_id?: number | null;
  message_type?: string | null;
};

export const RoomLiveView: React.FC<RoomLiveViewProps> = ({ roomId, onBack }) => {
  const toast = useToast();
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [liveTranscripts, setLiveTranscripts] = useState<TranscriptMsg[]>([]);
  const [showSpeakerModal, setShowSpeakerModal] = useState(false);

  const speakerMap = useMemo(() => (room?.speaker_map as any) || {}, [room?.speaker_map]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await invoke<Room>("get_room_details", { roomId });
      setRoom(data);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to load room");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [roomId]);

  useEffect(() => {
    let unlistenTranscript: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;
    let unlistenStarted: (() => void) | null = null;
    let unlistenStopped: (() => void) | null = null;

    (async () => {
      unlistenTranscript = await listen<TranscriptMsg>("room-transcript", (e) => {
        setLiveTranscripts((prev) => [...prev, e.payload]);
      });
      unlistenError = await listen<string>("room-websocket-error", (e) => {
        toast.error(e.payload || "Room stream error");
      });
      unlistenStarted = await listen("room-recording-started", () => setRecording(true));
      unlistenStopped = await listen("room-recording-stopped", () => setRecording(false));
    })();

    return () => {
      unlistenTranscript?.();
      unlistenError?.();
      unlistenStarted?.();
      unlistenStopped?.();
    };
  }, [toast]);

  const start = async () => {
    try {
      setLiveTranscripts([]);
      await invoke("start_room_recording", { roomId });
      setRecording(true);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to start recording");
    }
  };

  const stop = async () => {
    try {
      await invoke("stop_room_recording_and_process");
      setRecording(false);
      // Refresh details after stopping so persisted segments show up
      await load();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to stop recording");
    }
  };

  const labelForSpeaker = (speakerId?: number | null) => {
    const key = `speaker_${speakerId ?? 0}`;
    const name = speakerMap?.[key];
    return name ? `${name}` : key;
  };

  return (
    <div className="settings">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button className="settings-button" onClick={onBack}>
          Back
        </button>
        <div style={{ fontWeight: 600 }}>{room?.name || "Room"}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="settings-button" onClick={() => setShowSpeakerModal(true)} disabled={!room}>
            Name speakers
          </button>
          {!recording ? (
            <button className="settings-button primary" onClick={start} disabled={loading}>
              Start
            </button>
          ) : (
            <button className="settings-button" onClick={stop}>
              Stop
            </button>
          )}
        </div>
      </div>

      {loading && <div style={{ opacity: 0.7, marginTop: 12 }}>Loading…</div>}

      <div style={{ marginTop: 16 }}>
        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 8 }}>Live</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {liveTranscripts.slice(-50).map((t, idx) => (
            <div key={idx} style={{ padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.05)" }}>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
                {labelForSpeaker(t.speaker_id ?? 0)}
              </div>
              <div>{t.text || ""}</div>
            </div>
          ))}
          {liveTranscripts.length === 0 && (
            <div style={{ opacity: 0.6, fontSize: 12 }}>No live transcript yet.</div>
          )}
        </div>
      </div>

      {showSpeakerModal && room && (
        <SpeakerNamingModal
          room={room}
          onClose={() => setShowSpeakerModal(false)}
          onUpdated={(r) => setRoom(r)}
        />
      )}
    </div>
  );
};

