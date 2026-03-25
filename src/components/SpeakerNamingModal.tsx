/**
 * SpeakerNamingModal Component
 *
 * Allows users to assign names to detected speakers after recording.
 */

import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Room } from "../types";
import { useToast } from "./toast/useToast";

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
  const toast = useToast();
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
      toast.success("Speaker names saved");
    } catch (err) {
      console.error("Failed to save speaker names:", err);
      toast.error("Failed to save speaker names. Please try again.");
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
    <div className="modal-overlay">
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Name Speakers</h3>
        <p className="modal-content__desc">
          Assign names to the detected speakers. This will update all
          transcripts.
        </p>

        <div className="modal-speakers">
          {uniqueSpeakers.map((speakerLabel) => (
            <div key={speakerLabel} className="modal-speaker-card">
              <label>{speakerLabel}</label>
              <input
                type="text"
                className="form-input--dark"
                value={speakerNames[speakerLabel] || ""}
                onChange={(e) => handleNameChange(speakerLabel, e.target.value)}
                placeholder="Enter speaker name"
              />
              <div className="modal-speaker-sample">
                Sample: &quot;{getSampleText(speakerLabel).substring(0, 100)}
                ...&quot;
              </div>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
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
