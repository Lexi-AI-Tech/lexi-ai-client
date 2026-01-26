/**
 * RoomsPage Component
 *
 * Displays a list of rooms and allows creating new ones.
 */

import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Room } from "../types";
import { RoomLiveView } from "./RoomLiveView";

export const RoomsPage: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const result = await invoke<Room[]>("list_rooms");
      setRooms(result);
      setError(null);
    } catch (err: any) {
      console.error("Failed to fetch rooms:", err);
      setError(err.message || "Failed to fetch rooms");
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
      // Immediately open the new room
      setSelectedRoomId(room.id);
      fetchRooms();
    } catch (err: any) {
      console.error("Failed to create room:", err);
      alert(err.message || "Failed to create room");
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return (
        new Date(dateString).toLocaleDateString() +
        " " +
        new Date(dateString).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    } catch (e) {
      return dateString;
    }
  };

  if (selectedRoomId) {
    return (
      <RoomLiveView
        roomId={selectedRoomId}
        onBack={() => {
          setSelectedRoomId(null);
          fetchRooms(); // Refresh list on return
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
              width: "400px",
              border: "1px solid rgba(255, 255, 255, 0.1)",
            }}
          >
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
                  style={{
                    width: "100%",
                    padding: "8px",
                    marginTop: "8px",
                    backgroundColor: "#333",
                    border: "1px solid #444",
                    color: "white",
                    borderRadius: "4px",
                  }}
                />
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
        <div style={{ padding: "20px", textAlign: "center", opacity: 0.6 }}>
          Loading rooms...
        </div>
      ) : error ? (
        <div style={{ padding: "20px", color: "salmon" }}>{error}</div>
      ) : rooms.length === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", opacity: 0.6 }}>
          <p>No rooms found.</p>
          <p style={{ fontSize: "12px" }}>
            Create a room to start recording meetings.
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
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor =
                  "rgba(255, 255, 255, 0.1)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor =
                  "rgba(255, 255, 255, 0.05)")
              }
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "16px" }}>
                    {room.name}
                  </div>
                  <div
                    style={{ fontSize: "12px", opacity: 0.6, marginTop: "4px" }}
                  >
                    {formatDate(room.created_at)}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    padding: "2px 8px",
                    borderRadius: "10px",
                    backgroundColor:
                      room.status === "active"
                        ? "rgba(52, 199, 89, 0.2)"
                        : room.status === "processing"
                          ? "rgba(255, 193, 7, 0.2)"
                          : "rgba(255, 255, 255, 0.1)",
                    color:
                      room.status === "active"
                        ? "#34c759"
                        : room.status === "processing"
                          ? "#ffc107"
                          : "rgba(255, 255, 255, 0.6)",
                  }}
                >
                  {room.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
