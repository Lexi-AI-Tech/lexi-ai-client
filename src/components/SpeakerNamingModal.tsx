/**
 * SpeakerNamingModal Component
 *
 * Lets the user map diarization speaker labels (e.g. speaker_0) to human-friendly names.
 */

import React, { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Room } from "../types";
import { useToast } from "./toast/useToast";

interface SpeakerNamingModalProps {
  room: Room;
  onClose: () => void;
  onUpdated: (room: Room) => void;
}

export const SpeakerNamingModal: React.FC<SpeakerNamingModalProps> = ({
  room,
  onClose,
  onUpdated,
}) => {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const speakerKeys = useMemo(() => {
    const map = room.speaker_map || {};
    return Object.keys(map).sort();
  }, [room.speaker_map]);

  const [localMap, setLocalMap] = useState<Record<string, string>>(() => {
    const raw = room.speaker_map || {};
    const out: Record<string, string> = {};
    for (const k of Object.keys(raw)) out[k] = String((raw as any)[k] ?? "");
    return out;
  });

  const save = async () => {
    setSaving(true);
    try {
      const updated = await invoke<Room>("update_speaker", {
        roomId: room.id,
        speakerMap: localMap,
      });
      onUpdated(updated);
      toast.success("Speakers updated");
      onClose();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to update speakers");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ width: 520 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h4 style={{ marginTop: 0 }}>Name speakers</h4>
          <button className="settings-button" onClick={onClose}>
            Close
          </button>
        </div>

        {speakerKeys.length === 0 ? (
          <div style={{ opacity: 0.7, fontSize: 12 }}>
            No speakers detected yet. Start recording to generate speakers.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {speakerKeys.map((k) => (
              <div
                key={k}
                style={{ display: "flex", alignItems: "center", gap: 12 }}
              >
                <div style={{ width: 120, opacity: 0.8, fontSize: 12 }}>{k}</div>
                <input
                  value={localMap[k] || ""}
                  onChange={(e) =>
                    setLocalMap((m) => ({ ...m, [k]: e.target.value }))
                  }
                  placeholder="e.g. Alice"
                  style={{ flex: 1 }}
                />
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 16 }}>
          <button className="settings-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="settings-button primary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};

