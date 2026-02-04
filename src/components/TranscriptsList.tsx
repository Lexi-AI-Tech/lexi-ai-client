/**
 * TranscriptsList Component
 *
 * Displays a list of transcripts fetched from the backend API.
 * Requires authentication to view transcripts.
 */

import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, RefreshCw, Check } from "lucide-react";
import type { Transcript } from "../types";
import { formatDateRelative } from "../lib/dateUtils";
import { useAuthStore } from "../store/authStore";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";

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

  // Fetch transcripts when authenticated and page changes
  useEffect(() => {
    const loadTranscripts = () => {
      // Step 1: Wait for auth store to initialize
      if (!authStore.isInitialized) {
        setLoading(true);
        setError(null);
        return; // Show loading while waiting for initialization
      }

      // Step 2: If authenticated, wait for tokens to be loaded
      if (authStore.isAuthenticated && !authStore.tokens?.access_token) {
        setLoading(true);
        setError(null);
        return; // Show loading while waiting for tokens
      }

      // Step 3: Now we know the auth state - either authenticated with tokens, or not authenticated
      setError(null);

      if (authStore.isAuthenticated && authStore.tokens?.access_token) {
        setLoading(true);
        fetchTranscripts();
      } else {
        // Not authenticated - clear and show login prompt
        setTranscripts([]);
        setError(null);
        setLoading(false);
      }
    };

    loadTranscripts();
  }, [
    authStore.isAuthenticated,
    authStore.isInitialized,
    authStore.tokens?.access_token,
    page,
    fetchTranscripts,
  ]);

  const handleDelete = async (transcriptId: string) => {
    if (!confirm("Are you sure you want to delete this transcript?")) {
      return;
    }

    setDeletingId(transcriptId);
    try {
      await invoke("delete_transcript", { transcriptId });
      // Refresh the list
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


  // Show loading while waiting for auth to initialize or tokens to load
  if (
    !authStore.isInitialized ||
    (authStore.isAuthenticated && !authStore.tokens?.access_token)
  ) {
    return (
      <div className="settings">
        <h3>Transcripts</h3>
        <div
          style={{
            textAlign: "center",
            padding: "24px",
            color: "#6b7280",
          }}
        >
          Loading...
        </div>
      </div>
    );
  }

  // Show login prompt if not authenticated (only after we've confirmed auth state)
  if (!authStore.isAuthenticated) {
    return (
      <div className="settings">
        <h3>Transcripts</h3>
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <p className="permission-text" style={{ marginBottom: "16px" }}>
            Sign in to view your transcription history
          </p>
          <GoogleLoginButton
            onSuccess={() => {
              // Transcripts will be fetched automatically via useEffect
            }}
            onError={(err) => {
              setError(err || "Authentication failed");
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="settings">
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

      {loading && transcripts.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "24px",
            color: "#6b7280",
          }}
        >
          Loading transcripts...
        </div>
      )}

      {error && (
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

      {!loading && !error && transcripts.length === 0 && (
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

      {!loading && transcripts.length > 0 && (
        <div className="transcripts-list transcripts-table">
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
    </div>
  );
};
