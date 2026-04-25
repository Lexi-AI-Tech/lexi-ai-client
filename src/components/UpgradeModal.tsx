import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Check, Zap, Sparkles } from "lucide-react";
import { useToast } from "./toast/useToast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeatureUsageEntry {
  feature_key: string;
  enabled: boolean;
  used: number;
  limit_value: number | null;
  limit_reset: string | null;
  metered: boolean;
}

interface BillingUsageResponse {
  plan_type: string;
  period_start: string;
  period_end: string;
  limit_reset: string;
  features: FeatureUsageEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

interface PlanFeatureRow {
  key: string;
  label: string;
  freeLimitLabel: string;
  proLimitLabel: string;
  freeLimit: number | null; // null = unlimited
}

/** Static plan comparison table. These match backend feature keys. */
const PLAN_COMPARISON: PlanFeatureRow[] = [
  {
    key: "assistant.speech_to_text",
    label: "Transcriptions",
    freeLimitLabel: "1,000 words / month",
    proLimitLabel: "Unlimited",
    freeLimit: 1000,
  },
  {
    key: "meetings.create",
    label: "Meeting Sessions",
    freeLimitLabel: "5 sessions / month",
    proLimitLabel: "Unlimited",
    freeLimit: 5,
  },
  {
    key: "actions.perform",
    label: "AI Actions",
    freeLimitLabel: "20 actions / month",
    proLimitLabel: "Unlimited",
    freeLimit: 20,
  },
];

const FEATURE_USAGE_SUFFIX: Record<string, string> = {
  "assistant.speech_to_text": "words",
  "meetings.create": "sessions",
  "actions.perform": "actions",
};

function featureUsageSuffix(key: string): string {
  return FEATURE_USAGE_SUFFIX[key] ?? "used";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const CheckIcon: React.FC<{ pro?: boolean }> = ({ pro = false }) => (
  <div
    style={{
      width: 18,
      height: 18,
      borderRadius: "50%",
      background: pro
        ? "linear-gradient(135deg, #059669, #047857)"
        : "#e5e7eb",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    }}
  >
    <Check size={11} color={pro ? "#ffffff" : "#9ca3af"} strokeWidth={3} />
  </div>
);

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface UpgradeModalProps {
  onClose: () => void;
}

export const UpgradeModal: React.FC<UpgradeModalProps> = ({ onClose }) => {
  const toast = useToast();
  const [billingUsage, setBillingUsage] = useState<BillingUsageResponse | null>(null);
  const [isUpgrading, setIsUpgrading] = useState(false);

  // Fetch live usage so we can show the user how close they are to limits
  useEffect(() => {
    let cancelled = false;
    invoke<BillingUsageResponse>("get_billing_usage")
      .then((data) => {
        if (!cancelled) setBillingUsage(data);
      })
      .catch((err) => {
        console.error("Failed to fetch billing usage:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpgrade = useCallback(async () => {
    try {
      setIsUpgrading(true);
      const result = await invoke<{ session_id: string; checkout_url: string | null }>(
        "create_billing_checkout",
        { planType: "pro" }
      );
      if (result.checkout_url) {
        await invoke("open_external_url", { url: result.checkout_url });
        onClose();
      } else {
        toast.error("Could not retrieve checkout URL");
      }
    } catch (e: any) {
      console.error("Failed to create checkout session:", e);
      toast.error("Failed to start checkout process");
    } finally {
      setIsUpgrading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  // Build a map from feature_key -> live usage entry for the current user
  const usageMap = new Map<string, FeatureUsageEntry>(
    (billingUsage?.features ?? []).map((f) => [f.feature_key, f])
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        padding: "20px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "20px",
          width: "640px",
          maxWidth: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 24px 80px rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.10)",
          border: "1px solid #e5e7eb",
          position: "relative",
          color: "#111827",
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-modal-title"
      >
        {/* Header */}
        <div
          style={{
            padding: "28px 28px 0",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: "linear-gradient(135deg, #ecfdf5, #d1fae5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Zap size={20} color="#059669" fill="#059669" />
            </div>
            <div>
              <h2
                id="upgrade-modal-title"
                style={{
                  margin: 0,
                  fontSize: "18px",
                  fontWeight: 700,
                  color: "#111827",
                  letterSpacing: "-0.02em",
                }}
              >
                Upgrade to Pro
              </h2>
              <p
                style={{
                  margin: "3px 0 0",
                  fontSize: "13px",
                  color: "#6b7280",
                }}
              >
                Unlock unlimited access to all Lexi AI features
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isUpgrading}
            style={{
              background: "#f3f4f6",
              border: "none",
              borderRadius: "8px",
              cursor: isUpgrading ? "not-allowed" : "pointer",
              padding: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#6b7280",
              transition: "background 0.15s",
              flexShrink: 0,
            }}
            aria-label="Close upgrade modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Plan cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            padding: "20px 28px",
          }}
        >
          {/* Free plan card */}
          <div
            style={{
              border: "1.5px solid #e5e7eb",
              borderRadius: "16px",
              padding: "20px",
              background: "#fafafa",
            }}
          >
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "#f3f4f6",
                  borderRadius: 100,
                  padding: "3px 10px",
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "#6b7280",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Free
                </span>
              </div>
              <div
                style={{
                  fontSize: "26px",
                  fontWeight: 800,
                  color: "#111827",
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                }}
              >
                $0
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#9ca3af",
                    marginLeft: 3,
                  }}
                >
                  / mo
                </span>
              </div>
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: "12px",
                  color: "#9ca3af",
                }}
              >
                Current plan
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {PLAN_COMPARISON.map((row) => {
                const entry = usageMap.get(row.key);
                const used = entry?.used ?? 0;
                const limit = row.freeLimit;
                const pct = limit != null && limit > 0 ? Math.min(1, used / limit) : 0;
                const isNearLimit = pct >= 0.8;

                return (
                  <div key={row.key}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 5,
                      }}
                    >
                      <CheckIcon pro={false} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 500,
                            color: "#374151",
                          }}
                        >
                          {row.label}
                        </span>
                        <span
                          style={{
                            display: "block",
                            fontSize: "11px",
                            color: isNearLimit ? "#dc2626" : "#9ca3af",
                            fontWeight: isNearLimit ? 600 : 400,
                          }}
                        >
                          {row.freeLimitLabel}
                        </span>
                      </div>
                    </div>

                    {/* Usage bar for free plan */}
                    {billingUsage && limit != null && (
                      <div
                        style={{
                          marginLeft: 26,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            height: 4,
                            background: "#e5e7eb",
                            borderRadius: 4,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${Math.round(pct * 100)}%`,
                              borderRadius: 4,
                              background:
                                pct >= 1
                                  ? "#dc2626"
                                  : pct >= 0.8
                                  ? "#f59e0b"
                                  : "#10b981",
                              transition: "width 0.3s",
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: "10px",
                            color: isNearLimit ? "#dc2626" : "#9ca3af",
                            fontWeight: 500,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {used} / {limit} {featureUsageSuffix(row.key)}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pro plan card */}
          <div
            style={{
              border: "2px solid #059669",
              borderRadius: "16px",
              padding: "20px",
              background: "linear-gradient(145deg, #ecfdf5 0%, #f0fdf4 40%, #ffffff 100%)",
              position: "relative",
              overflow: "hidden",
              boxShadow: "0 0 0 1px rgba(5,150,105,0.08), 0 8px 32px rgba(5,150,105,0.12)",
            }}
          >
            {/* Decorative radial glow in top-right corner */}
            <div
              style={{
                position: "absolute",
                top: -40,
                right: -40,
                width: 140,
                height: 140,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(5,150,105,0.12) 0%, transparent 70%)",
                pointerEvents: "none",
              }}
            />

            {/* Recommended badge */}
            <div
              style={{
                position: "absolute",
                top: 14,
                right: 14,
                background: "linear-gradient(135deg, #059669, #047857)",
                borderRadius: 100,
                padding: "3px 10px",
                fontSize: "9px",
                fontWeight: 800,
                color: "#ffffff",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                boxShadow: "0 2px 8px rgba(5,150,105,0.35)",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Sparkles size={9} fill="#ffffff" color="#ffffff" />
              Best Value
            </div>

            <div style={{ marginBottom: 16 }}>
              {/* Plan badge */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  background: "linear-gradient(135deg, #059669, #047857)",
                  borderRadius: 100,
                  padding: "3px 12px",
                  marginBottom: 12,
                  boxShadow: "0 2px 8px rgba(5,150,105,0.25)",
                }}
              >
                <Zap size={10} color="#ffffff" fill="#ffffff" />
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#ffffff",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }}
                >
                  Pro
                </span>
              </div>

              {/* Price */}
              <div
                style={{
                  fontSize: "28px",
                  fontWeight: 800,
                  color: "#111827",
                  letterSpacing: "-0.04em",
                  lineHeight: 1,
                }}
              >
                $9
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#9ca3af",
                    marginLeft: 3,
                    letterSpacing: 0,
                  }}
                >
                  / mo
                </span>
              </div>

              {/* Sub-label */}
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: "12px",
                  color: "#059669",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Everything in Free — no limits
              </p>
            </div>

            {/* Divider */}
            <div
              style={{
                height: 1,
                background: "linear-gradient(90deg, rgba(5,150,105,0.2), rgba(5,150,105,0.05))",
                marginBottom: 14,
              }}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {PLAN_COMPARISON.map((row) => (
                <div key={row.key}>
                  {/* Top row: icon + label + unlimited badge */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 5,
                    }}
                  >
                    <CheckIcon pro={true} />
                    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "#1f2937",
                        }}
                      >
                        {row.label}
                      </span>
                      {/* Unlimited pill badge */}
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                          fontSize: "10px",
                          fontWeight: 700,
                          color: "#047857",
                          background: "rgba(5,150,105,0.1)",
                          border: "1px solid rgba(5,150,105,0.2)",
                          borderRadius: 100,
                          padding: "2px 8px",
                          letterSpacing: "0.02em",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        ∞ Unlimited
                      </span>
                    </div>
                  </div>

                  {/* Spacer that matches the height of the Free usage-bar row */}
                  <div style={{ height: 18, marginLeft: 26 }} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer CTA */}
        <div
          style={{
            padding: "0 28px 28px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <button
            id="upgrade-modal-cta-btn"
            type="button"
            onClick={handleUpgrade}
            disabled={isUpgrading}
            style={{
              width: "100%",
              padding: "13px 20px",
              fontSize: "15px",
              fontWeight: 700,
              border: "none",
              borderRadius: "12px",
              cursor: isUpgrading ? "not-allowed" : "pointer",
              background: isUpgrading
                ? "#6b7280"
                : "linear-gradient(135deg, #059669, #047857)",
              color: "#ffffff",
              transition: "all 0.2s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: isUpgrading
                ? "none"
                : "0 4px 16px rgba(5, 150, 105, 0.35)",
              opacity: isUpgrading ? 0.75 : 1,
              letterSpacing: "-0.01em",
            }}
          >
            {isUpgrading ? (
              <>
                <div
                  style={{
                    width: 16,
                    height: 16,
                    border: "2px solid rgba(255,255,255,0.4)",
                    borderTopColor: "#ffffff",
                    borderRadius: "50%",
                    animation: "spin 0.7s linear infinite",
                  }}
                />
                Opening Checkout…
              </>
            ) : (
              <>
                <Zap size={16} fill="#ffffff" />
                Upgrade to Pro — $9 / month
              </>
            )}
          </button>

          <p
            style={{
              margin: 0,
              textAlign: "center",
              fontSize: "11px",
              color: "#9ca3af",
            }}
          >
            Cancel anytime · Secure checkout via Dodo Payments
          </p>
        </div>
      </div>
    </div>
  );
};
