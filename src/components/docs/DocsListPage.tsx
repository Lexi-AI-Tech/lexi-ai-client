import React, { useId, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookText, ChevronRight, FileText, Info, Trash2 } from "lucide-react";
import type { Doc } from "../../types";
import { formatAppDateTime } from "../../lib/dateUtils";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import "./docs-list.css";

const DOCS_HELP =
  "On a meeting’s detail page, use Create doc to generate a document from that meeting. Here, click New doc to start fresh, then use the mic in the editor toolbar to dictate—Lexi creates the doc from your audio.";

const PREVIEW_MAX_LENGTH = 140;

/** Extract plain text preview from Markdown (no formatting). */
function docContentToPlainText(markdown: string | undefined): string {
  if (!markdown?.trim()) return "";

  let raw = markdown;

  // TipTap markdown can include non-breaking spaces/entities to preserve empty lines.
  raw = raw.replace(/&nbsp;/gi, " ").replace(/\u00A0/g, " ");

  // Drop fenced code blocks entirely for previews.
  raw = raw.replace(/```[\s\S]*?```/g, " ");

  // Links: [text](url) -> text
  raw = raw.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");

  // Inline code: `code` -> code
  raw = raw.replace(/`([^`]+)`/g, "$1");

  // Headings / blockquotes / list markers
  raw = raw.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  raw = raw.replace(/^\s{0,3}>\s?/gm, "");
  raw = raw.replace(/^\s*[-*+]\s+/gm, "");
  raw = raw.replace(/^\s*\d+\.\s+/gm, "");

  // Emphasis markers
  raw = raw.replace(/\*\*([^*]+)\*\*/g, "$1");
  raw = raw.replace(/\*([^*]+)\*/g, "$1");
  raw = raw.replace(/~~([^~]+)~~/g, "$1");

  // Remove any remaining HTML tags/entities from previews.
  raw = raw.replace(/<\/?[^>]+>/g, " ");
  raw = raw.replace(/&[a-zA-Z]+;/g, " ");

  raw = raw.replace(/\s+/g, " ").trim();
  if (raw.length <= PREVIEW_MAX_LENGTH) return raw;
  return raw.slice(0, PREVIEW_MAX_LENGTH).trim() + "…";
}

function DocsPageHeading() {
  const tooltipId = useId();
  return (
    <h1 className="docs-list-page__title docs-list-page__title--with-icon">
      <BookText
        className="docs-list-page__title__icon"
        size={22}
        strokeWidth={2}
        aria-hidden
      />
      Docs
      <span className="transcripts-page-tooltip-wrap">
        <button
          type="button"
          className="transcripts-page-tooltip-trigger"
          aria-label="How docs work"
          aria-describedby={tooltipId}
        >
          <Info size={16} strokeWidth={2} aria-hidden />
        </button>
        <span
          id={tooltipId}
          className="transcripts-page-tooltip"
          role="tooltip"
        >
          {DOCS_HELP}
        </span>
      </span>
    </h1>
  );
}

interface DocsListPageProps {
  docs: Doc[];
  /** When true and there are no docs yet, only the list body shows a skeleton. */
  isLoading?: boolean;
  onRefreshDocs: () => void;
  onSelectDoc: (docId: string) => void;
  onCreateDoc: () => void;
  onDeleteDoc: (docId: string) => Promise<void>;
  deletingId: string | null;
}

export const DocsListPage: React.FC<DocsListPageProps> = ({
  docs,
  isLoading = false,
  onRefreshDocs: _onRefreshDocs,
  onSelectDoc,
  onCreateDoc,
  onDeleteDoc,
  deletingId,
}) => {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    if (!deleteConfirmId) return;
    setIsDeleting(true);
    try {
      await onDeleteDoc(deleteConfirmId);
      setDeleteConfirmId(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const openDeleteConfirm = (e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
    setDeleteConfirmId(docId);
  };

  const GRID_VARIANTS = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.06, delayChildren: 0.08 },
    },
  };

  const CARD_VARIANTS = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, ease: [0.22, 0.61, 0.36, 1] as const },
    },
  };

  const showListSkeleton = isLoading && docs.length === 0;
  const showEmpty = !isLoading && docs.length === 0;
  const showGrid = docs.length > 0;

  const subtitle =
    isLoading && docs.length === 0 ? (
      <p className="app-page-subtitle">
        <span
          className="skeleton-block app-page-subtitle-skeleton"
          style={{ width: 150, height: 12, borderRadius: 10 }}
        />
      </p>
    ) : docs.length > 0 ? (
      <p className="app-page-subtitle">
        {docs.length} {docs.length === 1 ? "document" : "documents"}
      </p>
    ) : null;

  return (
    <div className="docs-list-page">
      <header className="docs-list-page__header">
        <div className="docs-list-page__header-inner">
          <DocsPageHeading />
          {subtitle}
        </div>
        <button
          type="button"
          className="docs-list-page__cta"
          onClick={onCreateDoc}
        >
          <BookText size={18} strokeWidth={2} />
          New doc
        </button>
      </header>

      <div className="docs-list-page__content">
        <AnimatePresence mode="wait">
          {showListSkeleton ? (
            <motion.div
              key="docs-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <ScreenSkeleton
                variant="docs"
                className="docs-list-page__skeleton"
              />
            </motion.div>
          ) : showEmpty ? (
            <motion.div
              key="empty"
              className="docs-list-page__empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <div className="docs-list-page__empty-icon">
                <FileText size={40} strokeWidth={1.5} />
              </div>
              <p className="docs-list-page__empty-text">No documents yet</p>
              <p className="docs-list-page__empty-hint">
                Create a doc to capture notes, briefs, and structured content.
              </p>
            </motion.div>
          ) : showGrid ? (
            <motion.div
              key="docs-grid"
              className="docs-list-page__grid"
              variants={GRID_VARIANTS}
              initial="hidden"
              animate="visible"
            >
              {docs.map((doc) => {
                const previewText = docContentToPlainText(doc.content);
                return (
                  <motion.div
                    key={doc.id}
                    className="docs-list-page__card"
                    variants={CARD_VARIANTS}
                    onClick={() => onSelectDoc(doc.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectDoc(doc.id);
                      }
                    }}
                  >
                    <div className="docs-list-page__card-body">
                      <div className="docs-list-page__card-meta-row">
                        {formatAppDateTime(doc.updated_at) && (
                          <span className="docs-list-page__card-date">
                            {formatAppDateTime(doc.updated_at)}
                          </span>
                        )}
                      </div>
                      <h3 className="docs-list-page__card-title">
                        {doc.title || "Untitled"}
                      </h3>
                      {previewText ? (
                        <p className="docs-list-page__card-summary">
                          {previewText}
                        </p>
                      ) : null}
                    </div>
                    <div className="docs-list-page__card-actions">
                      <span className="docs-list-page__card-link">
                        Open
                        <ChevronRight
                          size={16}
                          strokeWidth={2.5}
                          className="docs-list-page__card-link-arrow"
                        />
                      </span>
                      <button
                        type="button"
                        className="docs-list-page__card-delete"
                        onClick={(e) => openDeleteConfirm(e, doc.id)}
                        disabled={!!deletingId}
                        title="Delete doc"
                      >
                        <Trash2 size={16} strokeWidth={1.5} />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {deleteConfirmId && (
        <div
          className="docs-list-page__delete-overlay"
          onClick={() => !isDeleting && setDeleteConfirmId(null)}
        >
          <div
            className="docs-list-page__delete-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Delete this doc?</h3>
            <p>
              This action cannot be undone. The document will be permanently
              removed.
            </p>
            <div className="docs-list-page__delete-actions">
              <button
                type="button"
                className="docs-list-page__delete-btn-cancel"
                onClick={() => setDeleteConfirmId(null)}
                disabled={!!isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="docs-list-page__delete-btn-delete"
                onClick={handleConfirmDelete}
                disabled={!!isDeleting}
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
