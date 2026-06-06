/**
 * RoomsPage Component
 *
 * Lists rooms and allows creating/opening a room.
 */

import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Room } from "../types";
import { RoomLiveView } from "./RoomLiveView";
import { useToast } from "./toast/useToast";
import { PageLoader } from "./ui/PageLoader";
import { formatAppDateTime } from "../lib/dateUtils";

export const RoomsPage: React.FC = () => {
  const toast = useToast();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const result = await invoke<Room[]>("list_rooms");
      setRooms(result);
    } catch (err: any) {
      console.error("Failed to fetch rooms:", err);
      toast.error(err?.message || "Failed to fetch rooms");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
  }, []);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    try {
      const room = await invoke<Room>("create_room", { name: newRoomName });
      setNewRoomName("");
      setShowCreateModal(false);
      setSelectedRoomId(room.id);
      fetchRooms();
      toast.success("Room created");
    } catch (err: any) {
      console.error("Failed to create room:", err);
      toast.error(err?.message || "Failed to create room");
    }
  };

  if (selectedRoomId) {
    return (
      <RoomLiveView
        roomId={selectedRoomId}
        onBack={() => {
          setSelectedRoomId(null);
          fetchRooms();
        }}
      />
    );
  }

  return (
    <div className="settings">
      <div
        className="settings-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h3>Rooms</h3>
        <button
          className="settings-button primary"
          onClick={() => setShowCreateModal(true)}
          style={{ fontSize: "12px", padding: "6px 12px" }}
        >
          + New Room
        </button>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: 420 }}>
            <h4 style={{ marginTop: 0 }}>Create New Room</h4>
            <form onSubmit={handleCreateRoom}>
              <div className="form-group">
                <label>Room Name</label>
                <input
                  type="text"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="e.g. Weekly Sync"
                  autoFocus
                  style={{ width: "100%", marginTop: 8 }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 16 }}>
                <button
                  type="button"
                  className="settings-button"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="settings-button primary">
                  Create & Start
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading && rooms.length === 0 ? (
        <PageLoader />
      ) : rooms.length === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", opacity: 0.6 }}>
          <p>No rooms found.</p>
          <p style={{ fontSize: "12px" }}>
            Create a room to start recording.
          </p>
        </div>
      ) : (
        <div
          className="rooms-list"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            marginTop: "16px",
          }}
        >
          {rooms.map((room) => (
            <div
              key={room.id}
              className="room-item"
              onClick={() => setSelectedRoomId(room.id)}
              style={{
                padding: "16px",
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                borderRadius: "8px",
                cursor: "pointer",
                border: "1px solid rgba(255, 255, 255, 0.05)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "16px" }}>{room.name}</div>
                  <div style={{ fontSize: "12px", opacity: 0.6, marginTop: 4 }}>
                    {formatAppDateTime(room.created_at)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

