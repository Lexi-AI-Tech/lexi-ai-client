import React, { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Mic, Search, LayoutGrid, RefreshCw, Edit, Trash2, X } from "lucide-react";
import { Note, PaginatedNotesResponse } from "../types";

type ViewMode = "list" | "grid";

export const NotesPage: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Form state
  const [content, setContent] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    fetchNotes();
  }, []);

  const fetchNotes = async () => {
    try {
      setLoading(true);
      const response = await invoke<PaginatedNotesResponse>("get_notes", {
        page: 1,
        pageSize: 100,
      });
      setNotes(response.notes);
    } catch (err) {
      console.error("Failed to fetch notes:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (note: Note) => {
    setEditingId(note.id);
    setContent(note.content);
  };

  const handleCreate = async () => {
    if (!content.trim()) {
      return;
    }

    try {
      setIsCreating(true);
      await invoke("create_note", {
        content: content.trim(),
      });
      setContent("");
      await fetchNotes();
    } catch (err) {
      console.error("Failed to create note:", err);
      alert(`Failed to create note: ${err}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingId || !content.trim()) {
      return;
    }

    try {
      setIsCreating(true);
      await invoke("update_note", {
        noteId: editingId,
        content,
      });
      setEditingId(null);
      setContent("");
      await fetchNotes();
    } catch (err) {
      alert(`Failed to update note: ${err}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (noteId: string) => {
    if (!confirm("Are you sure you want to delete this note?")) {
      return;
    }

    try {
      await invoke("delete_note", { noteId });
      await fetchNotes();
    } catch (err) {
      alert(`Failed to delete note: ${err}`);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setContent("");
  };

  const handleFinish = () => {
    if (editingId) {
      handleUpdate();
    } else {
      handleCreate();
    }
  };

  // Filter notes based on search query
  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) {
      return notes;
    }
    const query = searchQuery.toLowerCase();
    return notes.filter((note) =>
      note.content.toLowerCase().includes(query)
    );
  }, [notes, searchQuery]);

  const toggleViewMode = () => {
    setViewMode((prev) => (prev === "list" ? "grid" : "list"));
  };

  const handleSearchClick = () => {
    setShowSearch((prev) => !prev);
    if (showSearch) {
      setSearchQuery("");
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "40px", color: "#666" }}>
        Loading notes...
      </div>
    );
  }

  return (
    <div style={{ padding: "40px", maxWidth: "800px", margin: "0 auto" }}>
      {/* Quick Thoughts Section */}
      <div style={{ marginBottom: "48px" }}>
        <h2
          style={{
            fontSize: "18px",
            fontWeight: 500,
            color: "#111827",
            marginBottom: "16px",
            marginTop: 0,
          }}
        >
          For quick thoughts you want to come back to.
        </h2>
        <div
          style={{
            position: "relative",
            backgroundColor: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            padding: "20px",
            minHeight: "200px",
          }}
        >
          {/* Microphone Icon */}
          <div
            style={{
              position: "absolute",
              top: "16px",
              right: "16px",
              cursor: "pointer",
              color: "#6b7280",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "32px",
              height: "32px",
              borderRadius: "6px",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#f3f4f6";
              e.currentTarget.style.color = "#111827";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "#6b7280";
            }}
          >
            <Mic size={18} />
          </div>

          {/* Textarea */}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Hey, just wanted to see how it is going there."
            disabled={isCreating}
            style={{
              width: "100%",
              border: "none",
              outline: "none",
              fontSize: "15px",
              fontFamily: "inherit",
              color: "#111827",
              resize: "none",
              minHeight: "150px",
              paddingRight: "40px",
              lineHeight: 1.6,
              background: "transparent",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                handleFinish();
              }
            }}
          />

          {/* Finish Button */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: "12px",
            }}
          >
            <button
              type="button"
              onClick={handleFinish}
              disabled={isCreating || !content.trim()}
              style={{
                padding: "8px 16px",
                backgroundColor: "#f3f4f6",
                color: "#6b7280",
                border: "none",
                borderRadius: "6px",
                cursor:
                  isCreating || !content.trim()
                    ? "not-allowed"
                    : "pointer",
                fontSize: "14px",
                fontWeight: 500,
                transition: "all 0.2s ease",
                opacity: isCreating || !content.trim() ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!isCreating && content.trim()) {
                  e.currentTarget.style.backgroundColor = "#e5e7eb";
                  e.currentTarget.style.color = "#111827";
                }
              }}
              onMouseLeave={(e) => {
                if (!isCreating && content.trim()) {
                  e.currentTarget.style.backgroundColor = "#f3f4f6";
                  e.currentTarget.style.color = "#6b7280";
                }
              }}
            >
              {isCreating
                ? editingId
                  ? "Updating..."
                  : "Creating..."
                : "Finish"}
            </button>
          </div>
        </div>
      </div>

      {/* Recents Section */}
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
              fontSize: "11px",
              fontWeight: 600,
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              margin: 0,
            }}
          >
            RECENTS
          </h3>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <button
              type="button"
              onClick={handleSearchClick}
              style={{
                background: showSearch ? "#f3f4f6" : "transparent",
                border: "none",
                cursor: "pointer",
                color: showSearch ? "#111827" : "#9ca3af",
                padding: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "4px",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                if (!showSearch) {
                  e.currentTarget.style.backgroundColor = "#f3f4f6";
                  e.currentTarget.style.color = "#111827";
                }
              }}
              onMouseLeave={(e) => {
                if (!showSearch) {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#9ca3af";
                }
              }}
            >
              <Search size={16} />
            </button>
            <button
              type="button"
              onClick={toggleViewMode}
              style={{
                background: viewMode === "grid" ? "#f3f4f6" : "transparent",
                border: "none",
                cursor: "pointer",
                color: viewMode === "grid" ? "#111827" : "#9ca3af",
                padding: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "4px",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                if (viewMode !== "grid") {
                  e.currentTarget.style.backgroundColor = "#f3f4f6";
                  e.currentTarget.style.color = "#111827";
                }
              }}
              onMouseLeave={(e) => {
                if (viewMode !== "grid") {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#9ca3af";
                }
              }}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              onClick={fetchNotes}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#9ca3af",
                padding: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "4px",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#f3f4f6";
                e.currentTarget.style.color = "#111827";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "#9ca3af";
              }}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        {/* Search Input */}
        {showSearch && (
          <div
            style={{
              marginBottom: "16px",
              position: "relative",
            }}
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes..."
              autoFocus
              style={{
                width: "100%",
                padding: "10px 40px 10px 12px",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                fontSize: "14px",
                fontFamily: "inherit",
                outline: "none",
                transition: "all 0.2s ease",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#d1d5db";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0, 0, 0, 0.05)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#e5e7eb";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                style={{
                  position: "absolute",
                  right: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "#9ca3af",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "4px",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#f3f4f6";
                  e.currentTarget.style.color = "#111827";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                  e.currentTarget.style.color = "#9ca3af";
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}

        {/* Notes List */}
        {filteredNotes.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "60px 20px",
              color: "#9ca3af",
            }}
          >
            <p style={{ margin: 0, fontSize: "14px" }}>
              {searchQuery ? "No notes match your search" : "No notes found"}
            </p>
          </div>
        ) : (
          <div
            style={{
              display: viewMode === "grid" ? "grid" : "flex",
              flexDirection: viewMode === "list" ? "column" : undefined,
              gridTemplateColumns: viewMode === "grid" ? "repeat(auto-fill, minmax(280px, 1fr))" : undefined,
              gap: "12px",
            }}
          >
            {filteredNotes.map((note) => (
              <div
                key={note.id}
                style={{
                  backgroundColor: "#ffffff",
                  border:
                    hoveredNoteId === note.id
                      ? "1px solid #d1d5db"
                      : "1px solid #e5e7eb",
                  borderRadius: "8px",
                  padding: "16px",
                  transition: "all 0.2s ease",
                  position: "relative",
                  boxShadow:
                    hoveredNoteId === note.id
                      ? "0 1px 3px rgba(0, 0, 0, 0.05)"
                      : "none",
                  height: viewMode === "grid" ? "auto" : undefined,
                  minHeight: viewMode === "grid" ? "150px" : undefined,
                  display: "flex",
                  flexDirection: "column",
                }}
                onMouseEnter={() => setHoveredNoteId(note.id)}
                onMouseLeave={() => setHoveredNoteId(null)}
              >
                {/* Action buttons - shown on hover */}
                <div
                  style={{
                    position: "absolute",
                    top: "12px",
                    right: "12px",
                    display: "flex",
                    gap: "6px",
                    opacity: hoveredNoteId === note.id ? 1 : 0,
                    transition: "opacity 0.2s ease",
                  }}
                  className="note-actions"
                >
                  <button
                    onClick={() => handleEdit(note)}
                    style={{
                      padding: "6px",
                      backgroundColor: "#f3f4f6",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#6b7280",
                      transition: "all 0.2s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "#e5e7eb";
                      e.currentTarget.style.color = "#111827";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "#f3f4f6";
                      e.currentTarget.style.color = "#6b7280";
                    }}
                  >
                    <Edit size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(note.id)}
                    style={{
                      padding: "6px",
                      backgroundColor: "#fef2f2",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ef4444",
                      transition: "all 0.2s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "#fee2e2";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "#fef2f2";
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <p
                  style={{
                    margin: "0 0 8px 0",
                    color: "#374151",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    fontSize: "14px",
                    paddingRight: "60px",
                    flex: 1,
                    overflow: viewMode === "grid" ? "hidden" : "visible",
                    display: viewMode === "grid" ? "-webkit-box" : "block",
                    WebkitLineClamp: viewMode === "grid" ? 4 : undefined,
                    WebkitBoxOrient: viewMode === "grid" ? "vertical" : undefined,
                    textOverflow: viewMode === "grid" ? "ellipsis" : undefined,
                  }}
                >
                  {note.content}
                </p>
                <div
                  style={{
                    fontSize: "12px",
                    color: "#9ca3af",
                    marginTop: "auto",
                    paddingTop: "8px",
                  }}
                >
                  {new Date(note.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit mode overlay */}
      {editingId && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={handleCancelEdit}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "12px",
              padding: "24px",
              maxWidth: "600px",
              width: "90%",
              maxHeight: "80vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                marginTop: 0,
                marginBottom: "16px",
                fontSize: "16px",
                fontWeight: 600,
                color: "#111827",
              }}
            >
              Edit Note
            </h3>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter note content"
              disabled={isCreating}
              rows={8}
              style={{
                width: "100%",
                padding: "12px",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                fontSize: "14px",
                fontFamily: "inherit",
                resize: "vertical",
                marginBottom: "16px",
              }}
            />
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={isCreating}
                style={{
                  padding: "10px 20px",
                  backgroundColor: "#f3f4f6",
                  color: "#6b7280",
                  border: "none",
                  borderRadius: "6px",
                  cursor: isCreating ? "not-allowed" : "pointer",
                  fontSize: "14px",
                  fontWeight: 500,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpdate}
                disabled={isCreating || !content.trim()}
                style={{
                  padding: "10px 20px",
                  backgroundColor: "#111827",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  cursor:
                    isCreating || !content.trim()
                      ? "not-allowed"
                      : "pointer",
                  fontSize: "14px",
                  fontWeight: 500,
                  opacity: isCreating || !content.trim() ? 0.5 : 1,
                }}
              >
                {isCreating ? "Updating..." : "Update"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
