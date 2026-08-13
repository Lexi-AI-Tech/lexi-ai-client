/**
 * AnalyticsPage Component
 *
 * Deep-dive on usage: activity breakdown over time (transcripts/meetings/actions),
 * meeting-platform and action-type/app splits, an inferred "what Lexi helped you
 * with" insight, tabbed recent activity, and plan usage.
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { Atom, AudioLines, Sparkles, Video, Zap } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../../store/authStore";
import { UpgradeModal } from "../UpgradeModal";
import type {
  ActionHistory,
  PaginatedActionHistoryResponse,
  PaginatedTranscriptsResponse,
  Transcript,
} from "../../types";
import type { Meeting } from "../meetings/MeetingsListPage";
import { formatDateRelative } from "../../lib/dateUtils";
// Reuses the recent-activity/billing/skeleton/empty-state card styles already
// established in home.css (kept there since HomePage still shares the same
// --lexi-* design tokens and card conventions) — analytics.css only adds the
// new sections (insights, breakdown chart/lists, period toggle).
import "../home/home.css";
import "./analytics.css";

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

interface BreakdownResponse {
  labels: string[];
  transcripts: number[];
  meetings: number[];
  actions: number[];
  meetings_by_platform: Record<string, number>;
  actions_by_type: Record<string, number>;
  actions_by_app: Record<string, number>;
}

interface InsightsResponse {
  headline: string;
  highlights: string[];
  generated_at: string;
}

type RecentActivityTabId = "transcripts" | "meetings" | "actions";
type BreakdownPeriod = "7d" | "30d";

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

function byCreatedAtDesc<T extends { created_at: string }>(a: T, b: T): number {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

const RECENT_ACTIVITY_LIMIT = 5;

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

const RecentActivityRow: React.FC<{
  badgeClass: string;
  icon: React.ElementType;
  title: string;
  subtitle: string;
  typeLabel: string;
  timestamp: string;
  onRowClick: () => void;
}> = ({
  badgeClass,
  icon: Icon,
  title,
  subtitle,
  typeLabel,
  timestamp,
  onRowClick,
}) => (
  <li className="recent-activity-row" onClick={onRowClick}>
    <div className={`recent-activity-badge ${badgeClass}`}>
      <Icon size={14} />
    </div>
    <div className="recent-activity-info">
      <span className="recent-activity-text">{title}</span>
      <div className="recent-activity-meta">
        <span className="recent-activity-type">{typeLabel}</span>
        <span className="recent-activity-dot" />
        <span className="recent-activity-subtitle">{subtitle}</span>
        <span className="recent-activity-dot" />
        <span className="recent-activity-time">
          {formatDateRelative(timestamp)}
        </span>
      </div>
    </div>
  </li>
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

interface AnalyticsPageProps {
  onNavigate?: (page: string) => void;
}

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ onNavigate }) => {
  const { isAuthenticated } = useAuthStore();

  const [recentActivityTab, setRecentActivityTab] =
    useState<RecentActivityTabId>("transcripts");
  const [period, setPeriod] = useState<BreakdownPeriod>("7d");

  const [billingLoading, setBillingLoading] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const [featureUsage, setFeatureUsage] = useState<FeatureUsageResponse | null>(
    null,
  );
  const [recentTranscripts, setRecentTranscripts] = useState<Transcript[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [recentActions, setRecentActions] = useState<ActionHistory[]>([]);
  const [breakdown, setBreakdown] = useState<BreakdownResponse | null>(null);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);

  // Data fetching
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

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      setRecentLoading(true);
      try {
        const data = await invoke<PaginatedTranscriptsResponse>(
          "get_transcripts",
          { page: 1, pageSize: RECENT_ACTIVITY_LIMIT },
        );
        if (!cancelled) setRecentTranscripts(data.transcripts);
      } catch (err) {
        console.error("Failed to fetch recent transcripts:", err);
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      setMeetingsLoading(true);
      try {
        const data = await invoke<Meeting[]>("list_meetings");
        if (!cancelled) setMeetings(data);
      } catch (err) {
        console.error("Failed to fetch meetings:", err);
      } finally {
        if (!cancelled) setMeetingsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      setActionsLoading(true);
      try {
        const data = await invoke<PaginatedActionHistoryResponse>(
          "get_action_history",
          { page: 1, pageSize: RECENT_ACTIVITY_LIMIT },
        );
        if (!cancelled) setRecentActions(data.actions);
      } catch (err) {
        console.error("Failed to fetch recent actions:", err);
      } finally {
        if (!cancelled) setActionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

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

  // Derived
  const planUsageRows = useMemo(
    () =>
      featureUsage?.features
        ? sortPlanUsageFeatures(featureUsage.features)
        : [],
    [featureUsage],
  );

  const recentTranscriptsSorted = useMemo(
    () => [...recentTranscripts].sort(byCreatedAtDesc),
    [recentTranscripts],
  );
  const recentTranscriptsDisplayed = useMemo(
    () => recentTranscriptsSorted.slice(0, RECENT_ACTIVITY_LIMIT),
    [recentTranscriptsSorted],
  );
  const recentMeetingsSorted = useMemo(
    () => [...meetings].sort(byCreatedAtDesc),
    [meetings],
  );
  const recentMeetingsDisplayed = useMemo(
    () => recentMeetingsSorted.slice(0, RECENT_ACTIVITY_LIMIT),
    [recentMeetingsSorted],
  );
  const recentActionsSorted = useMemo(
    () => [...recentActions].sort(byCreatedAtDesc),
    [recentActions],
  );
  const recentActionsDisplayed = useMemo(
    () => recentActionsSorted.slice(0, RECENT_ACTIVITY_LIMIT),
    [recentActionsSorted],
  );

  const recentActivityLoading =
    recentLoading || meetingsLoading || actionsLoading;

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
              <div className="breakdown-panel">
                <h3 className="breakdown-panel__title">Actions by type</h3>
                <BreakdownList
                  data={breakdown.actions_by_type}
                  emptyLabel="No actions run in this period."
                />
              </div>
            </div>
          </>
        )}
      </motion.section>

      {/* ── Main Grid: Recent Activity | Plan Usage ── */}
      <div className="home-grid">
        <motion.section
          className="recent-activity-section"
          variants={itemVariants}
        >
          <div className="section-header section-header--recent-activity">
            <h2 className="section-title">Recent Activity</h2>
          </div>

          <div className="recent-activity-content">
            {isAuthenticated && recentActivityLoading ? (
              <div className="home-recent-skeleton" aria-hidden>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="home-recent-skeleton__row">
                    <SkBlock
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        flexShrink: 0,
                      }}
                    />
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                      }}
                    >
                      <SkBlock
                        style={{ height: 13, width: "70%", borderRadius: 5 }}
                      />
                      <SkBlock
                        style={{ height: 10, width: "45%", borderRadius: 4 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : !isAuthenticated ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <AudioLines size={24} />
                </div>
                <p className="empty-title">No activity yet</p>
                <p className="empty-sub">
                  Sign in to see transcriptions, meetings, and actions.
                </p>
              </div>
            ) : (
              <>
                <div
                  className="recent-activity-tabs"
                  role="tablist"
                  aria-label="Recent activity by category"
                >
                  {(
                    [
                      { id: "transcripts" as const, label: "Transcripts" },
                      { id: "meetings" as const, label: "Meetings" },
                      { id: "actions" as const, label: "Actions" },
                    ] as const
                  ).map(({ id, label }) => {
                    const isActive = recentActivityTab === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        id={`recent-activity-tab-${id}`}
                        aria-selected={isActive}
                        aria-controls={`recent-activity-panel-${id}`}
                        tabIndex={isActive ? 0 : -1}
                        className={`recent-activity-tab${isActive ? " is-active" : ""}`}
                        onClick={() => setRecentActivityTab(id)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div
                  id="recent-activity-panel-transcripts"
                  role="tabpanel"
                  aria-labelledby="recent-activity-tab-transcripts"
                  hidden={recentActivityTab !== "transcripts"}
                  className="recent-activity-panel"
                >
                  {recentTranscriptsSorted.length === 0 ? (
                    <div className="empty-state empty-state--tab">
                      <div className="empty-icon">
                        <AudioLines size={24} />
                      </div>
                      <p className="empty-title">No transcriptions yet</p>
                      <p className="empty-sub">
                        Your speech-to-text history will show up here.
                      </p>
                    </div>
                  ) : (
                    <ul className="recent-activity-list">
                      {recentTranscriptsDisplayed.map((t) => {
                        const title =
                          t.original_text.length > 70
                            ? t.original_text.slice(0, 70) + "…"
                            : t.original_text;
                        return (
                          <RecentActivityRow
                            key={t.id}
                            badgeClass="transcription"
                            icon={AudioLines}
                            title={title}
                            subtitle={`${t.original_text_word_count} words`}
                            typeLabel="Transcription"
                            timestamp={t.created_at}
                            onRowClick={() => onNavigate?.("transcripts")}
                          />
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div
                  id="recent-activity-panel-meetings"
                  role="tabpanel"
                  aria-labelledby="recent-activity-tab-meetings"
                  hidden={recentActivityTab !== "meetings"}
                  className="recent-activity-panel"
                >
                  {recentMeetingsSorted.length === 0 ? (
                    <div className="empty-state empty-state--tab">
                      <div className="empty-icon">
                        <Video size={24} />
                      </div>
                      <p className="empty-title">No meetings yet</p>
                      <p className="empty-sub">
                        Recorded meetings will appear here.
                      </p>
                    </div>
                  ) : (
                    <ul className="recent-activity-list">
                      {recentMeetingsDisplayed.map((m) => (
                        <RecentActivityRow
                          key={m.id}
                          badgeClass="meeting"
                          icon={Video}
                          title={m.name || "Untitled Meeting"}
                          subtitle={m.platform ?? "Meeting"}
                          typeLabel="Meeting"
                          timestamp={m.created_at}
                          onRowClick={() => onNavigate?.("meetings")}
                        />
                      ))}
                    </ul>
                  )}
                </div>

                <div
                  id="recent-activity-panel-actions"
                  role="tabpanel"
                  aria-labelledby="recent-activity-tab-actions"
                  hidden={recentActivityTab !== "actions"}
                  className="recent-activity-panel"
                >
                  {recentActionsSorted.length === 0 ? (
                    <div className="empty-state empty-state--tab">
                      <div className="empty-icon">
                        <Atom size={24} />
                      </div>
                      <p className="empty-title">No actions yet</p>
                      <p className="empty-sub">
                        Action hotkey runs will show up here.
                      </p>
                    </div>
                  ) : (
                    <ul className="recent-activity-list">
                      {recentActionsDisplayed.map((a) => {
                        const cmd = a.action_command?.trim() || "Action";
                        const title =
                          cmd.length > 70 ? cmd.slice(0, 70) + "…" : cmd;
                        const sub =
                          a.app_name?.trim() || a.action_type || "Action";
                        return (
                          <RecentActivityRow
                            key={a.id}
                            badgeClass="action"
                            icon={Atom}
                            title={title}
                            subtitle={sub}
                            typeLabel="Action"
                            timestamp={a.created_at}
                            onRowClick={() => onNavigate?.("actions")}
                          />
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </motion.section>

        {/* Right: Plan Usage */}
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
                  <SkBlock
                    style={{ height: 6, width: "100%", borderRadius: 3 }}
                  />
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
      </div>
    </motion.div>
  );
};
