/**
 * AnalyticsPage Component
 *
 * Deep-dive on usage: activity breakdown over time (transcripts/meetings/actions),
 * meeting-platform and action-type/app splits, and an inferred "what Lexi helped
 * you with" insight. Recent activity lives on the Home page (compact merged feed);
 * plan/billing usage lives on the dedicated Usage page.
 */

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../../store/authStore";
// Reuses the billing/skeleton/empty-state card styles already established in
// home.css (kept there since HomePage still shares the same --lexi-* design
// tokens and card conventions) — analytics.css only adds the new sections
// (insights, breakdown chart/lists, period toggle).
import "../home/home.css";
import "./analytics.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BreakdownResponse {
  labels: string[];
  transcripts: number[];
  meetings: number[];
  actions: number[];
  docs: number[];
  notes: number[];
  meetings_by_platform: Record<string, number>;
  actions_by_app: Record<string, number>;
}

interface InsightsResponse {
  headline: string;
  highlights: string[];
  generated_at: string;
}

type BreakdownPeriod = "7d" | "30d";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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

/** Grouped-bar mini chart: one column per label, one bar per series. */
const ActivityChart: React.FC<{ breakdown: BreakdownResponse }> = ({
  breakdown,
}) => {
  const max = Math.max(
    1,
    ...breakdown.transcripts,
    ...breakdown.meetings,
    ...breakdown.actions,
    ...breakdown.docs,
    ...breakdown.notes,
  );
  return (
    <div className="activity-chart">
      {breakdown.labels.map((label, i) => (
        <div className="activity-chart__col" key={`${label}-${i}`}>
          <div className="activity-chart__bars">
            <div
              className="activity-chart__bar activity-chart__bar--transcripts"
              style={{ height: `${(breakdown.transcripts[i] / max) * 100}%` }}
              title={`${breakdown.transcripts[i]} transcriptions`}
            />
            <div
              className="activity-chart__bar activity-chart__bar--meetings"
              style={{ height: `${(breakdown.meetings[i] / max) * 100}%` }}
              title={`${breakdown.meetings[i]} meetings`}
            />
            <div
              className="activity-chart__bar activity-chart__bar--actions"
              style={{ height: `${(breakdown.actions[i] / max) * 100}%` }}
              title={`${breakdown.actions[i]} actions`}
            />
            <div
              className="activity-chart__bar activity-chart__bar--docs"
              style={{ height: `${(breakdown.docs[i] / max) * 100}%` }}
              title={`${breakdown.docs[i]} docs`}
            />
            <div
              className="activity-chart__bar activity-chart__bar--notes"
              style={{ height: `${(breakdown.notes[i] / max) * 100}%` }}
              title={`${breakdown.notes[i]} notes`}
            />
          </div>
          <span className="activity-chart__label">{label}</span>
        </div>
      ))}
    </div>
  );
};

/** Horizontal ranked bar list for a Record<string, number> breakdown. */
const BreakdownList: React.FC<{
  data: Record<string, number>;
  emptyLabel: string;
}> = ({ data, emptyLabel }) => {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (entries.length === 0) {
    return <p className="empty-sub">{emptyLabel}</p>;
  }
  return (
    <ul className="breakdown-list">
      {entries.map(([key, value]) => (
        <li className="breakdown-list__row" key={key}>
          <span className="breakdown-list__label">{key}</span>
          <div className="breakdown-list__bar-track">
            <div
              className="breakdown-list__bar-fill"
              style={{ width: `${(value / max) * 100}%` }}
            />
          </div>
          <span className="breakdown-list__value">{value}</span>
        </li>
      ))}
    </ul>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const AnalyticsPage: React.FC = () => {
  const { isAuthenticated } = useAuthStore();

  const [period, setPeriod] = useState<BreakdownPeriod>("7d");
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const [breakdown, setBreakdown] = useState<BreakdownResponse | null>(null);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);

  // Data fetching
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      setBreakdownLoading(true);
      try {
        const data = await invoke<BreakdownResponse>("get_analytics_breakdown", {
          period,
        });
        if (!cancelled) setBreakdown(data);
      } catch (err) {
        console.error("Failed to fetch activity breakdown:", err);
        if (!cancelled) setBreakdown(null);
      } finally {
        if (!cancelled) setBreakdownLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, period]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      setInsightsLoading(true);
      try {
        const data = await invoke<InsightsResponse>("get_analytics_insights", {
          period,
        });
        if (!cancelled) setInsights(data);
      } catch (err) {
        console.error("Failed to fetch analytics insights:", err);
        if (!cancelled) setInsights(null);
      } finally {
        if (!cancelled) setInsightsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, period]);

  return (
    <motion.div
      className="analytics-container"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.header className="analytics-header" variants={itemVariants}>
        <div>
          <h1 className="analytics-title">Analytics</h1>
          <p className="analytics-subtitle">
            How you've been using Lexi, and what it's helped you get done.
          </p>
        </div>
      </motion.header>

      {/* ── Insights ── */}
      <motion.section className="insights-section" variants={itemVariants}>
        <div className="insights-card">
          <div className="insights-card__icon">
            <Sparkles size={18} />
          </div>
          <div className="insights-card__body">
            {insightsLoading ? (
              <>
                <SkBlock style={{ height: 16, width: "60%", borderRadius: 5 }} />
                <SkBlock
                  style={{
                    height: 12,
                    width: "80%",
                    borderRadius: 4,
                    marginTop: 8,
                  }}
                />
              </>
            ) : (
              <>
                <p className="insights-card__headline">
                  {insights?.headline ??
                    "Start recording meetings or running actions to see insights here."}
                </p>
                {insights?.highlights && insights.highlights.length > 0 && (
                  <ul className="insights-card__highlights">
                    {insights.highlights.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </motion.section>

      {/* ── Activity Breakdown ── */}
      <motion.section className="breakdown-section" variants={itemVariants}>
        <div className="section-header">
          <h2 className="section-title">Activity</h2>
          <div className="period-toggle" role="tablist" aria-label="Time period">
            {(["7d", "30d"] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={period === p}
                className={`period-toggle__btn${period === p ? " is-active" : ""}`}
                onClick={() => setPeriod(p)}
              >
                {p === "7d" ? "7 days" : "30 days"}
              </button>
            ))}
          </div>
        </div>

        {breakdownLoading || !breakdown ? (
          <div className="home-billing-skeleton">
            <SkBlock style={{ height: 140, width: "100%", borderRadius: 12 }} />
          </div>
        ) : (
          <>
            <div className="activity-chart-legend">
              <span className="legend-item">
                <span className="legend-dot legend-dot--transcripts" />
                Transcripts
              </span>
              <span className="legend-item">
                <span className="legend-dot legend-dot--meetings" />
                Meetings
              </span>
              <span className="legend-item">
                <span className="legend-dot legend-dot--actions" />
                Actions
              </span>
              <span className="legend-item">
                <span className="legend-dot legend-dot--docs" />
                Docs
              </span>
              <span className="legend-item">
                <span className="legend-dot legend-dot--notes" />
                Notes
              </span>
            </div>
            <ActivityChart breakdown={breakdown} />

            <div className="breakdown-grid">
              <div className="breakdown-panel">
                <h3 className="breakdown-panel__title">Meetings by platform</h3>
                <BreakdownList
                  data={breakdown.meetings_by_platform}
                  emptyLabel="No meetings recorded in this period."
                />
              </div>
              <div className="breakdown-panel">
                <h3 className="breakdown-panel__title">Actions by app</h3>
                <BreakdownList
                  data={breakdown.actions_by_app}
                  emptyLabel="No actions run in this period."
                />
              </div>
            </div>
          </>
        )}
      </motion.section>
    </motion.div>
  );
};
