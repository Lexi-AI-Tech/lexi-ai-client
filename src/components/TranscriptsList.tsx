/**
 * TranscriptsList Component
 *
 * Displays a list of transcripts fetched from the backend API.
 * Requires authentication to view transcripts.
 */

import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, RefreshCw, Check, Trash2 } from "lucide-react";
import type { Transcript } from "../types";
import { formatDateRelative } from "../lib/dateUtils";
import { useAuthStore } from "../store/authStore";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";
import "./home/home.css";

export const TranscriptsList: React.FC = () => {
  const authStore = useAuthStore();
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Clear error on mount to prevent stale error messages
  useEffect(() => {
    setError(null);
  }, []);

  // Fetch transcripts function
  const fetchTranscripts = useCallback(async () => {
    // This function should only be called when we're ready to fetch
    // (initialized, authenticated, and tokens loaded)
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      // Should not happen if called correctly, but handle gracefully
      setTranscripts([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await invoke<{
        transcripts: Transcript[];
        total: number;
        page: number;
        page_size: number;
        total_pages: number;
      }>("get_transcripts", {
        page,
        pageSize: 10,
      });
      setTranscripts(response.transcripts);
      setTotalPages(response.total_pages);
      setTotal(response.total);
    } catch (err: any) {
      console.error("Failed to fetch transcripts:", err);

      // Check error type
      const errorMessage = err.message || "Failed to load transcripts";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized");

      // Check for network errors (server unreachable, no internet, etc.)
      const isNetworkError =
        err.name === "TypeError" ||
        err.name === "NetworkError" ||
        errorMessage.includes("Failed to fetch") ||
        errorMessage.includes("NetworkError") ||
        errorMessage.includes("network") ||
        errorMessage.includes("ECONNREFUSED");

      if (isAuthError) {
        // Auth error - Rust backend already tried to refresh token via get_auth_token_async()
        // If we still got 401, the refresh failed or tokens are invalid
        // The backend will emit auth_expired event, which authStore will handle
        // Don't show error - just let the UI transition to login state
        console.log(
          "🔴 Auth error after Rust-side refresh attempt, clearing auth",
        );
        authStore.clearAuth();
        setTranscripts([]);
        setError(null); // No error message - silent logout
      } else if (isNetworkError) {
        // Network error - don't show error on initial load, just log it
        // User can retry manually if needed
        console.warn("Network error while fetching transcripts:", err);
        setTranscripts([]);
        setError(null); // Don't show network errors as they're often temporary
      } else {
        // Other API errors - show error message
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  }, [
    authStore.isAuthenticated,
    authStore.isInitialized,
    authStore.tokens?.access_token,
    page,
  ]);

  // Fetch transcripts when authenticated and page changes (same pattern as HomePage: single effect, no callback in deps to avoid double fetch)
  useEffect(() => {
    if (!authStore.isInitialized) return;
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      setTranscripts([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    let cancelled = false;
    (async () => {
      try {
        const response = await invoke<{
          transcripts: Transcript[];
          total: number;
          page: number;
          page_size: number;
          total_pages: number;
        }>("get_transcripts", { page, pageSize: 10 });

        if (cancelled) return;
        setTranscripts(response.transcripts);
        setTotalPages(response.total_pages);
        setTotal(response.total);
      } catch (err: any) {
        if (cancelled) return;
        console.error("Failed to fetch transcripts:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authStore.isInitialized,
    authStore.isAuthenticated,
    authStore.tokens?.access_token,
    page,
  ]);

  const openDeleteConfirm = (transcriptId: string) => {
    setDeleteConfirmId(transcriptId);
  };

  const closeDeleteConfirm = () => {
    if (!deletingId) setDeleteConfirmId(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmId) return;

    setDeletingId(deleteConfirmId);
    try {
      await invoke("delete_transcript", { transcriptId: deleteConfirmId });
      setDeleteConfirmId(null);
      await fetchTranscripts();
    } catch (err: any) {
      console.error("Failed to delete transcript:", err);
      alert(err.message || "Failed to delete transcript");
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopyToClipboard = async (text: string, transcriptId: string) => {
    try {
      await invoke("copy_to_clipboard", { text });
      setCopiedId(transcriptId);
      setTimeout(() => setCopiedId(null), 250);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };


  // Same as HomePage: always show the page shell; show loading/login/content inside (no full-page gate)
  const showContent =
    authStore.isInitialized &&
    (!authStore.isAuthenticated || !!authStore.tokens?.access_token);
  const showLogin =
    authStore.isInitialized && !authStore.isAuthenticated;

  return (
    <div
      className="settings"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <h3>
          Transcripts{" "}
          {total > 0 && (
            <span
              style={{ fontSize: "12px", fontWeight: "normal", opacity: 0.6 }}
            >
              ({total})
            </span>
          )}
        </h3>
        {totalPages > 1 && (
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              className="transcript-btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              style={{ fontSize: "11px", padding: "4px 8px" }}
            >
              ← Prev
            </button>
            <span
              style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.6)" }}
            >
              {page} / {totalPages}
            </span>
            <button
              className="transcript-btn"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || loading}
              style={{ fontSize: "11px", padding: "4px 8px" }}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {!showContent && (
        <div
          style={{
            textAlign: "center",
            padding: "24px",
            color: "#6b7280",
          }}
        >
          Loading...
        </div>
      )}

      {showLogin && showContent && (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <p className="permission-text" style={{ marginBottom: "16px" }}>
            Sign in to view your transcription history
          </p>
          <GoogleLoginButton
            onSuccess={() => {}}
            onError={(err) => {
              setError(err || "Authentication failed");
            }}
          />
        </div>
      )}

      {showContent && !showLogin && loading && transcripts.length === 0 && (
        <div
          className="loading-state"
          style={{
            width: "100%",
            flex: 1,
            justifyContent: "center",
          }}
        >
          <div className="loading-spinner" />
        </div>
      )}

      {showContent && !showLogin && error && (
        <div
          className="permission-message"
          style={{
            background: "#fef2f2",
            borderColor: "#fecaca",
            color: "#b91c1c",
          }}
        >
          {error}
        </div>
      )}

      {showContent && !showLogin && !loading && !error && transcripts.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "24px",
            color: "#6b7280",
          }}
        >
          <p>No transcripts yet.</p>
          <p style={{ fontSize: "11px", marginTop: "8px", opacity: 0.7 }}>
            Start recording to create your first transcript!
          </p>
        </div>
      )}

      {showContent && !showLogin && transcripts.length > 0 && (
        <div className="transcripts-list transcripts-table" style={{ position: "relative" }}>
          {loading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(255, 255, 255, 0.7)",
                borderRadius: "8px",
                zIndex: 10,
              }}
            >
              <div className="loading-spinner" />
            </div>
          )}
          <div className="transcripts-table-header">
            <span>Date</span>
            <span>Transcript</span>
            <span>Actions</span>
          </div>
          {transcripts.map((transcript) => (
            <div
              key={transcript.id}
              className="transcript-item transcripts-table-row"
            >
              <div className="transcript-cell transcript-cell-date">
                {formatDateRelative(transcript.created_at)}
              </div>
              <div className="transcript-cell transcript-cell-text">
                {transcript.original_text ? (
                  <span className="transcript-item-text">
                    {transcript.original_text}
                  </span>
                ) : (
                  <span className="transcript-item-empty">
                    {transcript.status === "processing"
                      ? "Processing..."
                      : "No text available"}
                  </span>
                )}
              </div>
              <div className="transcript-cell transcript-cell-meta">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                  }}
                >
                  {transcript.original_text && (
                    <button
                      onClick={() =>
                        handleCopyToClipboard(
                          transcript.original_text || "",
                          transcript.id,
                        )
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "32px",
                        height: "32px",
                        padding: 0,
                        background:
                          copiedId === transcript.id ? "#dcfce7" : "#ffffff",
                        border:
                          copiedId === transcript.id
                            ? "1px solid #22c55e"
                            : "1px solid #e5e7eb",
                        borderRadius: "0.5rem",
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        color:
                          copiedId === transcript.id ? "#16a34a" : "#6b7280",
                      }}
                      onMouseEnter={(e) => {
                        if (copiedId !== transcript.id) {
                          e.currentTarget.style.background = "#f9fafb";
                          e.currentTarget.style.borderColor = "#d1d5db";
                          e.currentTarget.style.color = "#111827";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (copiedId !== transcript.id) {
                          e.currentTarget.style.background = "#ffffff";
                          e.currentTarget.style.borderColor = "#e5e7eb";
                          e.currentTarget.style.color = "#6b7280";
                        }
                      }}
                      title={
                        copiedId === transcript.id
                          ? "Copied!"
                          : "Copy transcript"
                      }
                    >
                      {copiedId === transcript.id ? (
                        <Check size={16} strokeWidth={2.5} />
                      ) : (
                        <Copy size={16} />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      // Regenerate action - placeholder for now
                      console.log(
                        "Regenerate clicked for transcript:",
                        transcript.id,
                      );
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "32px",
                      height: "32px",
                      padding: 0,
                      background: "#ffffff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "0.5rem",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      color: "#6b7280",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#f9fafb";
                      e.currentTarget.style.borderColor = "#d1d5db";
                      e.currentTarget.style.color = "#111827";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "#ffffff";
                      e.currentTarget.style.borderColor = "#e5e7eb";
                      e.currentTarget.style.color = "#6b7280";
                    }}
                    title="Regenerate transcript"
                  >
                    <RefreshCw size={16} />
                  </button>
                  <button
                    onClick={() => openDeleteConfirm(transcript.id)}
                    disabled={!!deletingId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "32px",
                      height: "32px",
                      padding: 0,
                      background: "#ffffff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "0.5rem",
                      cursor: deletingId ? "not-allowed" : "pointer",
                      transition: "all 0.2s ease",
                      color: "#6b7280",
                      opacity: deletingId ? 0.6 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!deletingId) {
                        e.currentTarget.style.background = "#fef2f2";
                        e.currentTarget.style.borderColor = "#fecaca";
                        e.currentTarget.style.color = "#dc2626";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!deletingId) {
                        e.currentTarget.style.background = "#ffffff";
                        e.currentTarget.style.borderColor = "#e5e7eb";
                        e.currentTarget.style.color = "#6b7280";
                      }
                    }}
                    title="Delete transcript"
                  >
                    <Trash2 size={16} />
                  </button>
                  {transcript.audio_file_url && (
                    <audio
                      src={transcript.audio_file_url as string}
                      controls
                      style={{
                        height: "32px",
                        maxWidth: "200px",
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteConfirmId && (
        <div
          className="delete-modal-overlay"
          onClick={closeDeleteConfirm}
        >
          <div
            className="delete-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Delete transcript?</h3>
            <p>
              This action cannot be undone. The transcript will be permanently
              removed.
            </p>
            <div className="delete-modal-actions">
              <button
                type="button"
                className="delete-modal-btn-cancel"
                onClick={closeDeleteConfirm}
                disabled={!!deletingId}
              >
                Cancel
              </button>
              <button
                type="button"
                className="delete-modal-btn-delete"
                onClick={handleConfirmDelete}
                disabled={!!deletingId}
              >
                {deletingId ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
