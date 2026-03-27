import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookText, ChevronRight, FileText, Trash2 } from "lucide-react";
import type { Doc } from "../../types";
import { formatAppDateTime } from "../../lib/dateUtils";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import "./docs-list.css";

const PREVIEW_MAX_LENGTH = 140;

/** Extract plain text only from TipTap JSON (no formatting). */
function docContentToPlainText(contentJson: string | undefined): string {
  if (!contentJson?.trim()) return "";
  try {
    const doc = JSON.parse(contentJson) as {
      text?: string;
      content?: unknown[];
    };
    const parts: string[] = [];
    function visit(
      n: { text?: string; content?: unknown[] } | undefined,
    ): void {
      if (!n) return;
      if (typeof n.text === "string") parts.push(n.text);
      if (Array.isArray(n.content))
        n.content.forEach((c) =>
          visit(c as { text?: string; content?: unknown[] }),
        );
    }
    visit(doc);
    const raw = parts.join(" ").replace(/\s+/g, " ").trim();
    if (raw.length <= PREVIEW_MAX_LENGTH) return raw;
    return raw.slice(0, PREVIEW_MAX_LENGTH).trim() + "…";
  } catch {
    return "";
  }
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
      <p className="app-page-subtitle">Loading…</p>
    ) : docs.length > 0 ? (
      <p className="app-page-subtitle">
        {docs.length} {docs.length === 1 ? "document" : "documents"}
      </p>
    ) : null;

  return (
    <div className="docs-list-page">
      <header className="docs-list-page__header">
        <div className="docs-list-page__header-inner">
          <h1 className="docs-list-page__title docs-list-page__title--with-icon">
            <BookText
              className="docs-list-page__title__icon"
              size={22}
              strokeWidth={2}
              aria-hidden
            />
            Docs
          </h1>
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
