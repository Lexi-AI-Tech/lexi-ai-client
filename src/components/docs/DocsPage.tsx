import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useImperativeHandle,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, Mic, Square, Trash2 } from "lucide-react";
import type { Doc } from "../../types";
import { useToast } from "../toast/useToast";
import { DocsListPage } from "./DocsListPage";
import { RichTextEditor, type RichTextEditorRef } from "./RichTextEditor";
import "./docs.css";

const SAVE_DEBOUNCE_MS = 600;
const SAVE_INDICATOR_MIN_MS = 400;

/** Isolated save indicator so parent doesn't re-render on saving state change */
export interface SaveIndicatorRef {
  setSaving: (saving: boolean) => void;
}

const SaveIndicator = React.forwardRef<
  SaveIndicatorRef,
  { isStructuring?: boolean }
>(function SaveIndicator({ isStructuring }, ref) {
  const [saving, setSaving] = useState(false);
  useImperativeHandle(ref, () => ({ setSaving }), []);
  return (
    <div className="docs-editor-toolbar-meta docs-editor-toolbar-meta--save-only">
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
  );
});

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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest title/body for debounced PATCH — avoids stale list state overwriting the server. */
  const latestTitleRef = useRef("");
  const latestContentRef = useRef("");
  const prevSaveDocIdRef = useRef<string | null>(null);
  const lastSavedContentRef = useRef<string | null>(null);
  const lastSavedTitleRef = useRef<string | null>(null);
  const lastSavedDocIdRef = useRef<string | null>(null);
  const editorRef = useRef<RichTextEditorRef>(null);
  const saveIndicatorRef = useRef<SaveIndicatorRef>(null);
  const [isDocRecording, setIsDocRecording] = useState(false);
  const [isStructuring, setIsStructuring] = useState(false);
  /** Local title for the current doc to avoid setDocs on every keystroke */
  const [editingTitle, setEditingTitle] = useState("");

  const selectedDoc = docs.find((d) => d.id === selectedId);

  // When switching docs: reset save refs, clear pending save, sync title field
  useEffect(() => {
    const id = selectedDoc?.id ?? null;
    if (id !== prevSaveDocIdRef.current) {
      prevSaveDocIdRef.current = id;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (selectedDoc) {
        latestContentRef.current = selectedDoc.content ?? "";
        latestTitleRef.current = selectedDoc.title || "";
        setEditingTitle(selectedDoc.title || "");
      } else {
        latestContentRef.current = "";
        latestTitleRef.current = "";
        setEditingTitle("");
      }
    }
  }, [selectedDoc]);

  // Listen for doc recording and transcription events
  useEffect(() => {
    const unlistens: (() => void)[] = [];
    (async () => {
      try {
        unlistens.push(
          await listen("doc_recording_started", () => setIsDocRecording(true)),
        );
        unlistens.push(
          await listen("doc_recording_stopped", () => setIsDocRecording(false)),
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
          }),
        );
        unlistens.push(
          await listen<string>("doc_transcription_error", (e) => {
            setIsDocRecording(false);
            toast.error(e.payload || "Transcription failed");
          }),
        );
      } catch (err) {
        console.error("Doc event listeners failed:", err);
        toast.error("Docs failed to initialize. Please restart the app.");
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

  useEffect(
    () => () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    },
    [],
  );

  // When navigating with a specific doc to open (e.g. from "Create doc" in meetings)
  const hasConsumedInitialRef = useRef(false);
  useEffect(() => {
    if (initialSelectedDocId && !loading && !hasConsumedInitialRef.current) {
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
      const startedAt = Date.now();
      saveIndicatorRef.current?.setSaving(true);
      try {
        await invoke("update_doc", {
          payload: { docId, title, content },
        });
        lastSavedDocIdRef.current = docId;
        lastSavedContentRef.current = content;
        lastSavedTitleRef.current = title;
        // Don't setDocs here — avoids re-rendering the whole page. We'll flush
        // into docs when the user navigates away (see effect below).
      } catch (err) {
        console.error("Failed to save doc:", err);
        toast.error("Failed to save");
      } finally {
        // Show "Saving…" for at least a moment so the user sees feedback even when save is instant
        const elapsed = Date.now() - startedAt;
        if (elapsed < SAVE_INDICATOR_MIN_MS) {
          await new Promise((r) =>
            setTimeout(r, SAVE_INDICATOR_MIN_MS - elapsed),
          );
        }
        saveIndicatorRef.current?.setSaving(false);
      }
    },
    [toast],
  );

  // When leaving the current doc, flush last-saved state into docs so the list stays in sync
  const prevSelectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSelectedIdRef.current;
    prevSelectedIdRef.current = selectedId;
    if (
      prev != null &&
      prev !== selectedId &&
      lastSavedDocIdRef.current === prev
    ) {
      const title = lastSavedTitleRef.current;
      const content = lastSavedContentRef.current;
      setDocs((p) =>
        p.map((d) =>
          d.id === prev
            ? {
                ...d,
                ...(title != null && { title }),
                ...(content != null && { content }),
                updated_at: new Date().toISOString(),
              }
            : d,
        ),
      );
      lastSavedDocIdRef.current = null;
    }
  }, [selectedId]);

  const scheduleSave = useCallback(
    (docId: string) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null;
        saveDoc(docId, latestTitleRef.current, latestContentRef.current);
      }, SAVE_DEBOUNCE_MS);
    },
    [saveDoc],
  );

  const handleContentUpdate = useCallback(
    (json: string) => {
      if (!selectedDoc) return;
      latestContentRef.current = json;
      scheduleSave(selectedDoc.id);
    },
    [selectedDoc, scheduleSave],
  );

  const handleTitleChange = useCallback(
    (title: string) => {
      if (!selectedDoc) return;
      latestTitleRef.current = title;
      setEditingTitle(title);
      scheduleSave(selectedDoc.id);
    },
    [selectedDoc, scheduleSave],
  );

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
        toast.success("Recording… Click stop button when done.");
      } catch (err) {
        toast.error("Failed to start recording");
      }
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmId) return;
    setDeletingId(deleteConfirmId);
    try {
      await invoke("delete_doc", { payload: { docId: deleteConfirmId } });
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

  const handleDeleteDoc = useCallback(
    async (docId: string) => {
      await invoke("delete_doc", { payload: { docId } });
      setDocs((prev) => prev.filter((d) => d.id !== docId));
      if (selectedId === docId) setSelectedId(null);
      toast.success("Doc deleted");
    },
    [selectedId, toast],
  );

  const showListView = selectedId === null;
  const showDetailView = !showListView && selectedDoc;

  return (
    <div className={`docs-page ${showDetailView ? "docs-page--detail" : ""}`}>
      {showDetailView && selectedDoc && (
        <div className="docs-page-header">
          <button
            type="button"
            className="docs-page-header__back"
            onClick={() => setSelectedId(null)}
            aria-label="Back to docs list"
          >
            <ArrowLeft size={20} strokeWidth={2} />
            <span>Docs</span>
          </button>
        </div>
      )}

      {showListView ? (
        <DocsListPage
          docs={docs}
          isLoading={loading}
          onRefreshDocs={fetchDocs}
          onSelectDoc={setSelectedId}
          onCreateDoc={handleCreateDoc}
          onDeleteDoc={async (docId) => {
            setDeletingId(docId);
            try {
              await handleDeleteDoc(docId);
            } finally {
              setDeletingId(null);
            }
          }}
          deletingId={deletingId}
        />
      ) : showDetailView && selectedDoc ? (
        <div className="docs-detail-layout">
          <div className="docs-editor-shell">
            <div className="docs-editor-main">
              <div className="docs-editor-pane__toolbar docs-editor-pane__toolbar--premium docs-editor-pane__toolbar--detail">
                <input
                  type="text"
                  className="docs-editor-toolbar-title-input"
                  value={editingTitle}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditingTitle(v);
                    latestTitleRef.current = v;
                    scheduleSave(selectedDoc.id);
                  }}
                  placeholder="Untitled"
                  aria-label="Document title"
                />
                <SaveIndicator
                  ref={saveIndicatorRef}
                  isStructuring={isStructuring}
                />
                <button
                  type="button"
                  onClick={handleMicClick}
                  disabled={isStructuring}
                  className={`docs-mic-btn ${isDocRecording ? "docs-mic-btn--recording" : ""}`}
                  title={
                    isDocRecording
                      ? "Stop recording"
                      : "Record voice to add structured content"
                  }
                >
                  {isDocRecording ? (
                    <Square size={18} fill="currentColor" />
                  ) : (
                    <Mic size={18} />
                  )}
                </button>
                <button
                  type="button"
                  className="docs-editor-toolbar-delete"
                  onClick={() => setDeleteConfirmId(selectedDoc.id)}
                  disabled={!!deletingId}
                  title="Delete doc"
                >
                  <Trash2 size={18} strokeWidth={1.5} />
                </button>
              </div>
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <RichTextEditor
                  ref={editorRef}
                  key={selectedDoc.id}
                  content={selectedDoc.content}
                  title={editingTitle}
                  onTitleChange={handleTitleChange}
                  onUpdate={handleContentUpdate}
                  placeholder="Start writing…"
                  editable
                  showTitle={false}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deleteConfirmId && (
        <div
          className="docs-modal-overlay"
          onClick={() => !deletingId && setDeleteConfirmId(null)}
        >
          <div className="docs-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete this doc?</h3>
            <p>
              This action cannot be undone. The document will be permanently
              removed.
            </p>
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
