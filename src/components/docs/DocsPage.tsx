import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useImperativeHandle,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, Loader2, Mic, Square, Trash2 } from "lucide-react";
import type { Doc, DocContentResponse } from "../../types";
import { useToast } from "../toast/useToast";
import { DocsListPage } from "./DocsListPage";
import { RichTextEditor, type RichTextEditorRef } from "./RichTextEditor";
import { UpgradeModal } from "../UpgradeModal";
import {
  formatUserFacingApiErrorFromUnknown,
  isUsageQuotaExceededError,
} from "../../utils/userFacingApiError";
import "./docs.css";

const SAVE_DEBOUNCE_MS = 600;
const SAVE_INDICATOR_MIN_MS = 400;

/** Isolated save indicator so parent doesn't re-render on saving state change */
export interface SaveIndicatorRef {
  setSaving: (saving: boolean) => void;
}

const SaveIndicator = React.forwardRef<
  SaveIndicatorRef,
  { isCreatingDocFromAudio?: boolean }
>(function SaveIndicator({ isCreatingDocFromAudio }, ref) {
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
      {isCreatingDocFromAudio && (
        <span className="docs-editor-toolbar-pill docs-editor-toolbar-pill--ai">
          Creating doc from audio…
        </span>
      )}
    </div>
  );
});

export type DocsEntryIntent =
  | { kind: "open"; docId: string; doc?: Doc }
  | {
      kind: "generating-meeting-doc";
      requestId: string;
      meetingId: string;
      instructions: string;
    };

interface DocsPageProps {
  entryIntent?: DocsEntryIntent | null;
  onEntryIntentConsumed?: () => void;
}

export const DocsPage: React.FC<DocsPageProps> = ({
  entryIntent,
  onEntryIntentConsumed,
}) => {
  const toast = useToast();

  const isQuotaExceeded = useCallback((err: unknown) => {
    const raw =
      typeof err === "string"
        ? err
        : err instanceof Error
          ? err.message
          : String(err ?? "");
    return isUsageQuotaExceededError(raw);
  }, []);
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
  const [isCreatingDocFromAudio, setIsCreatingDocFromAudio] = useState(false);
  const [isGeneratingMeetingDoc, setIsGeneratingMeetingDoc] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const ignoreMeetingGenResultRef = useRef(false);
  /** Local title for the current doc to avoid setDocs on every keystroke */
  const [editingTitle, setEditingTitle] = useState("");
  const selectedIdRef = useRef<string | null>(null);
  const scheduleSaveRef = useRef<(docId: string) => void>(() => {});

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

  const selectedDoc = docs.find((d) => d.id === selectedId);

  // When switching docs: reset save refs, clear pending save, sync title field
  useEffect(() => {
    const id = selectedDoc?.id ?? null;
    if (id !== prevSaveDocIdRef.current) {
      const oldId = prevSaveDocIdRef.current;
      prevSaveDocIdRef.current = id;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        if (oldId) {
          saveDoc(oldId, latestTitleRef.current, latestContentRef.current);
        }
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
  }, [selectedDoc, saveDoc]);

  // Listen for doc recording and transcription events
  useEffect(() => {
    const unlistens: (() => void)[] = [];
    let isMounted = true;
    (async () => {
      try {
        const unlistenRecordingStarted = await listen(
          "doc_recording_started",
          () => setIsDocRecording(true),
        );
        if (isMounted) unlistens.push(unlistenRecordingStarted);
        else unlistenRecordingStarted();

        const unlistenRecordingStopped = await listen(
          "doc_recording_stopped",
          () => {
            setIsDocRecording(false);
            setIsCreatingDocFromAudio(true);
          },
        );
        if (isMounted) unlistens.push(unlistenRecordingStopped);
        else unlistenRecordingStopped();

        const unlistenFromAudioReady = await listen<DocContentResponse>(
          "doc_from_audio_ready",
          (e) => {
            const result = e.payload;
            if (!result?.content?.trim()) {
              setIsCreatingDocFromAudio(false);
              return;
            }
            editorRef.current?.insertStructuredContent(result.content);
            const docId = selectedIdRef.current;
            const suggested = (result.title ?? "").trim();
            const currentTitle = latestTitleRef.current.trim();
            const shouldApplyTitle =
              Boolean(docId) &&
              suggested.length > 0 &&
              suggested.toLowerCase() !== "untitled" &&
              (!currentTitle || currentTitle.toLowerCase() === "untitled");
            if (shouldApplyTitle && docId) {
              latestTitleRef.current = suggested;
              setEditingTitle(suggested);
              scheduleSaveRef.current(docId);
            }
            setIsCreatingDocFromAudio(false);
            toast.success("Content added from voice");
          },
        );
        if (isMounted) unlistens.push(unlistenFromAudioReady);
        else unlistenFromAudioReady();

        const unlistenFromAudioError = await listen<string>(
          "doc_from_audio_error",
          (e) => {
            setIsDocRecording(false);
            setIsCreatingDocFromAudio(false);
            const msg = e.payload || "Voice input failed";
            if (isQuotaExceeded(msg)) {
              setShowUpgradeModal(true);
            }
            toast.error(msg);
          },
        );
        if (isMounted) unlistens.push(unlistenFromAudioError);
        else unlistenFromAudioError();
      } catch (err) {
        console.error("Doc event listeners failed:", err);
        toast.error("Docs failed to initialize. Please restart the app.");
      }
    })();
    return () => {
      isMounted = false;
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

  const lastHandledOpenDocIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!entryIntent || entryIntent.kind !== "open" || loading) return;
    if (lastHandledOpenDocIdRef.current === entryIntent.docId) return;
    lastHandledOpenDocIdRef.current = entryIntent.docId;
    const { docId, doc } = entryIntent;
    if (doc) {
      setDocs((prev) =>
        prev.some((d) => d.id === doc.id) ? prev : [doc, ...prev],
      );
    }
    setSelectedId(docId);
    onEntryIntentConsumed?.();
  }, [entryIntent, loading, onEntryIntentConsumed]);

  const lastHandledGenRequestIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !entryIntent ||
      entryIntent.kind !== "generating-meeting-doc" ||
      loading
    ) {
      return;
    }
    if (lastHandledGenRequestIdRef.current === entryIntent.requestId) return;
    lastHandledGenRequestIdRef.current = entryIntent.requestId;

    const { meetingId, instructions } = entryIntent;
    onEntryIntentConsumed?.();

    ignoreMeetingGenResultRef.current = false;
    setSelectedId(null);
    setIsGeneratingMeetingDoc(true);

    // Do not use an effect cleanup "cancelled" flag for this async work. React
    // Strict Mode runs effects twice in dev: cleanup flips cancelled before the
    // invoke resolves, so we'd never clear generating or apply the new doc.
    void (async () => {
      try {
        const doc = await invoke<Doc>("create_doc_from_meeting", {
          meetingId,
          instructions,
        });
        if (ignoreMeetingGenResultRef.current) return;
        setDocs((prev) =>
          prev.some((d) => d.id === doc.id) ? prev : [doc, ...prev],
        );
        setSelectedId(doc.id);
        toast.success("Document created");
      } catch (err) {
        if (!ignoreMeetingGenResultRef.current) {
          console.error("Create doc from meeting failed:", err);
          const msg = formatUserFacingApiErrorFromUnknown(err);
          if (isQuotaExceeded(err)) {
            setShowUpgradeModal(true);
          }
          toast.error(msg);
        }
      } finally {
        setIsGeneratingMeetingDoc(false);
      }
    })();
  }, [entryIntent, loading, onEntryIntentConsumed, toast]);

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
      const msg = formatUserFacingApiErrorFromUnknown(err);
      if (isQuotaExceeded(err)) {
        setShowUpgradeModal(true);
      }
      toast.error(msg);
    }
  };

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

  useEffect(() => {
    scheduleSaveRef.current = scheduleSave;
  }, [scheduleSave]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

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

  const showGeneratingMeeting = isGeneratingMeetingDoc;
  const showListView = selectedId === null && !showGeneratingMeeting;
  const showDetailView = !showListView && selectedDoc;

  return (
    <div
      className={`docs-page ${showDetailView || showGeneratingMeeting ? "docs-page--detail" : ""}`}
    >
      {showUpgradeModal && (
        <UpgradeModal onClose={() => setShowUpgradeModal(false)} />
      )}
      {showGeneratingMeeting && (
        <>
          <div className="docs-page-header">
            <button
              type="button"
              className="docs-page-header__back"
              onClick={() => {
                ignoreMeetingGenResultRef.current = true;
                setIsGeneratingMeetingDoc(false);
              }}
              aria-label="Back to docs list"
            >
              <ArrowLeft size={20} strokeWidth={2} />
              <span>Docs</span>
            </button>
          </div>
          <div className="docs-generating-meeting">
            <Loader2
              className="docs-generating-meeting__spinner"
              size={40}
              strokeWidth={1.5}
              aria-hidden
            />
            <p className="docs-generating-meeting__title">
              Generating document from your meeting…
            </p>
            <p className="docs-generating-meeting__hint">
              We’ll open the doc here when it’s ready.
            </p>
          </div>
        </>
      )}
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
                  isCreatingDocFromAudio={isCreatingDocFromAudio}
                />
                <button
                  type="button"
                  onClick={handleMicClick}
                  disabled={isCreatingDocFromAudio}
                  className={`docs-mic-btn ${isDocRecording ? "docs-mic-btn--recording" : ""}`}
                  title={
                    isDocRecording
                      ? "Stop recording"
                      : "Record voice to create doc from audio"
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
