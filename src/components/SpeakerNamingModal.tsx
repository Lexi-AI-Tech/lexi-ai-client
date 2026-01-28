/**
 * SpeakerNamingModal Component
 *
 * Allows users to assign names to detected speakers after recording.
 */

import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Room, RoomTranscriptSegment } from "../types";

interface SpeakerNamingModalProps {
  room: Room;
  onClose: () => void;
  onSave: (updatedRoom: Room) => void;
}

export const SpeakerNamingModal: React.FC<SpeakerNamingModalProps> = ({
  room,
  onClose,
  onSave,
}) => {
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Extract unique speakers from transcripts
  const uniqueSpeakers = React.useMemo(() => {
    const speakers = new Set<string>();
    room.transcripts?.forEach((seg) => {
      speakers.add(seg.speaker_label);
    });
    return Array.from(speakers).sort();
  }, [room.transcripts]);

  // Initialize with existing speaker_map or default names
  useEffect(() => {
    const initial: Record<string, string> = {};
    uniqueSpeakers.forEach((label) => {
      initial[label] =
        room.speaker_map?.[label] || label.replace("speaker_", "Speaker ");
    });
    setSpeakerNames(initial);
  }, [uniqueSpeakers, room.speaker_map]);

  const handleNameChange = (speakerLabel: string, newName: string) => {
    setSpeakerNames((prev) => ({
      ...prev,
      [speakerLabel]: newName,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Update each speaker name
      // Update speaker names in bulk
      await invoke("update_speaker", {
        roomId: room.id,
        speakerMap: speakerNames,
      });

      // Fetch updated room
      const updatedRoom = await invoke<Room>("get_room_details", {
        roomId: room.id,
      });
      onSave(updatedRoom);
      onClose();
    } catch (err) {
      console.error("Failed to save speaker names:", err);
      alert("Failed to save speaker names. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Get sample text for each speaker
  const getSampleText = (speakerLabel: string): string => {
    const sample = room.transcripts?.find(
      (seg) => seg.speaker_label === speakerLabel,
    );
    return sample?.text || "No transcript available";
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        zIndex: 1000,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        className="modal-content"
        style={{
          backgroundColor: "#1e1e1e",
          padding: "24px",
          borderRadius: "12px",
          width: "600px",
          maxHeight: "80vh",
          overflowY: "auto",
          border: "1px solid rgba(255, 255, 255, 0.1)",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: "20px" }}>Name Speakers</h3>
        <p style={{ fontSize: "13px", opacity: 0.7, marginBottom: "24px" }}>
          Assign names to the detected speakers. This will update all
          transcripts.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {uniqueSpeakers.map((speakerLabel) => (
            <div
              key={speakerLabel}
              style={{
                padding: "16px",
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                borderRadius: "8px",
              }}
            >
              <label
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontSize: "13px",
                  opacity: 0.8,
                }}
              >
                {speakerLabel}
              </label>
              <input
                type="text"
                value={speakerNames[speakerLabel] || ""}
                onChange={(e) => handleNameChange(speakerLabel, e.target.value)}
                placeholder="Enter speaker name"
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "#333",
                  border: "1px solid #444",
                  color: "white",
                  borderRadius: "4px",
                  fontSize: "14px",
                }}
              />
              <div
                style={{
                  marginTop: "8px",
                  fontSize: "12px",
                  opacity: 0.6,
                  fontStyle: "italic",
                }}
              >
                Sample: "{getSampleText(speakerLabel).substring(0, 100)}..."
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
            marginTop: "24px",
          }}
        >
          <button
            type="button"
            className="settings-button"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="settings-button primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Names"}
          </button>
        </div>
      </div>
    </div>
  );
};
