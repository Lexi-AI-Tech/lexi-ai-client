import React, { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Check, Zap } from "lucide-react";
import { useToast } from "./toast/useToast";
import "./upgrade-modal.css";

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
  freeLimit: number | null;
}

const PLAN_COMPARISON: PlanFeatureRow[] = [
  {
    key: "assistant.speech_to_text",
    label: "Transcriptions",
    freeLimitLabel: "2,000 words / week",
    proLimitLabel: "Unlimited",
    freeLimit: 2000,
  },
  {
    key: "docs.create",
    label: "Docs",
    freeLimitLabel: "5 docs / week",
    proLimitLabel: "Unlimited",
    freeLimit: 5,
  },
  {
    key: "meetings.create",
    label: "Meetings",
    freeLimitLabel: "5 sessions / week",
    proLimitLabel: "Unlimited",
    freeLimit: 5,
  },
  {
    key: "actions.perform",
    label: "Actions",
    freeLimitLabel: "20 actions / week",
    proLimitLabel: "Unlimited",
    freeLimit: 20,
  },
];

const FEATURE_USAGE_SUFFIX: Record<string, string> = {
  "assistant.speech_to_text": "words",
  "meetings.create": "sessions",
  "actions.perform": "actions",
  "docs.create": "docs",
};

function featureUsageSuffix(key: string): string {
  return FEATURE_USAGE_SUFFIX[key] ?? "used";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const CheckIcon: React.FC<{ pro?: boolean }> = ({ pro = false }) => (
  <div className={`upgrade-plan-check${pro ? " upgrade-plan-check--pro" : ""}`}>
    <Check size={11} strokeWidth={3} />
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
  const [billingUsage, setBillingUsage] = useState<BillingUsageResponse | null>(
    null,
  );
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [isAwaitingUpgrade, setIsAwaitingUpgrade] = useState(false);
  const [upgradePollAttempts, setUpgradePollAttempts] = useState(0);
  const pollInFlightRef = useRef(false);

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

  const refreshBillingUsage =
    useCallback(async (): Promise<BillingUsageResponse | null> => {
      try {
        const data = await invoke<BillingUsageResponse>("get_billing_usage");
        setBillingUsage(data);
        return data;
      } catch (e) {
        return null;
      }
    }, []);

  const isPro = (planType: string | undefined | null) =>
    (planType ?? "").trim().toLowerCase() === "pro";

  const pollForUpgrade = useCallback(async () => {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      setUpgradePollAttempts((n) => n + 1);
      const latest = await refreshBillingUsage();
      if (latest && isPro(latest.plan_type)) {
        // Pull a fresh access token so any plan/entitlement claims update immediately.
        try {
          await invoke<boolean>("refresh_auth_token");
        } catch (e) {
          // Even if refresh fails, plan is upgraded server-side; user can still retry actions.
        }
        await refreshBillingUsage();
        try {
          // Bring focus back to the app via Rust (more reliable on macOS).
          await invoke("show_main_window");
        } catch (e) {
          // Best-effort; focusing can fail depending on OS/window state.
        }
        try {
          // Tell the rest of the app to refresh any cached plan/usage UI.
          window.dispatchEvent(new Event("lexi:plan-updated"));
        } catch {
          // noop
        }
        toast.success("You're on Pro. Enjoy unlimited access.");
        setIsAwaitingUpgrade(false);
        onClose();
      }
    } finally {
      pollInFlightRef.current = false;
    }
  }, [onClose, refreshBillingUsage, toast]);

  const handleUpgrade = useCallback(async () => {
    try {
      setIsUpgrading(true);
      const result = await invoke<{
        session_id: string;
        checkout_url: string | null;
      }>("create_billing_checkout", { planType: "pro" });
      if (result.checkout_url) {
        await invoke("open_external_url", { url: result.checkout_url });
        // Keep the modal open and switch to a "processing" state.
        setIsAwaitingUpgrade(true);
        // One immediate attempt in case webhook has already landed.
        void pollForUpgrade();
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
  }, [pollForUpgrade]);

  // When the app regains focus / becomes visible, re-check upgrade status.
  useEffect(() => {
    if (!isAwaitingUpgrade) return;
    const onVisibleOrFocus = () => {
      if (!isAwaitingUpgrade) return;
      if (document.visibilityState === "hidden") return;
      void pollForUpgrade();
    };
    window.addEventListener("focus", onVisibleOrFocus);
    document.addEventListener("visibilitychange", onVisibleOrFocus);
    return () => {
      window.removeEventListener("focus", onVisibleOrFocus);
      document.removeEventListener("visibilitychange", onVisibleOrFocus);
    };
  }, [isAwaitingUpgrade, pollForUpgrade]);

  const usageMap = new Map<string, FeatureUsageEntry>(
    (billingUsage?.features ?? []).map((f) => [f.feature_key, f]),
  );

  return (
    <div
      className="upgrade-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="upgrade-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-modal-title"
      >
        {/* ── Header ── */}
        <div className="upgrade-modal__header">
          <div className="upgrade-modal__header-left">
            <div className="upgrade-modal__icon-wrap">
              <Zap size={20} />
            </div>
            <div>
              <h2 id="upgrade-modal-title" className="upgrade-modal__title">
                Upgrade to Pro
              </h2>
              <p className="upgrade-modal__subtitle">
                Unlock unlimited access to all Lexi AI features
              </p>
            </div>
          </div>

          <button
            type="button"
            className="upgrade-modal__close-btn"
            onClick={onClose}
            disabled={isUpgrading}
            aria-label="Close upgrade modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Plan cards ── */}
        <div className="upgrade-modal__plans">
          {/* Free plan */}
          <div className="upgrade-plan-card upgrade-plan-card--free">
            <div className="upgrade-plan-header">
              <div className="upgrade-plan-badge upgrade-plan-badge--free">
                Free
              </div>
              <div className="upgrade-plan-price">
                $ 0<span className="upgrade-plan-price__period">/ mo</span>
              </div>
              <p className="upgrade-plan-sublabel">Current plan</p>
            </div>

            <div className="upgrade-plan-features">
              {PLAN_COMPARISON.map((row) => {
                const entry = usageMap.get(row.key);
                const used = entry?.used ?? 0;
                const limit = row.freeLimit;
                const pct =
                  limit != null && limit > 0 ? Math.min(1, used / limit) : 0;
                const isNearLimit = pct >= 0.8;
                const isAtLimit = pct >= 1;

                return (
                  <div key={row.key} className="upgrade-plan-feature">
                    <div className="upgrade-plan-feature__row">
                      <CheckIcon pro={false} />
                      <div className="upgrade-plan-feature__text">
                        <span className="upgrade-plan-feature__label">
                          {row.label}
                        </span>
                        <span
                          className={`upgrade-plan-feature__sublabel${isNearLimit ? " upgrade-plan-feature__sublabel--warn" : ""}`}
                        >
                          {row.freeLimitLabel}
                        </span>
                      </div>
                    </div>

                    {billingUsage && limit != null && (
                      <div className="upgrade-plan-usage-bar-wrap">
                        <div className="upgrade-plan-usage-bar">
                          <div
                            className={`upgrade-plan-usage-bar__fill${isAtLimit ? " upgrade-plan-usage-bar__fill--danger" : isNearLimit ? " upgrade-plan-usage-bar__fill--warn" : ""}`}
                            style={{ width: `${Math.round(pct * 100)}%` }}
                          />
                        </div>
                        <span
                          className={`upgrade-plan-usage-count${isNearLimit ? " upgrade-plan-usage-count--warn" : ""}`}
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

          {/* Pro plan */}
          <div className="upgrade-plan-card upgrade-plan-card--pro">
            <div className="upgrade-plan-best-value">✦ Best Value</div>

            <div className="upgrade-plan-header">
              <div className="upgrade-plan-badge upgrade-plan-badge--pro">
                <Zap size={10} />
                Pro
              </div>
              <div className="upgrade-plan-price">
                $ 20
                <span className="upgrade-plan-price__period">/ mo</span>
              </div>
              <p className="upgrade-plan-sublabel">
                Everything in Free — no limits
              </p>
            </div>

            <div className="upgrade-plan-divider" />

            <div className="upgrade-plan-features">
              {PLAN_COMPARISON.map((row) => (
                <div key={row.key} className="upgrade-plan-feature">
                  <div className="upgrade-plan-feature__row">
                    <CheckIcon pro={true} />
                    <div className="upgrade-plan-feature__pro-inner">
                      <span className="upgrade-plan-feature__label">
                        {row.label}
                      </span>
                      <span className="upgrade-plan-unlimited-pill">
                        ∞ Unlimited
                      </span>
                    </div>
                  </div>
                  <div className="upgrade-plan-feature__spacer" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Footer CTA ── */}
        <div className="upgrade-modal__footer">
          {isAwaitingUpgrade ? (
            <>
              <button
                id="upgrade-modal-cta-btn"
                type="button"
                className="upgrade-modal__cta-btn"
                onClick={pollForUpgrade}
                disabled={isUpgrading}
              >
                <div className="upgrade-modal__cta-spinner" />
                Checking upgrade status…
              </button>
              <p className="upgrade-modal__legal">
                If you just completed checkout, return to this window. We’ll
                update your plan automatically.{" "}
                {upgradePollAttempts > 1
                  ? `(Checked ${upgradePollAttempts}×)`
                  : ""}
              </p>
            </>
          ) : (
            <>
              <button
                id="upgrade-modal-cta-btn"
                type="button"
                className="upgrade-modal__cta-btn"
                onClick={handleUpgrade}
                disabled={isUpgrading}
              >
                {isUpgrading ? (
                  <>
                    <div className="upgrade-modal__cta-spinner" />
                    Opening Checkout…
                  </>
                ) : (
                  <>
                    <Zap size={16} />
                    Upgrade to Pro — $ 20 / month
                  </>
                )}
              </button>

              <p className="upgrade-modal__legal">
                Cancel anytime · Secure checkout via Dodo Payments
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
