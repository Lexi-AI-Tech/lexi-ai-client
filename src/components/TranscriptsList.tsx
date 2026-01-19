/**
 * TranscriptsList Component
 *
 * Displays a list of transcripts fetched from the backend API.
 * Requires authentication to view transcripts.
 */

import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Transcript } from "../types";
import { waitForNetwork, waitForStartupDelay } from "../lib/networkUtils";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { useAuthStore } from "../store/authStore";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";

export const TranscriptsList: React.FC = () => {
  const authStore = useAuthStore();
  const networkStatus = useNetworkStatus();
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
        // Auth error - try to refresh token first before clearing
        console.log("🔄 Auth error detected, attempting token refresh...");
        try {
          const refreshed = await invoke<boolean>("refresh_auth_token");
          if (refreshed) {
            console.log("✅ Token refreshed, retrying fetch...");
            // Retry fetch after successful refresh
            await fetchTranscripts();
            return;
          } else {
            console.log("⚠️ Token refresh failed, clearing auth");
          }
        } catch (refreshErr) {
          console.error("Token refresh error:", refreshErr);
        } finally {
          authStore.clearAuth();
        }
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
  }, [
    authStore.isAuthenticated,
    authStore.isInitialized,
    authStore.tokens?.access_token,
    page,
  ]);

  // Fetch transcripts when authenticated and page changes
  useEffect(() => {
    let cancelled = false;

    const loadTranscripts = async () => {
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
        // Ready to fetch - user is authenticated and tokens are loaded
        // Wait for network to be available (especially important on auto-startup)
        setLoading(true);

        // Give network time to connect on startup
        await waitForStartupDelay(2000);
        if (cancelled) return;

        // Check network connectivity before making API call
        const isOnline = await waitForNetwork(3, 1000);
        if (cancelled) return;

        if (isOnline) {
          fetchTranscripts();
        } else {
          // Network not available - set loading to false so UI can show network message
          console.debug("Network not available, skipping transcript fetch");
          setTranscripts([]);
          setError(null);
          setLoading(false);
          // Trigger network status check to update UI
          networkStatus.retry();
        }
      } else {
        // Not authenticated - clear and show login prompt
        setTranscripts([]);
        setError(null);
        setLoading(false);
      }
    };

    loadTranscripts();

    return () => {
      cancelled = true;
    };
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

  // Format dates for all transcripts
  const [formattedDates, setFormattedDates] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    const formatAllDates = async () => {
      const formatted: Record<string, string> = {};
      for (const transcript of transcripts) {
        try {
          const formattedDate = await invoke<string>("format_date_relative", {
            dateString: transcript.created_at,
          });
          formatted[transcript.id] = formattedDate;
        } catch (error) {
          console.error("Failed to format date:", error);
          // Fallback to simple date string
          formatted[transcript.id] = new Date(
            transcript.created_at,
          ).toLocaleDateString();
        }
      }
      setFormattedDates(formatted);
    };

    if (transcripts.length > 0) {
      formatAllDates();
    }
  }, [transcripts]);

  const formatDate = (transcriptId: string): string => {
    return formattedDates[transcriptId] || "Loading...";
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
            color: "rgba(255, 255, 255, 0.6)",
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

      {/* Show network offline message if not online */}
      {!networkStatus.isOnline && authStore.isAuthenticated && (
        <div
          className="permission-message"
          style={{
            background: "rgba(255, 193, 7, 0.1)",
            borderColor: "rgba(255, 193, 7, 0.2)",
            color: "rgba(255, 193, 7, 0.9)",
            marginBottom: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  marginBottom: "4px",
                }}
              >
                Internet Connection Required
              </div>
              <div style={{ fontSize: "11px", opacity: 0.8 }}>
                Please check your internet connection to load transcripts.
              </div>
            </div>
            <button
              className="transcript-btn"
              onClick={networkStatus.retry}
              disabled={networkStatus.isChecking}
              style={{
                fontSize: "11px",
                padding: "6px 12px",
                whiteSpace: "nowrap",
              }}
            >
              {networkStatus.isChecking ? "Checking..." : "Retry"}
            </button>
          </div>
        </div>
      )}

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
                      {formatDate(transcript.id)}
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
