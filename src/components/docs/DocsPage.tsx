import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FileText, Mic, Plus, Square, Trash2 } from "lucide-react";
import type { Doc } from "../../types";
import { useToast } from "../toast/useToast";
import { PageLoader } from "../ui/PageLoader";
import { RichTextEditor, type RichTextEditorRef } from "./RichTextEditor";
import "./docs.css";

const SAVE_DEBOUNCE_MS = 600;

interface DocsPageProps {
  /** When set, open this doc (e.g. after creating from meeting). Cleared via onInitialDocConsumed. */
  initialSelectedDocId?: string | null;
  onInitialDocConsumed?: () => void;
}

export const DocsPage: React.FC<DocsPageProps> = ({
  initialSelectedDocId,
  onInitialDocConsumed,
}) => {
  const toast = useToast();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef<string | null>(null);
  const lastSavedTitleRef = useRef<string | null>(null);
  const editorRef = useRef<RichTextEditorRef>(null);
  const [isDocRecording, setIsDocRecording] = useState(false);
  const [isStructuring, setIsStructuring] = useState(false);

  const selectedDoc = docs.find((d) => d.id === selectedId);

  // Listen for doc recording and transcription events
  useEffect(() => {
    const unlistens: (() => void)[] = [];
    (async () => {
      try {
        unlistens.push(
          await listen("doc_recording_started", () => setIsDocRecording(true))
        );
        unlistens.push(
          await listen("doc_recording_stopped", () => setIsDocRecording(false))
        );
        unlistens.push(
          await listen<string>("doc_transcription_ready", async (e) => {
            const transcript = e.payload;
            if (!transcript?.trim()) return;
            setIsStructuring(true);
            try {
              const content = await invoke<string>("structure_doc_content", {
                transcript,
              });
              editorRef.current?.insertStructuredContent(content);
              toast.success("Content added from voice");
            } catch (err) {
              console.error("Structure doc content failed:", err);
              toast.error("Failed to structure content");
            } finally {
              setIsStructuring(false);
            }
          })
        );
        unlistens.push(
          await listen<string>("doc_transcription_error", (e) => {
            setIsDocRecording(false);
            toast.error(e.payload || "Transcription failed");
          })
        );
      } catch (err) {
        console.error("Doc event listeners failed:", err);
      }
    })();
    return () => {
      unlistens.forEach((fn) => fn());
    };
  }, [toast]);

  const fetchDocs = useCallback(async () => {
    try {
      setLoading(true);
      const list = await invoke<Doc[]>("get_docs");
      setDocs(list ?? []);
      if (selectedId && !list?.some((d) => d.id === selectedId)) {
        setSelectedId(null);
      }
    } catch (err) {
      console.error("Failed to fetch docs:", err);
      toast.error("Failed to load docs");
    } finally {
      setLoading(false);
    }
  }, [selectedId, toast]);

  useEffect(() => {
    fetchDocs();
  }, []);

  // When navigating with a specific doc to open (e.g. from "Create doc" in meetings)
  const hasConsumedInitialRef = useRef(false);
  useEffect(() => {
    if (
      initialSelectedDocId &&
      !loading &&
      !hasConsumedInitialRef.current
    ) {
      hasConsumedInitialRef.current = true;
      setSelectedId(initialSelectedDocId);
      onInitialDocConsumed?.();
    }
  }, [initialSelectedDocId, loading, onInitialDocConsumed]);

  const handleCreateDoc = async () => {
    try {
      const doc = await invoke<Doc>("create_doc", {
        title: "Untitled",
        content: undefined,
      });
      setDocs((prev) => [doc, ...prev]);
      setSelectedId(doc.id);
      toast.success("Doc created");
    } catch (err) {
      console.error("Failed to create doc:", err);
      toast.error("Failed to create doc");
    }
  };

  const saveDoc = useCallback(
    async (docId: string, title: string, content: string) => {
      try {
        setSaving(true);
        await invoke("update_doc", {
          docId,
          title,
          content,
        });
        setDocs((prev) =>
          prev.map((d) =>
            d.id === docId ? { ...d, title, content, updated_at: new Date().toISOString() } : d
          )
        );
        lastSavedContentRef.current = content;
        lastSavedTitleRef.current = title;
      } catch (err) {
        console.error("Failed to save doc:", err);
        toast.error("Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [toast]
  );

  const debouncedSave = useCallback(
    (docId: string, title: string, content: string) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null;
        saveDoc(docId, title, content);
      }, SAVE_DEBOUNCE_MS);
    },
    [saveDoc]
  );

  const handleContentUpdate = useCallback(
    (json: string) => {
      if (!selectedDoc) return;
      debouncedSave(selectedDoc.id, selectedDoc.title, json);
    },
    [selectedDoc, debouncedSave]
  );

  const handleTitleChange = useCallback(
    (title: string) => {
      if (!selectedDoc) return;
      debouncedSave(selectedDoc.id, title, selectedDoc.content);
    },
    [selectedDoc, debouncedSave]
  );

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteConfirmId(id);
  };

  const handleMicClick = async () => {
    if (isDocRecording) {
      try {
        await invoke("stop_doc_recording");
      } catch (err) {
        toast.error("Failed to stop recording");
      }
    } else {
      try {
        await invoke("start_doc_recording");
        toast.success("Recording… Click mic again when done.");
      } catch (err) {
        toast.error("Failed to start recording");
      }
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmId) return;
    setDeletingId(deleteConfirmId);
    try {
      await invoke("delete_doc", { docId: deleteConfirmId });
      setDocs((prev) => prev.filter((d) => d.id !== deleteConfirmId));
      if (selectedId === deleteConfirmId) setSelectedId(null);
      setDeleteConfirmId(null);
      toast.success("Doc deleted");
    } catch (err) {
      toast.error("Failed to delete doc");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="docs-page">
        <h2 className="docs-page__title">Docs</h2>
        <PageLoader className="page__empty" />
      </div>
    );
  }

  return (
    <div className="docs-page">
      <div className="docs-page__header">
        <h2 className="docs-page__title">Docs</h2>
        <button
          type="button"
          onClick={handleCreateDoc}
          className="docs-btn-new"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 16px",
            background: "#111827",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          <Plus size={18} />
          New doc
        </button>
      </div>

      <div className="docs-layout">
        <aside className="docs-sidebar">
          <div className="docs-sidebar__label">Documents</div>
          <ul className="docs-list">
            {docs.length === 0 ? (
              <li style={{ color: "#9ca3af", fontSize: "14px", padding: "8px 0" }}>
                No docs yet. Create one to get started.
              </li>
            ) : (
              docs.map((doc) => (
                <li key={doc.id} className="docs-list__item">
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <button
                      type="button"
                      className={`docs-list__btn ${selectedId === doc.id ? "is-active" : ""}`}
                      onClick={() => setSelectedId(doc.id)}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <FileText size={16} style={{ flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {doc.title || "Untitled"}
                        </span>
                      </span>
                      <div className="docs-list__meta">
                        {new Date(doc.updated_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteClick(e, doc.id)}
                      disabled={!!deletingId}
                      title="Delete"
                      style={{
                        padding: "6px",
                        background: "transparent",
                        border: "none",
                        borderRadius: "6px",
                        color: "#9ca3af",
                        cursor: deletingId ? "not-allowed" : "pointer",
                        opacity: deletingId ? 0.5 : 1,
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </aside>

        <div className="docs-editor-pane">
          {!selectedDoc ? (
            <div className="docs-editor-pane__empty">
              <div className="docs-editor-pane__empty-inner">
                <p>Select a doc from the list or create a new one.</p>
                <p style={{ fontSize: "13px", marginTop: "8px" }}>
                  Rich text: headings, lists, bold, italic, quotes, code, and more.
                </p>
              </div>
            </div>
          ) : (
            <div className="docs-editor-shell">
              <div className="docs-editor-main">
                <div
                  className="docs-editor-pane__toolbar docs-editor-pane__toolbar--premium"
                  style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 16px", borderBottom: "1px solid #e5e7eb" }}
                >
                  <div className="docs-editor-toolbar-title">
                    <span className="docs-editor-toolbar-label">Document</span>
                    <span className="docs-editor-toolbar-name">
                      {selectedDoc.title || "Untitled"}
                    </span>
                  </div>
                  <div className="docs-editor-toolbar-meta">
                    {saving && (
                      <span className="docs-editor-toolbar-pill docs-editor-toolbar-pill--muted">
                        Saving…
                      </span>
                    )}
                    {!saving && (
                      <span className="docs-editor-toolbar-pill docs-editor-toolbar-pill--muted">
                        Saved
                      </span>
                    )}
                    {isStructuring && (
                      <span className="docs-editor-toolbar-pill docs-editor-toolbar-pill--ai">
                        Structuring from voice…
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleMicClick}
                    disabled={isStructuring}
                    className={`docs-mic-btn ${isDocRecording ? "docs-mic-btn--recording" : ""}`}
                    title={isDocRecording ? "Stop recording" : "Record voice to add structured content"}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "36px",
                      height: "36px",
                      borderRadius: "8px",
                      border: "none",
                      background: isDocRecording ? "#fef2f2" : "#f3f4f6",
                      color: isDocRecording ? "#dc2626" : "#374151",
                      cursor: isStructuring ? "not-allowed" : "pointer",
                      opacity: isStructuring ? 0.7 : 1,
                    }}
                  >
                    {isDocRecording ? (
                      <Square size={18} fill="currentColor" />
                    ) : (
                      <Mic size={18} />
                    )}
                  </button>
                </div>
                <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <RichTextEditor
                    ref={editorRef}
                    key={selectedDoc.id}
                    content={selectedDoc.content}
                    title={selectedDoc.title}
                    onUpdate={handleContentUpdate}
                    onTitleChange={handleTitleChange}
                    placeholder="Start writing…"
                    editable
                  />
                </div>
              </div>
              <aside className="docs-ask-lexi-rail">
                <div className="docs-ask-lexi-rail__header">
                  <span className="docs-ask-lexi-rail__label">Ask Lexi</span>
                  <p className="docs-ask-lexi-rail__hint">
                    Turn this doc into briefs, checklists, and summaries with one click.
                  </p>
                </div>
                <div className="docs-ask-lexi-rail__section">
                  <div className="docs-ask-lexi-rail__section-title">Quick transforms</div>
                  <button
                    type="button"
                    className="docs-ask-lexi-rail__chip"
                    disabled={!selectedDoc}
                  >
                    Summarize this doc
                  </button>
                  <button
                    type="button"
                    className="docs-ask-lexi-rail__chip"
                    disabled={!selectedDoc}
                  >
                    Turn into action list
                  </button>
                  <button
                    type="button"
                    className="docs-ask-lexi-rail__chip"
                    disabled={!selectedDoc}
                  >
                    Create exec brief
                  </button>
                </div>
                <div className="docs-ask-lexi-rail__section docs-ask-lexi-rail__section--subtle">
                  <div className="docs-ask-lexi-rail__section-title">From meetings</div>
                  <p className="docs-ask-lexi-rail__small">
                    Docs created from meetings stay linked to their original session, so you can always jump back to the transcript and AI summary.
                  </p>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>

      {deleteConfirmId && (
        <div
          className="docs-modal-overlay"
          onClick={() => !deletingId && setDeleteConfirmId(null)}
        >
          <div className="docs-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete this doc?</h3>
            <p>This action cannot be undone. The document will be permanently removed.</p>
            <div className="docs-modal-actions">
              <button
                type="button"
                className="docs-modal-btn-cancel"
                onClick={() => !deletingId && setDeleteConfirmId(null)}
                disabled={!!deletingId}
              >
                Cancel
              </button>
              <button
                type="button"
                className="docs-modal-btn-delete"
                onClick={handleConfirmDelete}
                disabled={!!deletingId}
              >
                {deletingId ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
