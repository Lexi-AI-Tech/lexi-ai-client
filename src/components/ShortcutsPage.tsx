import React, { useEffect, useState } from "react";
import {
  getShortcuts,
  createShortcut,
  updateShortcut,
  deleteShortcut,
} from "../lib/apiClient";
import { SystemType } from "../lib/constants";
import type { Shortcut } from "../types";

export const ShortcutsPage: React.FC = () => {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateShortcut, setShowCreateShortcut] = useState(false);
  const [newShortcut, setNewShortcut] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editingShortcut, setEditingShortcut] = useState<Shortcut | null>(null);

  // Load shortcuts
  const loadShortcuts = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getShortcuts(SystemType.MAC);
      setShortcuts(data);
    } catch (err: any) {
      console.error("Failed to load shortcuts:", err);
      setError(err?.message || "Failed to load shortcuts");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadShortcuts();
  }, []);

  const handleCreateShortcut = async () => {
    if (!newShortcut.trim() || !newValue.trim()) {
      setError("Both shortcut and value are required");
      return;
    }

    try {
      setError(null);
      await createShortcut(
        {
          shortcut: newShortcut.trim(),
          value: newValue.trim(),
        },
        SystemType.MAC,
      );
      setNewShortcut("");
      setNewValue("");
      setShowCreateShortcut(false);
      await loadShortcuts();
    } catch (err: any) {
      setError(err?.message || "Failed to create shortcut");
    }
  };

  const handleUpdateShortcut = async (shortcut: Shortcut) => {
    if (!editingShortcut) {
      setEditingShortcut(shortcut);
      return;
    }

    if (editingShortcut.id !== shortcut.id) {
      setEditingShortcut(shortcut);
      return;
    }

    try {
      setError(null);
      await updateShortcut(
        shortcut.id,
        {
          shortcut: editingShortcut.shortcut,
          value: editingShortcut.value,
        },
        SystemType.MAC,
      );
      await loadShortcuts();
      setEditingShortcut(null);
    } catch (err: any) {
      setError(err?.message || "Failed to update shortcut");
    }
  };

  const handleDeleteShortcut = async (shortcutId: string) => {
    if (!confirm("Are you sure you want to delete this shortcut?")) {
      return;
    }

    try {
      setError(null);
      await deleteShortcut(shortcutId, SystemType.MAC);
      await loadShortcuts();
    } catch (err: any) {
      setError(err?.message || "Failed to delete shortcut");
    }
  };

  return (
    <div className="shortcuts-page">
      <h2
        style={{
          margin: 0,
          marginBottom: "32px",
          fontSize: "24px",
          fontWeight: 600,
          color: "#ffffff",
        }}
      >
        Shortcuts
      </h2>

      {error && (
        <div
          className="permission-message"
          style={{
            background: "rgba(255, 59, 48, 0.1)",
            borderColor: "rgba(255, 59, 48, 0.2)",
            color: "rgba(255, 59, 48, 0.9)",
            fontSize: "11px",
            padding: "12px",
            marginBottom: "16px",
            borderRadius: "6px",
          }}
        >
          {error}
        </div>
      )}

      {/* Shortcuts Section */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: "18px",
              fontWeight: 500,
              color: "#ffffff",
            }}
          >
            Custom Shortcuts
          </h3>
          <button
            className="transcript-btn"
            onClick={() => {
              setShowCreateShortcut(!showCreateShortcut);
              setNewShortcut("");
              setNewValue("");
            }}
            style={{
              padding: "6px 12px",
              fontSize: "11px",
            }}
          >
            {showCreateShortcut ? "Cancel" : "+ Add Shortcut"}
          </button>
        </div>

        {showCreateShortcut && (
          <div
            style={{
              padding: "16px",
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "6px",
              marginBottom: "16px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                color: "rgba(255, 255, 255, 0.6)",
                marginBottom: "8px",
              }}
            >
              Shortcut
            </div>
            <input
              type="text"
              value={newShortcut}
              onChange={(e) => setNewShortcut(e.target.value)}
              placeholder="e.g., 'hey lexi'"
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: "11px",
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "6px",
                color: "#ffffff",
                marginBottom: "12px",
              }}
            />
            <div
              style={{
                fontSize: "11px",
                color: "rgba(255, 255, 255, 0.6)",
                marginBottom: "8px",
              }}
            >
              Value
            </div>
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="e.g., 'Hello, this is Lexi'"
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: "11px",
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "6px",
                color: "#ffffff",
                marginBottom: "12px",
              }}
            />
            <button
              className="transcript-btn"
              onClick={handleCreateShortcut}
              style={{
                padding: "6px 12px",
                fontSize: "11px",
              }}
            >
              Create Shortcut
            </button>
          </div>
        )}

        {isLoading ? (
          <div
            style={{
              padding: "20px",
              textAlign: "center",
              color: "rgba(255, 255, 255, 0.6)",
              fontSize: "12px",
            }}
          >
            Loading shortcuts...
          </div>
        ) : shortcuts.length === 0 ? (
          <div
            style={{
              padding: "20px",
              textAlign: "center",
              color: "rgba(255, 255, 255, 0.6)",
              fontSize: "12px",
            }}
          >
            No shortcuts. Create one to get started.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {shortcuts.map((shortcut) => {
              const isEditing = editingShortcut?.id === shortcut.id;
              return (
                <div
                  key={shortcut.id}
                  style={{
                    padding: "12px",
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "6px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  {isEditing ? (
                    <>
                      <div>
                        <div
                          style={{
                            fontSize: "10px",
                            color: "rgba(255, 255, 255, 0.6)",
                            marginBottom: "4px",
                          }}
                        >
                          Shortcut
                        </div>
                        <input
                          type="text"
                          value={editingShortcut.shortcut}
                          onChange={(e) =>
                            setEditingShortcut({
                              ...editingShortcut,
                              shortcut: e.target.value,
                            })
                          }
                          style={{
                            width: "100%",
                            padding: "6px 10px",
                            fontSize: "11px",
                            backgroundColor: "rgba(255, 255, 255, 0.05)",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            borderRadius: "6px",
                            color: "#ffffff",
                          }}
                        />
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: "10px",
                            color: "rgba(255, 255, 255, 0.6)",
                            marginBottom: "4px",
                          }}
                        >
                          Value
                        </div>
                        <input
                          type="text"
                          value={editingShortcut.value}
                          onChange={(e) =>
                            setEditingShortcut({
                              ...editingShortcut,
                              value: e.target.value,
                            })
                          }
                          style={{
                            width: "100%",
                            padding: "6px 10px",
                            fontSize: "11px",
                            backgroundColor: "rgba(255, 255, 255, 0.05)",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            borderRadius: "6px",
                            color: "#ffffff",
                          }}
                        />
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          className="transcript-btn"
                          onClick={() => handleUpdateShortcut(shortcut)}
                          style={{
                            padding: "4px 8px",
                            fontSize: "10px",
                          }}
                        >
                          Save
                        </button>
                        <button
                          className="transcript-btn"
                          onClick={() => setEditingShortcut(null)}
                          style={{
                            padding: "4px 8px",
                            fontSize: "10px",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            fontSize: "13px",
                            color: "#ffffff",
                            fontWeight: 500,
                            marginBottom: "4px",
                          }}
                        >
                          {shortcut.shortcut}
                        </div>
                        <div
                          style={{
                            fontSize: "11px",
                            color: "rgba(255, 255, 255, 0.7)",
                            marginBottom: "4px",
                          }}
                        >
                          → {shortcut.value}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          className="transcript-btn"
                          onClick={() => handleUpdateShortcut(shortcut)}
                          style={{
                            padding: "4px 8px",
                            fontSize: "10px",
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="transcript-btn"
                          onClick={() => handleDeleteShortcut(shortcut.id)}
                          style={{
                            padding: "4px 8px",
                            fontSize: "10px",
                            backgroundColor: "rgba(255, 59, 48, 0.2)",
                            borderColor: "rgba(255, 59, 48, 0.3)",
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
