import React, { useEffect, useState } from "react";
import {
  getActionHistory,
  deleteActionHistory,
  getActionTriggers,
  createActionTrigger,
  updateActionTrigger,
  deleteActionTrigger,
} from "../lib/apiClient";
import { SystemType } from "../lib/constants";
import type {
  ActionHistory,
  PaginatedActionHistoryResponse,
  ActionTrigger,
} from "../types";

export const ActionsPage: React.FC = () => {
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
    try {
      setIsLoading(true);
      setError(null);
      const data = await getActionHistory(page, pageSize);
      setActionHistory(data);
    } catch (err: any) {
      console.error("Failed to load action history:", err);
      setError(err?.message || "Failed to load action history");
    } finally {
      setIsLoading(false);
    }
  };

  // Load triggers
  const loadTriggers = async () => {
    try {
      setIsLoadingTriggers(true);
      const data = await getActionTriggers(SystemType.MAC, true);
      setTriggers(data);
    } catch (err: any) {
      console.error("Failed to load triggers:", err);
    } finally {
      setIsLoadingTriggers(false);
    }
  };

  useEffect(() => {
    loadActionHistory();
  }, [page]);

  useEffect(() => {
    loadTriggers();
  }, []);

  const handleDeleteAction = async (actionId: string) => {
    if (!confirm("Are you sure you want to delete this action?")) {
      return;
    }

    try {
      await deleteActionHistory(actionId);
      await loadActionHistory();
    } catch (err: any) {
      setError(err?.message || "Failed to delete action");
    }
  };

  const handleCreateTrigger = async () => {
    if (!newTriggerPhrase.trim()) {
      setError("Trigger phrase cannot be empty");
      return;
    }

    try {
      setError(null);
      await createActionTrigger(
        {
          trigger_phrase: newTriggerPhrase.trim(),
          is_active: true,
        },
        SystemType.MAC,
      );
      setNewTriggerPhrase("");
      setShowCreateTrigger(false);
      await loadTriggers();
    } catch (err: any) {
      setError(err?.message || "Failed to create trigger");
    }
  };

  const handleUpdateTrigger = async (trigger: ActionTrigger) => {
    try {
      setError(null);
      await updateActionTrigger(
        trigger.id,
        {
          is_active: !trigger.is_active,
        },
        SystemType.MAC,
      );
      await loadTriggers();
      setEditingTrigger(null);
    } catch (err: any) {
      setError(err?.message || "Failed to update trigger");
    }
  };

  const handleDeleteTrigger = async (triggerId: string) => {
    if (!confirm("Are you sure you want to delete this trigger?")) {
      return;
    }

    try {
      setError(null);
      await deleteActionTrigger(triggerId, SystemType.MAC);
      await loadTriggers();
    } catch (err: any) {
      setError(err?.message || "Failed to delete trigger");
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  return (
    <div className="actions-page">
      <h2
        style={{
          margin: 0,
          marginBottom: "32px",
          fontSize: "24px",
          fontWeight: 600,
          color: "#ffffff",
        }}
      >
        Actions
      </h2>

      {error && (
        <div
          className="permission-message"
          style={{
            background: "rgba(255, 59, 48, 0.1)",
            borderColor: "rgba(255, 59, 48, 0.2)",
            color: "rgba(255, 59, 48, 0.9)",
            fontSize: "11px",
            padding: "12px",
            marginBottom: "16px",
            borderRadius: "6px",
          }}
        >
          {error}
        </div>
      )}

      {/* Custom Triggers Section */}
      <div style={{ marginBottom: "48px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: "18px",
              fontWeight: 500,
              color: "#ffffff",
            }}
          >
            Custom Action Triggers
          </h3>
          <button
            className="transcript-btn"
            onClick={() => setShowCreateTrigger(!showCreateTrigger)}
            style={{
              padding: "6px 12px",
              fontSize: "11px",
            }}
          >
            {showCreateTrigger ? "Cancel" : "+ Add Trigger"}
          </button>
        </div>

        {showCreateTrigger && (
          <div
            style={{
              padding: "16px",
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "6px",
              marginBottom: "16px",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                color: "rgba(255, 255, 255, 0.6)",
                marginBottom: "8px",
              }}
            >
              Trigger Phrase
            </div>
            <input
              type="text"
              value={newTriggerPhrase}
              onChange={(e) => setNewTriggerPhrase(e.target.value)}
              placeholder="e.g., 'Hey Lexi', 'Activate', etc."
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: "11px",
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "6px",
                color: "#ffffff",
                marginBottom: "12px",
              }}
            />
            <button
              className="transcript-btn"
              onClick={handleCreateTrigger}
              style={{
                padding: "6px 12px",
                fontSize: "11px",
              }}
            >
              Create Trigger
            </button>
          </div>
        )}

        {isLoadingTriggers ? (
          <div
            style={{
              padding: "20px",
              textAlign: "center",
              color: "rgba(255, 255, 255, 0.6)",
              fontSize: "12px",
            }}
          >
            Loading triggers...
          </div>
        ) : triggers.length === 0 ? (
          <div
            style={{
              padding: "20px",
              textAlign: "center",
              color: "rgba(255, 255, 255, 0.6)",
              fontSize: "12px",
            }}
          >
            No custom triggers. Create one to get started.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {triggers.map((trigger) => (
              <div
                key={trigger.id}
                style={{
                  padding: "12px",
                  backgroundColor: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "6px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: "13px",
                      color: "#ffffff",
                      fontWeight: 500,
                      marginBottom: "4px",
                    }}
                  >
                    {trigger.trigger_phrase}
                  </div>
                  <div
                    style={{
                      fontSize: "10px",
                      color: "rgba(255, 255, 255, 0.5)",
                    }}
                  >
                    {trigger.is_active ? "Active" : "Inactive"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    className="transcript-btn"
                    onClick={() => handleUpdateTrigger(trigger)}
                    style={{
                      padding: "4px 8px",
                      fontSize: "10px",
                      opacity: trigger.is_active ? 0.7 : 1,
                    }}
                  >
                    {trigger.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    className="transcript-btn"
                    onClick={() => handleDeleteTrigger(trigger.id)}
                    style={{
                      padding: "4px 8px",
                      fontSize: "10px",
                      backgroundColor: "rgba(255, 59, 48, 0.2)",
                      borderColor: "rgba(255, 59, 48, 0.3)",
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
            marginBottom: "16px",
            fontSize: "18px",
            fontWeight: 500,
            color: "#ffffff",
          }}
        >
          Action History
        </h3>

        {isLoading ? (
          <div
            style={{
              padding: "40px",
              textAlign: "center",
              color: "rgba(255, 255, 255, 0.6)",
              fontSize: "14px",
            }}
          >
            Loading action history...
          </div>
        ) : !actionHistory || actionHistory.actions.length === 0 ? (
          <div
            style={{
              padding: "40px",
              textAlign: "center",
              color: "rgba(255, 255, 255, 0.6)",
              fontSize: "14px",
            }}
          >
            No action history yet. Actions will appear here as you use them.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {actionHistory.actions.map((action) => (
                <div
                  key={action.id}
                  style={{
                    padding: "16px",
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "6px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: "8px",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: "13px",
                          color: "#ffffff",
                          fontWeight: 500,
                          marginBottom: "4px",
                        }}
                      >
                        {action.action_command}
                      </div>
                      {action.app_name && (
                        <div
                          style={{
                            fontSize: "11px",
                            color: "rgba(255, 255, 255, 0.6)",
                            marginBottom: "4px",
                          }}
                        >
                          App: {action.app_name}
                        </div>
                      )}
                      {action.action_result && (
                        <div
                          style={{
                            fontSize: "11px",
                            color: "rgba(255, 255, 255, 0.7)",
                            marginTop: "8px",
                            padding: "8px",
                            backgroundColor: "rgba(255, 255, 255, 0.03)",
                            borderRadius: "4px",
                          }}
                        >
                          {action.action_result}
                        </div>
                      )}
                    </div>
                    <button
                      className="transcript-btn"
                      onClick={() => handleDeleteAction(action.id)}
                      style={{
                        padding: "4px 8px",
                        fontSize: "10px",
                        backgroundColor: "rgba(255, 59, 48, 0.2)",
                        borderColor: "rgba(255, 59, 48, 0.3)",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  <div
                    style={{
                      fontSize: "10px",
                      color: "rgba(255, 255, 255, 0.5)",
                      marginTop: "8px",
                    }}
                  >
                    {formatDate(action.created_at)} • Type: {action.action_type}
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
                  gap: "12px",
                  marginTop: "24px",
                }}
              >
                <button
                  className="transcript-btn"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  style={{
                    padding: "6px 12px",
                    fontSize: "11px",
                    opacity: page === 1 ? 0.5 : 1,
                    cursor: page === 1 ? "not-allowed" : "pointer",
                  }}
                >
                  Previous
                </button>
                <span
                  style={{
                    fontSize: "12px",
                    color: "rgba(255, 255, 255, 0.7)",
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
                    padding: "6px 12px",
                    fontSize: "11px",
                    opacity: page === actionHistory.total_pages ? 0.5 : 1,
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

