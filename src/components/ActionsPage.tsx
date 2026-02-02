import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PaginatedActionHistoryResponse, AppConfig } from "../types";
import { useAuthStore } from "../store/authStore";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";
import { HotkeySelector } from "./HotkeySelector";

export const ActionsPage: React.FC = () => {
  const authStore = useAuthStore();
  const [actionHistory, setActionHistory] =
    useState<PaginatedActionHistoryResponse | null>(null);
  const [actionHotkeys, setActionHotkeys] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [formattedDates, setFormattedDates] = useState<Record<string, string>>(
    {},
  );

  const pageSize = 20;

  // Load action history
  const loadActionHistory = async () => {
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      setActionHistory(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const data = await invoke<PaginatedActionHistoryResponse>(
        "get_action_history",
        {
          page,
          pageSize,
        },
      );
      setActionHistory(data);
    } catch (err: any) {
      console.error("Failed to load action history:", err);
      const errorMessage = err?.message || "Failed to load action history";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error loading action history, clearing auth");
        authStore.clearAuth();
        setActionHistory(null);
        setError(null);
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Load app config (for hotkey)
  const loadConfig = async () => {
    try {
      setIsLoadingConfig(true);
      const config = await invoke<AppConfig>("get_app_config");
      setActionHotkeys(config.action_hotkeys || []);
    } catch (err) {
      console.error("Failed to load app config:", err);
    } finally {
      setIsLoadingConfig(false);
    }
  };

  useEffect(() => {
    if (authStore.isInitialized) {
      loadActionHistory();
    }
  }, [page, authStore.isAuthenticated, authStore.isInitialized]);

  useEffect(() => {
    loadConfig();
  }, []);

  const handleDeleteAction = async (actionId: string) => {
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      setError("Please sign in to delete actions");
      return;
    }

    if (!confirm("Are you sure you want to delete this action?")) {
      return;
    }

    try {
      await invoke("delete_action_history", { actionId });
      await loadActionHistory();
    } catch (err: any) {
      const errorMessage = err?.message || "Failed to delete action";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error deleting action, clearing auth");
        authStore.clearAuth();
        setError(null);
      } else {
        setError(errorMessage);
      }
    }
  };

  const handleHotkeyChange = async (newHotkeys: string[]) => {
    try {
      // Get current config to merge
      const currentConfig = await invoke<AppConfig>("get_app_config");

      const updatedConfig = {
        ...currentConfig,
        action_hotkeys: newHotkeys,
      };

      await invoke("update_app_config", { config: updatedConfig });
      setActionHotkeys(newHotkeys);
      console.log("Action hotkeys updated:", newHotkeys);
    } catch (err) {
      console.error("Failed to update action hotkeys:", err);
      setError("Failed to update hotkeys");
    }
  };

  // Format dates for all actions
  useEffect(() => {
    const formatAllDates = async () => {
      if (!actionHistory) return;

      const formatted: Record<string, string> = {};
      for (const action of actionHistory.actions) {
        try {
          const formattedDate = await invoke<string>("format_date_time", {
            dateString: action.created_at,
          });
          formatted[action.id] = formattedDate;
        } catch (error) {
          console.error("Failed to format date:", error);
          // Fallback to simple date string
          formatted[action.id] = new Date(action.created_at).toLocaleString();
        }
      }
      setFormattedDates(formatted);
    };

    if (actionHistory && actionHistory.actions.length > 0) {
      formatAllDates();
    }
  }, [actionHistory]);

  const formatDate = (actionId: string): string => {
    return formattedDates[actionId] || "Loading...";
  };

  // Show loading while waiting for auth to initialize
  if (!authStore.isInitialized) {
    return (
      <div
        style={{
          padding: "2rem 2.5rem",
          background: "#ffffff",
          minHeight: "100vh",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
        }}
      >
        <h2
          style={{
            margin: 0,
            marginBottom: "2rem",
            fontSize: "24px",
            fontWeight: 600,
            color: "#111827",
            letterSpacing: "-0.025em",
          }}
        >
          Actions
        </h2>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "40px",
            color: "#6b7280",
            fontSize: "14px",
          }}
        >
          Loading...
        </div>
      </div>
    );
  }

  // Show login prompt if not authenticated
  if (!authStore.isAuthenticated) {
    return (
      <div
        style={{
          padding: "2rem 2.5rem",
          background: "#ffffff",
          minHeight: "100vh",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
        }}
      >
        <h2
          style={{
            margin: 0,
            marginBottom: "2rem",
            fontSize: "24px",
            fontWeight: 600,
            color: "#111827",
            letterSpacing: "-0.025em",
          }}
        >
          Actions
        </h2>
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <p
            style={{
              fontSize: "0.875rem",
              color: "#6b7280",
              marginBottom: "16px",
            }}
          >
            Sign in to access your actions
          </p>
          <GoogleLoginButton
            onSuccess={() => {
              // Actions will be loaded automatically via useEffect
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
    <div
      style={{
        padding: "2rem 2.5rem",
        background: "#ffffff",
        minHeight: "100vh",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
      }}
    >
      <h2
        style={{
          margin: 0,
          marginBottom: "2rem",
          fontSize: "24px",
          fontWeight: 600,
          color: "#111827",
          letterSpacing: "-0.025em",
        }}
      >
        Actions
      </h2>

      {error && (
        <div
          className="permission-message"
          style={{
            background: "#fef2f2",
            borderColor: "#fecaca",
            color: "#b91c1c",
            fontSize: "11px",
            padding: "12px",
            marginBottom: "16px",
            borderRadius: "0.5rem",
            border: "1px solid",
          }}
        >
          {error}
        </div>
      )}

      {/* Global Hotkey Section */}
      <div style={{ marginBottom: "3rem" }}>
        <h3
          style={{
            margin: 0,
            marginBottom: "0.5rem",
            fontSize: "18px",
            fontWeight: 500,
            color: "#111827",
          }}
        >
          Action Hotkey
        </h3>
        <p
          style={{ fontSize: "14px", color: "#6b7280", marginBottom: "1.5rem" }}
        >
          Hold this hotkey (or any of these hotkeys) to record a voice command
          for performing an action.
        </p>

        <div
          style={{
            backgroundColor: "#1f2937",
            padding: "1.5rem",
            borderRadius: "0.75rem",
            maxWidth: "600px",
          }}
        >
          {isLoadingConfig ? (
            <div style={{ color: "#9ca3af", fontSize: "14px" }}>
              Loading hotkey...
            </div>
          ) : (
            <HotkeySelector
              value={{ hotkeys: actionHotkeys }}
              onChange={(config) => handleHotkeyChange(config.hotkeys)}
              maxHotkeys={3}
            />
          )}
        </div>
      </div>

      {/* Action History Section */}
      <div>
        <h3
          style={{
            margin: 0,
            marginBottom: "1.5rem",
            fontSize: "18px",
            fontWeight: 500,
            color: "#111827",
          }}
        >
          Action History
        </h3>

        {isLoading ? (
          <div
            style={{
              padding: "3rem 1rem",
              textAlign: "center",
              color: "#6b7280",
              fontSize: "0.875rem",
              background: "#ffffff",
              border: "1px solid #f3f4f6",
              borderRadius: "0.75rem",
            }}
          >
            Loading action history...
          </div>
        ) : !actionHistory || actionHistory.actions.length === 0 ? (
          <div
            style={{
              padding: "3rem 1rem",
              textAlign: "center",
              color: "#6b7280",
              fontSize: "0.875rem",
              background: "#ffffff",
              border: "1px solid #f3f4f6",
              borderRadius: "0.75rem",
            }}
          >
            No action history yet. Actions will appear here as you use them.
          </div>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              {actionHistory.actions.map((action) => (
                <div
                  key={action.id}
                  style={{
                    padding: "1.25rem",
                    backgroundColor: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.75rem",
                    transition: "all 0.2s ease",
                    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#d1d5db";
                    e.currentTarget.style.boxShadow =
                      "0 4px 12px rgba(0, 0, 0, 0.08)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "#e5e7eb";
                    e.currentTarget.style.boxShadow =
                      "0 1px 2px rgba(0, 0, 0, 0.05)";
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: "0.75rem",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: "0.9375rem",
                          color: "#111827",
                          fontWeight: 500,
                          marginBottom: "0.25rem",
                        }}
                      >
                        {action.action_command}
                      </div>
                      {action.app_name && (
                        <div
                          style={{
                            fontSize: "0.8125rem",
                            color: "#6b7280",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                          }}
                        >
                          <span
                            style={{
                              width: "6px",
                              height: "6px",
                              borderRadius: "50%",
                              backgroundColor: "#e5e7eb",
                            }}
                          />
                          Context: {action.app_name}
                        </div>
                      )}
                    </div>
                    <button
                      className="transcript-btn"
                      onClick={() => handleDeleteAction(action.id)}
                      style={{
                        padding: "0.5rem 1rem",
                        fontSize: "0.8125rem",
                        fontWeight: 500,
                        backgroundColor: "#ffffff",
                        border: "1px solid #fecaca",
                        borderRadius: "0.5rem",
                        color: "#b91c1c",
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        whiteSpace: "nowrap",
                        marginLeft: "1rem",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#fef2f2";
                        e.currentTarget.style.borderColor = "#fca5a5";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "#ffffff";
                        e.currentTarget.style.borderColor = "#fecaca";
                      }}
                    >
                      Delete
                    </button>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      fontSize: "0.75rem",
                      color: "#9ca3af",
                      borderTop: "1px solid #f3f4f6",
                      paddingTop: "0.75rem",
                    }}
                  >
                    <span>{formatDate(action.id)}</span>
                    <span>•</span>
                    <span style={{ textTransform: "capitalize" }}>
                      {action.action_type.replace("_", " ")}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {actionHistory.total_pages > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: "0.5rem",
                  marginTop: "2rem",
                }}
              >
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.875rem",
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.5rem",
                    background: page === 1 ? "#f3f4f6" : "#ffffff",
                    color: page === 1 ? "#9ca3af" : "#374151",
                    cursor: page === 1 ? "not-allowed" : "pointer",
                  }}
                >
                  Previous
                </button>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "0 1rem",
                    fontSize: "0.875rem",
                    color: "#6b7280",
                  }}
                >
                  Page {page} of {actionHistory.total_pages}
                </div>
                <button
                  onClick={() =>
                    setPage((p) => Math.min(actionHistory.total_pages, p + 1))
                  }
                  disabled={page === actionHistory.total_pages}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.875rem",
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.5rem",
                    background:
                      page === actionHistory.total_pages
                        ? "#f3f4f6"
                        : "#ffffff",
                    color:
                      page === actionHistory.total_pages
                        ? "#9ca3af"
                        : "#374151",
                    cursor:
                      page === actionHistory.total_pages
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
