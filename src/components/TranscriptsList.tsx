/**
 * TranscriptsList Component
 *
 * Displays a list of transcripts fetched from the backend API.
 * Requires authentication to view transcripts.
 */

import React, { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "../store/authStore";
import {
  getTranscripts,
  deleteTranscript,
  type Transcript,
  type PaginatedTranscriptsResponse,
} from "../lib/apiClient";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";

export const TranscriptsList: React.FC = () => {
  const authStore = useAuthStore();
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Clear error on mount to prevent stale error messages
  useEffect(() => {
    setError(null);
  }, []);

  // Fetch transcripts function
  const fetchTranscripts = useCallback(async () => {
    // Wait for auth store to initialize before attempting to fetch
    if (!authStore.isInitialized) {
      return;
    }

    if (!authStore.isAuthenticated) {
      // Clear transcripts when not authenticated (expected state, not an error)
      setTranscripts([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response: PaginatedTranscriptsResponse = await getTranscripts(
        page,
        10,
      );
      setTranscripts(response.transcripts);
      setTotalPages(response.total_pages);
      setTotal(response.total);
    } catch (err: any) {
      console.error("Failed to fetch transcripts:", err);
      
      // Check error type
      const errorMessage = err.message || "Failed to load transcripts";
      const isAuthError = errorMessage.includes("401") || 
                         errorMessage.includes("403") ||
                         errorMessage.includes("Unauthorized");
      
      // Check for network errors (server unreachable, no internet, etc.)
      const isNetworkError = err.name === "TypeError" ||
                            err.name === "NetworkError" ||
                            errorMessage.includes("Failed to fetch") ||
                            errorMessage.includes("NetworkError") ||
                            errorMessage.includes("network") ||
                            errorMessage.includes("ECONNREFUSED");
      
      if (isAuthError) {
        // Auth error - clear transcripts and let the login prompt show
        setTranscripts([]);
        setError(null);
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
  }, [authStore.isAuthenticated, authStore.isInitialized, page]);

  // Fetch transcripts when authenticated and page changes
  useEffect(() => {
    // Wait for auth store to initialize
    if (!authStore.isInitialized) {
      setLoading(true);
      setError(null); // Clear any previous errors while initializing
      return;
    }

    // Clear error when auth state changes
    setError(null);

    if (authStore.isAuthenticated) {
      fetchTranscripts();
    } else {
      // Clear transcripts when not authenticated
      setTranscripts([]);
      setError(null);
      setLoading(false);
    }
  }, [authStore.isAuthenticated, authStore.isInitialized, page, fetchTranscripts]);

  const handleDelete = async (transcriptId: number) => {
    if (!confirm("Are you sure you want to delete this transcript?")) {
      return;
    }

    setDeletingId(transcriptId);
    try {
      await deleteTranscript(transcriptId);
      // Refresh the list
      await fetchTranscripts();
    } catch (err: any) {
      console.error("Failed to delete transcript:", err);
      alert(err.message || "Failed to delete transcript");
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return "Just now";
    } else if (diffMins < 60) {
      return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status.toLowerCase()) {
      case "completed":
        return "rgba(52, 199, 89, 0.2)";
      case "processing":
        return "rgba(255, 193, 7, 0.2)";
      case "failed":
        return "rgba(255, 59, 48, 0.2)";
      default:
        return "rgba(255, 255, 255, 0.05)";
    }
  };

  const getStatusBorderColor = (status: string): string => {
    switch (status.toLowerCase()) {
      case "completed":
        return "rgba(52, 199, 89, 0.4)";
      case "processing":
        return "rgba(255, 193, 7, 0.4)";
      case "failed":
        return "rgba(255, 59, 48, 0.4)";
      default:
        return "rgba(255, 255, 255, 0.1)";
    }
  };

  // Wait for auth store to initialize before showing login prompt
  // Show login prompt if not authenticated (but only after initialization)
  if (authStore.isInitialized && !authStore.isAuthenticated) {
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
            color: "rgba(255, 255, 255, 0.6)",
          }}
        >
          Loading transcripts...
        </div>
      )}

      {error && (
        <div
          className="permission-message"
          style={{
            background: "rgba(255, 59, 48, 0.1)",
            borderColor: "rgba(255, 59, 48, 0.2)",
            color: "rgba(255, 59, 48, 0.9)",
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
            color: "rgba(255, 255, 255, 0.6)",
          }}
        >
          <p>No transcripts yet.</p>
          <p style={{ fontSize: "11px", marginTop: "8px", opacity: 0.7 }}>
            Start recording to create your first transcript!
          </p>
        </div>
      )}

      {!loading && transcripts.length > 0 && (
        <div className="transcripts-list">
          {transcripts.map((transcript) => (
            <div
              key={transcript.id}
              className="transcript-item"
              style={{
                background: getStatusColor(transcript.status),
                borderColor: getStatusBorderColor(transcript.status),
              }}
            >
              <div className="transcript-item-header">
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "4px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "10px",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: "rgba(255, 255, 255, 0.1)",
                        border: "1px solid rgba(255, 255, 255, 0.2)",
                        textTransform: "uppercase",
                        fontWeight: "600",
                      }}
                    >
                      {transcript.status}
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        color: "rgba(255, 255, 255, 0.5)",
                      }}
                    >
                      {formatDate(transcript.created_at)}
                    </span>
                  </div>
                </div>
                <button
                  className="transcript-btn"
                  onClick={() => handleDelete(transcript.id)}
                  disabled={deletingId === transcript.id}
                  style={{
                    background: "rgba(255, 59, 48, 0.1)",
                    borderColor: "rgba(255, 59, 48, 0.3)",
                    color: "rgba(255, 59, 48, 0.8)",
                    fontSize: "10px",
                    padding: "4px 8px",
                  }}
                >
                  {deletingId === transcript.id ? "Deleting..." : "Delete"}
                </button>
              </div>
              {transcript.original_text ? (
                <div className="transcript-item-text">
                  {transcript.original_text}
                </div>
              ) : (
                <div
                  style={{
                    fontSize: "11px",
                    color: "rgba(255, 255, 255, 0.5)",
                    fontStyle: "italic",
                  }}
                >
                  {transcript.status === "processing"
                    ? "Processing..."
                    : "No text available"}
                </div>
              )}
              {transcript.provider && (
                <div
                  style={{
                    fontSize: "10px",
                    color: "rgba(255, 255, 255, 0.4)",
                    marginTop: "4px",
                  }}
                >
                  {transcript.provider}
                  {transcript.asr_model && ` • ${transcript.asr_model}`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
