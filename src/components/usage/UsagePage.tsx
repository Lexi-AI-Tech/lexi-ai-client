/**
 * UsagePage Component
 *
 * Plan usage: per-feature usage against plan limits, billing period countdown,
 * and the upgrade CTA. Split out of Analytics so plan/billing usage has its own
 * dedicated surface, separate from activity analytics.
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { Zap } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../../store/authStore";
import { UpgradeModal } from "../UpgradeModal";
import "../home/home.css";
import "../analytics/analytics.css";

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

interface FeatureUsageResponse {
  plan_type: string;
  period_start: string;
  period_end: string;
  limit_reset: string;
  features: FeatureUsageEntry[];
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const FEATURE_LABELS: Record<string, string> = {
  "assistant.speech_to_text": "Transcriptions",
  "meetings.create": "Meeting",
  "actions.perform": "Actions",
  "docs.create": "Docs",
};

const FEATURE_USAGE_SUFFIX: Record<string, string> = {
  "assistant.speech_to_text": "words",
  "meetings.create": "sessions",
  "actions.perform": "actions",
  "docs.create": "docs",
};

const PLAN_USAGE_FEATURE_ORDER = [
  "assistant.speech_to_text",
  "meetings.create",
  "docs.create",
  "actions.perform",
] as const;

function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key;
}

function featureUsageSuffix(key: string): string {
  return FEATURE_USAGE_SUFFIX[key] ?? "used";
}

function isProPlan(planType: string): boolean {
  return planType.trim().toLowerCase() === "pro";
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function sortPlanUsageFeatures<T extends { feature_key: string }>(
  features: T[],
): T[] {
  const orderMap = new Map<string, number>(
    PLAN_USAGE_FEATURE_ORDER.map((k, i) => [k, i]),
  );
  return [...features].sort((a, b) => {
    const ia = orderMap.get(a.feature_key);
    const ib = orderMap.get(b.feature_key);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return a.feature_key.localeCompare(b.feature_key);
  });
}

function formatResetsInCountdown(periodEndMs: number, nowMs: number): string {
  const ms = periodEndMs - nowMs;
  if (Number.isNaN(ms) || periodEndMs <= 0 || ms <= 0) return "Resets soon";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const p2 = (n: number) => String(n).padStart(2, "0");
  const dPart = days < 100 ? p2(days) : String(days);
  return `Resets in ${dPart}d ${p2(h)}h ${p2(m)}m ${p2(s)}s`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BillingResetCountdown({ periodEndIso }: { periodEndIso: string }) {
  const endMs = useMemo(() => new Date(periodEndIso).getTime(), [periodEndIso]);
  const [label, setLabel] = useState(() =>
    formatResetsInCountdown(endMs, Date.now()),
  );
  useEffect(() => {
    const tick = () => setLabel(formatResetsInCountdown(endMs, Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [endMs]);
  return <span className="billing-period">{label}</span>;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

const SkBlock: React.FC<{
  className?: string;
  style?: React.CSSProperties;
}> = ({ className, style }) => (
  <div className={`skeleton-block ${className ?? ""}`.trim()} style={style} />
);

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const UsagePage: React.FC = () => {
  const { isAuthenticated } = useAuthStore();

  const [billingLoading, setBillingLoading] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [featureUsage, setFeatureUsage] = useState<FeatureUsageResponse | null>(
    null,
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      setBillingLoading(true);
      try {
        const data = await invoke<FeatureUsageResponse>("get_feature_usage");
        if (!cancelled) setFeatureUsage(data);
      } catch (err) {
        console.error("Failed to fetch feature usage:", err);
        if (!cancelled) setFeatureUsage(null);
      } finally {
        if (!cancelled) setBillingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const planUsageRows = useMemo(
    () =>
      featureUsage?.features
        ? sortPlanUsageFeatures(featureUsage.features)
        : [],
    [featureUsage],
  );

  const handleUpgradeClick = useCallback(() => {
    setShowUpgradeModal(true);
  }, []);

  const showUpgradeCta =
    isAuthenticated &&
    featureUsage &&
    !billingLoading &&
    !isProPlan(featureUsage.plan_type);

  return (
    <motion.div
      className="analytics-container"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {showUpgradeModal && (
        <UpgradeModal onClose={() => setShowUpgradeModal(false)} />
      )}

      <motion.header className="analytics-header" variants={itemVariants}>
        <div>
          <h1 className="analytics-title">Usage</h1>
          <p className="analytics-subtitle">
            Your plan limits and how much of them you've used this period.
          </p>
        </div>
      </motion.header>

      <motion.section
        className={`billing-usage-section${featureUsage && isProPlan(featureUsage.plan_type) ? " is-pro-plan" : ""}`}
        variants={itemVariants}
      >
        <div className="section-header">
          <div>
            <h2 className="section-title">Plan Usage</h2>
            {featureUsage && (
              <div className="billing-usage-meta">
                <span
                  className={`billing-plan-badge${isProPlan(featureUsage.plan_type) ? " is-pro" : ""}`}
                >
                  {isProPlan(featureUsage.plan_type) && (
                    <Zap size={10} fill="#ffffff" color="#ffffff" />
                  )}
                  {featureUsage.plan_type}
                </span>
                {!isProPlan(featureUsage.plan_type) && (
                  <BillingResetCountdown
                    periodEndIso={featureUsage.period_end}
                  />
                )}
              </div>
            )}
          </div>
          {showUpgradeCta && (
            <button
              type="button"
              className="home-upgrade-btn"
              onClick={handleUpgradeClick}
            >
              Upgrade
            </button>
          )}
        </div>

        {billingLoading ? (
          <div className="home-billing-skeleton">
            {[80, 55, 70].map((w, i) => (
              <div key={i} className="home-billing-skeleton__row">
                <SkBlock
                  style={{
                    height: 12,
                    width: `${w}%`,
                    borderRadius: 4,
                    marginBottom: 6,
                  }}
                />
                <SkBlock style={{ height: 6, width: "100%", borderRadius: 3 }} />
              </div>
            ))}
          </div>
        ) : featureUsage && planUsageRows.length > 0 ? (
          <ul className="billing-feature-list">
            {planUsageRows.map((feature) => {
              const limit = feature.limit_value;
              const isUnlimited = limit === null;
              const used = feature.used ?? 0;
              const pct = isUnlimited
                ? 0
                : clamp01(limit > 0 ? used / limit : used > 0 ? 1 : 0);
              return (
                <li
                  key={feature.feature_key}
                  className={`billing-feature-row${!feature.enabled ? " is-disabled" : ""}`}
                >
                  <div className="billing-feature-info">
                    <div className="billing-feature-name-wrap">
                      <span className="billing-feature-name">
                        {featureLabel(feature.feature_key)}
                      </span>
                      {!feature.enabled && (
                        <span className="billing-feature-disabled">
                          Not included
                        </span>
                      )}
                    </div>
                    <div className="billing-feature-metrics">
                      <span className="billing-feature-usage">
                        {isUnlimited ? (
                          <span className="billing-usage-unlimited">
                            ∞ Unlimited
                          </span>
                        ) : (
                          <>
                            <span className="billing-usage-numbers">
                              {used} / {limit}
                            </span>{" "}
                            <span className="billing-feature-usage-suffix">
                              {featureUsageSuffix(feature.feature_key)}
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                  {!isUnlimited && feature.metered && (
                    <div className="billing-usage-bar">
                      <div
                        className="billing-usage-bar-fill"
                        style={{ width: `${Math.round(pct * 100)}%` }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty-state">
            <p className="empty-sub">No plan data available.</p>
          </div>
        )}
      </motion.section>
    </motion.div>
  );
};
