import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PaginatedActionHistoryResponse, ActionTrigger } from "../types";
import { useAuthStore } from "../store/authStore";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";

export const ActionsPage: React.FC = () => {
  const authStore = useAuthStore();
  const [actionHistory, setActionHistory] =
    useState<PaginatedActionHistoryResponse | null>(null);
  const [triggers, setTriggers] = useState<ActionTrigger[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingTriggers, setIsLoadingTriggers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [showCreateTrigger, setShowCreateTrigger] = useState(false);
  const [newTriggerPhrase, setNewTriggerPhrase] = useState("");
  const [editingTrigger, setEditingTrigger] = useState<ActionTrigger | null>(
    null,
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

  // Load triggers
  const loadTriggers = async () => {
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      setTriggers([]);
      setIsLoadingTriggers(false);
      return;
    }

    try {
      setIsLoadingTriggers(true);
      const data = await invoke<ActionTrigger[]>("get_action_triggers", {
        includeInactive: true,
      });
      setTriggers(data);
    } catch (err: any) {
      console.error("Failed to load triggers:", err);
      const errorMessage = err?.message || "Failed to load triggers";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error loading triggers, clearing auth");
        authStore.clearAuth();
        setTriggers([]);
      }
    } finally {
      setIsLoadingTriggers(false);
    }
  };

  useEffect(() => {
    if (authStore.isInitialized) {
      loadActionHistory();
    }
  }, [page, authStore.isAuthenticated, authStore.isInitialized]);

  useEffect(() => {
    if (authStore.isInitialized) {
      loadTriggers();
    }
  }, [authStore.isAuthenticated, authStore.isInitialized]);

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

  const handleCreateTrigger = async () => {
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      setError("Please sign in to create triggers");
      return;
    }

    if (!newTriggerPhrase.trim()) {
      setError("Trigger phrase cannot be empty");
      return;
    }

    try {
      setError(null);
      await invoke<ActionTrigger>("create_action_trigger", {
        request: {
          trigger_phrase: newTriggerPhrase.trim(),
          is_active: true,
        },
      });
      setNewTriggerPhrase("");
      setShowCreateTrigger(false);
      await loadTriggers();
    } catch (err: any) {
      const errorMessage = err?.message || "Failed to create trigger";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error creating trigger, clearing auth");
        authStore.clearAuth();
        setError(null);
      } else {
        setError(errorMessage);
      }
    }
  };

  const handleUpdateTrigger = async (trigger: ActionTrigger) => {
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      setError("Please sign in to update triggers");
      return;
    }

    try {
      setError(null);
      await invoke<ActionTrigger>("update_action_trigger", {
        triggerId: trigger.id,
        request: {
          is_active: !trigger.is_active,
        },
      });
      await loadTriggers();
      setEditingTrigger(null);
    } catch (err: any) {
      const errorMessage = err?.message || "Failed to update trigger";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error updating trigger, clearing auth");
        authStore.clearAuth();
        setError(null);
      } else {
        setError(errorMessage);
      }
    }
  };

  const handleDeleteTrigger = async (triggerId: string) => {
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      setError("Please sign in to delete triggers");
      return;
    }

    if (!confirm("Are you sure you want to delete this trigger?")) {
      return;
    }

    try {
      setError(null);
      await invoke("delete_action_trigger", {
        triggerId,
      });
      await loadTriggers();
    } catch (err: any) {
      const errorMessage = err?.message || "Failed to delete trigger";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error deleting trigger, clearing auth");
        authStore.clearAuth();
        setError(null);
      } else {
        setError(errorMessage);
      }
    }
  };

  // Format dates for all actions
  const [formattedDates, setFormattedDates] = useState<Record<string, string>>(
    {},
  );

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

      {/* Custom Triggers Section */}
      <div style={{ marginBottom: "3rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1.5rem",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: "18px",
              fontWeight: 500,
              color: "#111827",
            }}
          >
            Custom Action Triggers
          </h3>
          <button
            className="transcript-btn"
            onClick={() => setShowCreateTrigger(!showCreateTrigger)}
            style={{
              padding: "0.5rem 1.5rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              backgroundColor: showCreateTrigger ? "#ffffff" : "#111827",
              border: `1px solid ${showCreateTrigger ? "#e5e7eb" : "#111827"}`,
              borderRadius: "0.5rem",
              color: showCreateTrigger ? "#6b7280" : "#ffffff",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              if (showCreateTrigger) {
                e.currentTarget.style.background = "#f9fafb";
                e.currentTarget.style.borderColor = "#d1d5db";
                e.currentTarget.style.color = "#111827";
              } else {
                e.currentTarget.style.background = "#374151";
                e.currentTarget.style.borderColor = "#374151";
              }
            }}
            onMouseLeave={(e) => {
              if (showCreateTrigger) {
                e.currentTarget.style.background = "#ffffff";
                e.currentTarget.style.borderColor = "#e5e7eb";
                e.currentTarget.style.color = "#6b7280";
              } else {
                e.currentTarget.style.background = "#111827";
                e.currentTarget.style.borderColor = "#111827";
              }
            }}
          >
            {showCreateTrigger ? "Cancel" : "+ Add Trigger"}
          </button>
        </div>

        {showCreateTrigger && (
          <div
            style={{
              padding: "1.5rem",
              backgroundColor: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "0.75rem",
              marginBottom: "1.5rem",
              boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
            }}
          >
            <div
              style={{
                fontSize: "0.6875rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "#9ca3af",
                marginBottom: "0.75rem",
              }}
            >
              Trigger Phrase
            </div>
            <input
              type="text"
              value={newTriggerPhrase}
              onChange={(e) => setNewTriggerPhrase(e.target.value)}
              placeholder="e.g., 'Activate', 'Start', etc."
              style={{
                width: "100%",
                padding: "0.875rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                backgroundColor: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "0.625rem",
                color: "#111827",
                marginBottom: "1rem",
                outline: "none",
                transition: "all 0.2s ease",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#6366f1";
                e.currentTarget.style.boxShadow =
                  "0 0 0 3px rgba(99, 102, 241, 0.1), 0 1px 2px rgba(0, 0, 0, 0.05)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#e5e7eb";
                e.currentTarget.style.boxShadow =
                  "0 1px 2px rgba(0, 0, 0, 0.05)";
              }}
              onMouseEnter={(e) => {
                if (document.activeElement !== e.currentTarget) {
                  e.currentTarget.style.borderColor = "#d1d5db";
                  e.currentTarget.style.boxShadow =
                    "0 2px 4px rgba(0, 0, 0, 0.08)";
                }
              }}
              onMouseLeave={(e) => {
                if (document.activeElement !== e.currentTarget) {
                  e.currentTarget.style.borderColor = "#e5e7eb";
                  e.currentTarget.style.boxShadow =
                    "0 1px 2px rgba(0, 0, 0, 0.05)";
                }
              }}
            />
            <button
              className="transcript-btn"
              onClick={handleCreateTrigger}
              style={{
                padding: "0.5rem 1.5rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                backgroundColor: "#111827",
                border: "1px solid #111827",
                borderRadius: "0.5rem",
                color: "#ffffff",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#374151";
                e.currentTarget.style.borderColor = "#374151";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#111827";
                e.currentTarget.style.borderColor = "#111827";
              }}
            >
              Create Trigger
            </button>
          </div>
        )}

        {isLoadingTriggers ? (
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
            Loading triggers...
          </div>
        ) : triggers.length === 0 ? (
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
            No custom triggers. Create one to get started.
          </div>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
          >
            {triggers.map((trigger) => (
              <div
                key={trigger.id}
                style={{
                  padding: "1.25rem",
                  backgroundColor: "#ffffff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "0.75rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
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
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: "0.9375rem",
                      color: "#111827",
                      fontWeight: 500,
                      marginBottom: "0.25rem",
                    }}
                  >
                    {trigger.trigger_phrase}
                  </div>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "#9ca3af",
                    }}
                  >
                    {trigger.is_active ? "Active" : "Inactive"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button
                    className="transcript-btn"
                    onClick={() => handleUpdateTrigger(trigger)}
                    style={{
                      padding: "0.5rem 1rem",
                      fontSize: "0.8125rem",
                      fontWeight: 500,
                      backgroundColor: "#ffffff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "0.5rem",
                      color: "#6b7280",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      opacity: trigger.is_active ? 0.7 : 1,
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
                  >
                    {trigger.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    className="transcript-btn"
                    onClick={() => handleDeleteTrigger(trigger.id)}
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
              </div>
            ))}
          </div>
        )}
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
                            marginBottom: "0.25rem",
                          }}
                        >
                          App: {action.app_name}
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
                      fontSize: "0.75rem",
                      color: "#9ca3af",
                      marginTop: "0.5rem",
                    }}
                  >
                    {formatDate(action.id)} • Type: {action.action_type}
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
                  alignItems: "center",
                  gap: "0.75rem",
                  marginTop: "1.5rem",
                }}
              >
                <button
                  className="transcript-btn"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.8125rem",
                    fontWeight: 500,
                    backgroundColor: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.5rem",
                    color: "#6b7280",
                    opacity: page === 1 ? 0.5 : 1,
                    cursor: page === 1 ? "not-allowed" : "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (page !== 1) {
                      e.currentTarget.style.background = "#f9fafb";
                      e.currentTarget.style.borderColor = "#d1d5db";
                      e.currentTarget.style.color = "#111827";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (page !== 1) {
                      e.currentTarget.style.background = "#ffffff";
                      e.currentTarget.style.borderColor = "#e5e7eb";
                      e.currentTarget.style.color = "#6b7280";
                    }
                  }}
                >
                  Previous
                </button>
                <span
                  style={{
                    fontSize: "0.8125rem",
                    color: "#6b7280",
                  }}
                >
                  Page {page} of {actionHistory.total_pages}
                </span>
                <button
                  className="transcript-btn"
                  onClick={() =>
                    setPage((p) => Math.min(actionHistory.total_pages, p + 1))
                  }
                  disabled={page === actionHistory.total_pages}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.8125rem",
                    fontWeight: 500,
                    backgroundColor: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.5rem",
                    color: "#6b7280",
                    opacity: page === actionHistory.total_pages ? 0.5 : 1,
                    cursor:
                      page === actionHistory.total_pages
                        ? "not-allowed"
                        : "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (page !== actionHistory.total_pages) {
                      e.currentTarget.style.background = "#f9fafb";
                      e.currentTarget.style.borderColor = "#d1d5db";
                      e.currentTarget.style.color = "#111827";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (page !== actionHistory.total_pages) {
                      e.currentTarget.style.background = "#ffffff";
                      e.currentTarget.style.borderColor = "#e5e7eb";
                      e.currentTarget.style.color = "#6b7280";
                    }
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
