import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Note, PaginatedNotesResponse } from "../types";

export const NotesPage: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [content, setContent] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    fetchNotes();
  }, []);

  // Generate title from content
  const generateTitle = (text: string): string => {
    if (!text || !text.trim()) {
      return "Untitled Note";
    }
    // Try to get first sentence
    const firstSentenceMatch = text.match(/^[^.!?]+[.!?]/);
    if (firstSentenceMatch) {
      let title = firstSentenceMatch[0].trim();
      // Limit to 50 characters
      if (title.length > 50) {
        title = title.substring(0, 47) + "...";
      }
      return title;
    }
    // Fallback to first 50 characters
    const truncated = text.trim().substring(0, 50);
    return truncated.length < text.trim().length
      ? truncated + "..."
      : truncated;
  };

  const fetchNotes = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await invoke<PaginatedNotesResponse>("get_notes", {
        page: 1,
        pageSize: 100,
      });
      setNotes(response.notes);
    } catch (err) {
      setError(err as string);
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
      setError("Please enter some content for the note");
      return;
    }

    try {
      setIsCreating(true);
      setError(null);
      const autoTitle = generateTitle(content);
      await invoke("create_note", {
        title: autoTitle,
        content: content.trim(),
      });
      setContent("");
      await fetchNotes();
    } catch (err) {
      setError(`Failed to create note: ${err}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
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

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1>Notes</h1>
        </div>
        <div style={{ textAlign: "center", padding: "40px", color: "#666" }}>
          Loading notes...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1>Notes</h1>
        </div>
        <div
          style={{
            textAlign: "center",
            padding: "40px",
            color: "#d32f2f",
          }}
        >
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Notes</h1>
        <p style={{ color: "#666", fontSize: "14px" }}>
          Create and manage your notes
        </p>
      </div>

      {/* Create/Edit Form */}
      <div
        style={{
          backgroundColor: "#f9f9f9",
          border: "1px solid #ddd",
          borderRadius: "8px",
          padding: "20px",
          marginBottom: "24px",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: "16px", fontSize: "16px" }}>
          {editingId ? "Edit Note" : "Create New Note"}
        </h3>
        {!editingId ? (
          <div>
            <div style={{ marginBottom: "16px" }}>
              <label
                htmlFor="note-content"
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontWeight: 500,
                  fontSize: "14px",
                }}
              >
                Content
              </label>
              <textarea
                id="note-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Use your global hotkey to record a note. The title will be generated automatically."
                disabled={isCreating}
                rows={4}
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #ddd",
                  borderRadius: "6px",
                  fontSize: "14px",
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
            </div>
            <button
              type="button"
              onClick={handleCreate}
              disabled={isCreating || !content.trim()}
              style={{
                padding: "10px 20px",
                backgroundColor: "#007bff",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor:
                  isCreating || !content.trim()
                    ? "not-allowed"
                    : "pointer",
                fontSize: "14px",
                fontWeight: 500,
                opacity: isCreating || !content.trim() ? 0.6 : 1,
              }}
            >
              {isCreating ? "Creating..." : "Create Note"}
            </button>
          </div>
        ) : (
          <form onSubmit={handleUpdate}>
            <div style={{ marginBottom: "16px" }}>
              <label
                htmlFor="note-content"
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontWeight: 500,
                  fontSize: "14px",
                }}
              >
                Content
              </label>
              <textarea
                id="note-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Enter note content"
                disabled={isCreating}
                rows={4}
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #ddd",
                  borderRadius: "6px",
                  fontSize: "14px",
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="submit"
                disabled={isCreating}
                style={{
                  padding: "10px 20px",
                  backgroundColor: "#007bff",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: isCreating ? "not-allowed" : "pointer",
                  fontSize: "14px",
                  fontWeight: 500,
                  opacity: isCreating ? 0.6 : 1,
                }}
              >
                {isCreating ? "Updating..." : "Update Note"}
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={isCreating}
                style={{
                  padding: "10px 20px",
                  backgroundColor: "#6c757d",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: isCreating ? "not-allowed" : "pointer",
                  fontSize: "14px",
                  fontWeight: 500,
                  opacity: isCreating ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Notes List */}
      {notes.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: "#999",
          }}
        >
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            style={{ margin: "0 auto 16px", opacity: 0.3 }}
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="12" y1="18" x2="12" y2="12"></line>
            <line x1="9" y1="15" x2="15" y2="15"></line>
          </svg>
          <h3 style={{ marginTop: 0, marginBottom: "8px" }}>No notes yet</h3>
          <p style={{ margin: 0 }}>Create your first note to get started</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {notes.map((note) => (
            <div
              key={note.id}
              style={{
                backgroundColor: "white",
                border: "1px solid #ddd",
                borderRadius: "8px",
                padding: "20px",
                transition: "box-shadow 0.2s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "start",
                  marginBottom: "12px",
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: "18px",
                    fontWeight: 600,
                    color: "#333",
                  }}
                >
                  {note.title}
                </h3>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => handleEdit(note)}
                    style={{
                      padding: "6px 12px",
                      backgroundColor: "#f0f0f0",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "13px",
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(note.id)}
                    style={{
                      padding: "6px 12px",
                      backgroundColor: "#fee",
                      border: "1px solid #fcc",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "13px",
                      color: "#c33",
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p
                style={{
                  margin: "0 0 12px 0",
                  color: "#666",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {note.content}
              </p>
              <div style={{ fontSize: "12px", color: "#999" }}>
                Created: {new Date(note.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
