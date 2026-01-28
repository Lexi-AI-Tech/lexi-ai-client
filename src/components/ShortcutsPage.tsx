import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Shortcut } from "../types";
import { useAuthStore } from "../store/authStore";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";

export const ShortcutsPage: React.FC = () => {
  const authStore = useAuthStore();
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateShortcut, setShowCreateShortcut] = useState(false);
  const [newShortcut, setNewShortcut] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editingShortcut, setEditingShortcut] = useState<Shortcut | null>(null);

  // Load shortcuts
  const loadShortcuts = async () => {
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      setShortcuts([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const data = await invoke<Shortcut[]>("get_shortcuts");
      setShortcuts(data);
    } catch (err: any) {
      console.error("Failed to load shortcuts:", err);
      const errorMessage = err?.message || "Failed to load shortcuts";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error loading shortcuts, clearing auth");
        authStore.clearAuth();
        setShortcuts([]);
        setError(null);
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (authStore.isInitialized) {
      loadShortcuts();
    }
  }, [authStore.isAuthenticated, authStore.isInitialized]);

  const handleCreateShortcut = async () => {
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      setError("Please sign in to create shortcuts");
      return;
    }

    if (!newShortcut.trim() || !newValue.trim()) {
      setError("Both shortcut and value are required");
      return;
    }

    try {
      setError(null);
      await invoke<Shortcut>("create_shortcut", {
        request: {
          shortcut: newShortcut.trim(),
          value: newValue.trim(),
        },
      });
      setNewShortcut("");
      setNewValue("");
      setShowCreateShortcut(false);
      await loadShortcuts();
    } catch (err: any) {
      const errorMessage = err?.message || "Failed to create shortcut";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error creating shortcut, clearing auth");
        authStore.clearAuth();
        setError(null);
      } else {
        setError(errorMessage);
      }
    }
  };

  const handleUpdateShortcut = async (shortcut: Shortcut) => {
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      setError("Please sign in to update shortcuts");
      return;
    }

    if (!editingShortcut) {
      setEditingShortcut(shortcut);
      return;
    }

    if (editingShortcut.id !== shortcut.id) {
      setEditingShortcut(shortcut);
      return;
    }

    try {
      setError(null);
      await invoke<Shortcut>("update_shortcut", {
        shortcutId: shortcut.id,
        request: {
          shortcut: editingShortcut.shortcut,
          value: editingShortcut.value,
        },
      });
      await loadShortcuts();
      setEditingShortcut(null);
    } catch (err: any) {
      const errorMessage = err?.message || "Failed to update shortcut";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error updating shortcut, clearing auth");
        authStore.clearAuth();
        setError(null);
      } else {
        setError(errorMessage);
      }
    }
  };

  const handleDeleteShortcut = async (shortcutId: string) => {
    if (!authStore.isAuthenticated || !authStore.tokens?.access_token) {
      setError("Please sign in to delete shortcuts");
      return;
    }

    if (!confirm("Are you sure you want to delete this shortcut?")) {
      return;
    }

    try {
      setError(null);
      await invoke("delete_shortcut", {
        shortcutId,
      });
      await loadShortcuts();
    } catch (err: any) {
      const errorMessage = err?.message || "Failed to delete shortcut";
      const isAuthError =
        errorMessage.includes("401") ||
        errorMessage.includes("403") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Not authenticated");

      if (isAuthError) {
        console.log("Auth error deleting shortcut, clearing auth");
        authStore.clearAuth();
        setError(null);
      } else {
        setError(errorMessage);
      }
    }
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
          Shortcuts
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
          Shortcuts
        </h2>
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <p
            style={{
              fontSize: "0.875rem",
              color: "#6b7280",
              marginBottom: "16px",
            }}
          >
            Sign in to access your shortcuts
          </p>
          <GoogleLoginButton
            onSuccess={() => {
              // Shortcuts will be loaded automatically via useEffect
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
        Shortcuts
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

      {/* Shortcuts Section */}
      <div>
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
            Custom Shortcuts
          </h3>
          <button
            className="transcript-btn"
            onClick={() => {
              setShowCreateShortcut(!showCreateShortcut);
              setNewShortcut("");
              setNewValue("");
            }}
            style={{
              padding: "0.5rem 1.5rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              backgroundColor: showCreateShortcut ? "#ffffff" : "#111827",
              border: `1px solid ${showCreateShortcut ? "#e5e7eb" : "#111827"}`,
              borderRadius: "0.5rem",
              color: showCreateShortcut ? "#6b7280" : "#ffffff",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              if (showCreateShortcut) {
                e.currentTarget.style.background = "#f9fafb";
                e.currentTarget.style.borderColor = "#d1d5db";
                e.currentTarget.style.color = "#111827";
              } else {
                e.currentTarget.style.background = "#374151";
                e.currentTarget.style.borderColor = "#374151";
              }
            }}
            onMouseLeave={(e) => {
              if (showCreateShortcut) {
                e.currentTarget.style.background = "#ffffff";
                e.currentTarget.style.borderColor = "#e5e7eb";
                e.currentTarget.style.color = "#6b7280";
              } else {
                e.currentTarget.style.background = "#111827";
                e.currentTarget.style.borderColor = "#111827";
              }
            }}
          >
            {showCreateShortcut ? "Cancel" : "+ Add Shortcut"}
          </button>
        </div>

        {showCreateShortcut && (
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
              Shortcut
            </div>
            <input
              type="text"
              value={newShortcut}
              onChange={(e) => setNewShortcut(e.target.value)}
              placeholder="e.g., 'hey lexi'"
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
              Value
            </div>
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="e.g., 'Hello, this is Lexi'"
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
              onClick={handleCreateShortcut}
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
              Create Shortcut
            </button>
          </div>
        )}

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
            Loading shortcuts...
          </div>
        ) : shortcuts.length === 0 ? (
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
            No shortcuts. Create one to get started.
          </div>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
          >
            {shortcuts.map((shortcut) => {
              const isEditing = editingShortcut?.id === shortcut.id;
              return (
                <div
                  key={shortcut.id}
                  style={{
                    padding: "1.25rem",
                    backgroundColor: "#ffffff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.75rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "1rem",
                    transition: "all 0.2s ease",
                    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isEditing) {
                      e.currentTarget.style.borderColor = "#d1d5db";
                      e.currentTarget.style.boxShadow =
                        "0 4px 12px rgba(0, 0, 0, 0.08)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isEditing) {
                      e.currentTarget.style.borderColor = "#e5e7eb";
                      e.currentTarget.style.boxShadow =
                        "0 1px 2px rgba(0, 0, 0, 0.05)";
                    }
                  }}
                >
                  {isEditing ? (
                    <>
                      <div>
                        <div
                          style={{
                            fontSize: "0.6875rem",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            color: "#9ca3af",
                            marginBottom: "0.5rem",
                          }}
                        >
                          Shortcut
                        </div>
                        <input
                          type="text"
                          value={editingShortcut.shortcut}
                          onChange={(e) =>
                            setEditingShortcut({
                              ...editingShortcut,
                              shortcut: e.target.value,
                            })
                          }
                          style={{
                            width: "100%",
                            padding: "0.875rem 1rem",
                            fontSize: "0.875rem",
                            fontWeight: 500,
                            backgroundColor: "#ffffff",
                            border: "1px solid #e5e7eb",
                            borderRadius: "0.625rem",
                            color: "#111827",
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
                        />
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: "0.6875rem",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            color: "#9ca3af",
                            marginBottom: "0.5rem",
                          }}
                        >
                          Value
                        </div>
                        <input
                          type="text"
                          value={editingShortcut.value}
                          onChange={(e) =>
                            setEditingShortcut({
                              ...editingShortcut,
                              value: e.target.value,
                            })
                          }
                          style={{
                            width: "100%",
                            padding: "0.875rem 1rem",
                            fontSize: "0.875rem",
                            fontWeight: 500,
                            backgroundColor: "#ffffff",
                            border: "1px solid #e5e7eb",
                            borderRadius: "0.625rem",
                            color: "#111827",
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
                        />
                      </div>
                      <div style={{ display: "flex", gap: "0.75rem" }}>
                        <button
                          className="transcript-btn"
                          onClick={() => handleUpdateShortcut(shortcut)}
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
                          Save
                        </button>
                        <button
                          className="transcript-btn"
                          onClick={() => setEditingShortcut(null)}
                          style={{
                            padding: "0.5rem 1.5rem",
                            fontSize: "0.875rem",
                            fontWeight: 500,
                            backgroundColor: "#ffffff",
                            border: "1px solid #e5e7eb",
                            borderRadius: "0.5rem",
                            color: "#6b7280",
                            cursor: "pointer",
                            transition: "all 0.2s ease",
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
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            fontSize: "0.9375rem",
                            color: "#111827",
                            fontWeight: 500,
                            marginBottom: "0.25rem",
                          }}
                        >
                          {shortcut.shortcut}
                        </div>
                        <div
                          style={{
                            fontSize: "0.8125rem",
                            color: "#6b7280",
                            marginBottom: "0.25rem",
                          }}
                        >
                          → {shortcut.value}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "0.75rem" }}>
                        <button
                          className="transcript-btn"
                          onClick={() => handleUpdateShortcut(shortcut)}
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
                          Edit
                        </button>
                        <button
                          className="transcript-btn"
                          onClick={() => handleDeleteShortcut(shortcut.id)}
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
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
