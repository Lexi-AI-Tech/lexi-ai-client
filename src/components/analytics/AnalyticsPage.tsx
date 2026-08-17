/**
 * AnalyticsPage Component
 *
 * Deep-dive on usage: activity breakdown over time (transcripts/meetings/actions),
 * an interactive chart with exact counts, and an inferred "what Lexi helped you
 * with" insight (with a feature nudge). Recent activity lives on the Home page
 * (compact merged feed); plan/billing usage lives on the dedicated Usage page.
 */

import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../../store/authStore";
// Reuses the billing/skeleton/empty-state card styles already established in
// home.css (kept there since HomePage still shares the same --lexi-* design
// tokens and card conventions) — analytics.css only adds the new sections
// (insights, breakdown chart, period toggle).
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
}

interface InsightsResponse {
  headline: string;
  highlights: string[];
  generated_at: string;
  nudge?: string | null;
  nudge_cta?: string | null;
  nudge_page?: string | null;
}

type BreakdownPeriod = "7d" | "30d";
type NavigablePage =
  | "home"
  | "meetings"
  | "actions"
  | "docs"
  | "notes"
  | "transcripts"
  | "shortcuts"
  | "analytics";

const NUDGE_PAGES: readonly string[] = [
  "home",
  "meetings",
  "actions",
  "docs",
  "notes",
  "transcripts",
  "shortcuts",
];

interface AnalyticsPageProps {
  onNavigate?: (page: NavigablePage) => void;
}

const SERIES = [
  { key: "transcripts", label: "Transcripts", className: "transcripts" },
  { key: "meetings", label: "Meetings", className: "meetings" },
  { key: "actions", label: "Actions", className: "actions" },
  { key: "docs", label: "Docs", className: "docs" },
  { key: "notes", label: "Notes", className: "notes" },
] as const;

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

/** Grouped-bar chart: one column per label, one bar per series, with an
 * exact-number tooltip on hover/focus and a totals row underneath. */
const ActivityChart: React.FC<{ breakdown: BreakdownResponse }> = ({
  breakdown,
}) => {
  const [hovered, setHovered] = useState<number | null>(null);

  const max = Math.max(
    1,
    ...breakdown.transcripts,
    ...breakdown.meetings,
    ...breakdown.actions,
    ...breakdown.docs,
    ...breakdown.notes,
  );

  const totals = useMemo(
    () =>
      SERIES.reduce<Record<string, number>>((acc, s) => {
        acc[s.key] = breakdown[s.key].reduce((sum, v) => sum + v, 0);
        return acc;
      }, {}),
    [breakdown],
  );

  const activeIndex = hovered ?? breakdown.labels.length - 1;
  const activeTotal = SERIES.reduce(
    (sum, s) => sum + breakdown[s.key][activeIndex],
    0,
  );

  return (
    <div className="activity-chart-wrap">
      <div className="activity-chart">
        {breakdown.labels.map((label, i) => (
          <div
            className={`activity-chart__col${hovered === i ? " is-hovered" : ""}`}
            key={`${label}-${i}`}
            tabIndex={0}
            role="button"
            aria-label={`${label}: ${SERIES.map((s) => `${breakdown[s.key][i]} ${s.label.toLowerCase()}`).join(", ")}`}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(i)}
            onBlur={() => setHovered(null)}
          >
            <div className="activity-chart__bars">
              {SERIES.map((s) => (
                <div
                  key={s.key}
                  className={`activity-chart__bar activity-chart__bar--${s.className}`}
                  style={{ height: `${(breakdown[s.key][i] / max) * 100}%` }}
                />
              ))}
            </div>
            <span className="activity-chart__label">{label}</span>
          </div>
        ))}
      </div>

      <div className="activity-chart__tooltip">
        <span className="activity-chart__tooltip-label">
          {breakdown.labels[activeIndex]}
        </span>
        <span className="activity-chart__tooltip-total">
          {activeTotal} {activeTotal === 1 ? "item" : "items"}
        </span>
        <div className="activity-chart__tooltip-rows">
          {SERIES.map((s) => (
            <span className="activity-chart__tooltip-row" key={s.key}>
              <span
                className={`legend-dot legend-dot--${s.className}`}
                aria-hidden
              />
              {s.label}
              <strong>{breakdown[s.key][activeIndex]}</strong>
            </span>
          ))}
        </div>
      </div>

      <div className="activity-table-scroll">
        <table className="activity-table">
          <thead>
            <tr>
              <th scope="col">Category</th>
              {breakdown.labels.map((label, i) => (
                <th
                  scope="col"
                  key={`${label}-${i}`}
                  className={hovered === i ? "is-hovered" : undefined}
                >
                  {label}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {SERIES.map((s) => (
              <tr key={s.key}>
                <th scope="row">
                  <span
                    className={`legend-dot legend-dot--${s.className}`}
                    aria-hidden
                  />
                  {s.label}
                </th>
                {breakdown[s.key].map((v, i) => (
                  <td
                    key={i}
                    className={hovered === i ? "is-hovered" : undefined}
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    {v}
                  </td>
                ))}
                <td className="activity-table__total">{totals[s.key]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({
  onNavigate,
}) => {
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

  // Insights are a single recency-biased snapshot across all activity — independent
  // of the breakdown period toggle below, so this only ever fetches once.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      setInsightsLoading(true);
      try {
        const data = await invoke<InsightsResponse>("get_analytics_insights");
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
  }, [isAuthenticated]);

  const nudgePage =
    insights?.nudge_page && NUDGE_PAGES.includes(insights.nudge_page)
      ? (insights.nudge_page as NavigablePage)
      : null;

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
                    "Record a meeting, run an action, dictate, jot a note, draft a doc, or set up a shortcut — your personal insights will show up here."}
                </p>
                {insights?.highlights && insights.highlights.length > 0 && (
                  <ul className="insights-card__highlights">
                    {insights.highlights.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                )}
                {insights?.nudge && (
                  <div className="insights-card__nudge">
                    <span className="insights-card__nudge-text">
                      {insights.nudge}
                    </span>
                    {insights.nudge_cta && nudgePage && (
                      <button
                        type="button"
                        className="insights-card__nudge-cta"
                        onClick={() => onNavigate?.(nudgePage)}
                      >
                        {insights.nudge_cta}
                        <ArrowRight size={13} aria-hidden />
                      </button>
                    )}
                  </div>
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
              {SERIES.map((s) => (
                <span className="legend-item" key={s.key}>
                  <span className={`legend-dot legend-dot--${s.className}`} />
                  {s.label}
                </span>
              ))}
            </div>
            <ActivityChart breakdown={breakdown} />
          </>
        )}
      </motion.section>
    </motion.div>
  );
};
