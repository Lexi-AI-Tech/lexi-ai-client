/**
 * HomePage Component
 *
 * Compact dashboard: greeting, quick actions with descriptions,
 * tabbed recent activity (transcripts, meetings, actions), and plan usage.
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { Atom, FileText, Mic, Video, AudioLines } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../../store/authStore";
import type {
  ActionHistory,
  PaginatedActionHistoryResponse,
  PaginatedTranscriptsResponse,
  Transcript,
} from "../../types";
import type { Meeting } from "../meetings/MeetingsListPage";
import { formatDateRelative } from "../../lib/dateUtils";
import "./home.css";

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

type RecentActivityTabId = "transcripts" | "meetings" | "actions";

// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------

function byCreatedAtDesc<T extends { created_at: string }>(a: T, b: T): number {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

const UPGRADE_URL = "https://speaklexi.com";

/** Max items per category in Recent Activity (tabs + API page size). */
const RECENT_ACTIVITY_LIMIT = 5;

const FEATURE_LABELS: Record<string, string> = {
  "assistant.speech_to_text": "Assistant",
  "meetings.create": "Meeting",
  "actions.perform": "Actions",
};

const FEATURE_USAGE_SUFFIX: Record<string, string> = {
  "assistant.speech_to_text": "words",
  "meetings.create": "sessions",
  "actions.perform": "actions",
};

const PLAN_USAGE_FEATURE_ORDER = [
  "assistant.speech_to_text",
  "meetings.create",
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

function formatCurrentDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

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

// Quick action with description
const QuickAction: React.FC<{
  icon: React.ElementType;
  label: string;
  description: string;
  onClick: () => void;
}> = ({ icon: Icon, label, description, onClick }) => (
  <motion.button
    className="quick-action-card"
    onClick={onClick}
    whileHover={{ y: -2 }}
    whileTap={{ scale: 0.98 }}
    transition={{ duration: 0.2 }}
  >
    <div className="quick-action-icon">
      <Icon size={18} />
    </div>
    <div className="quick-action-text">
      <span className="quick-action-label">{label}</span>
      <span className="quick-action-desc">{description}</span>
    </div>
  </motion.button>
);

// Skeleton helpers
const SkBlock: React.FC<{
  className?: string;
  style?: React.CSSProperties;
}> = ({ className, style }) => (
  <div className={`skeleton-block ${className ?? ""}`.trim()} style={style} />
);

const HomeRecentSkeleton: React.FC = () => (
  <div className="home-recent-skeleton" aria-hidden>
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="home-recent-skeleton__row">
        <SkBlock
          style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }}
        />
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}
        >
          <SkBlock style={{ height: 13, width: "70%", borderRadius: 5 }} />
          <SkBlock style={{ height: 10, width: "45%", borderRadius: 4 }} />
        </div>
      </div>
    ))}
  </div>
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

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface HomePageProps {
  onViewAllTranscripts?: () => void;
  onNavigate?: (page: string) => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  onViewAllTranscripts: _onViewAllTranscripts,
  onNavigate,
}) => {
  const { user, isAuthenticated, tokens } = useAuthStore();

  const [recentActivityTab, setRecentActivityTab] =
    useState<RecentActivityTabId>("transcripts");

  const [billingLoading, setBillingLoading] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [actionsLoading, setActionsLoading] = useState(false);

  const [billingUsage, setBillingUsage] = useState<BillingUsageResponse | null>(
    null,
  );
  const [recentTranscripts, setRecentTranscripts] = useState<Transcript[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [recentActions, setRecentActions] = useState<ActionHistory[]>([]);

  // Data fetching
  const fetchBillingUsage = useCallback(async () => {
    if (!isAuthenticated || !tokens?.access_token) return;
    try {
      setBillingUsage(await invoke<BillingUsageResponse>("get_billing_usage"));
    } catch (err) {
      console.error("Failed to fetch billing usage:", err);
      setBillingUsage(null);
    }
  }, [isAuthenticated, tokens?.access_token]);

  const fetchRecentTranscripts = useCallback(async () => {
    if (!isAuthenticated || !tokens?.access_token) return;
    try {
      const data = await invoke<PaginatedTranscriptsResponse>(
        "get_transcripts",
        {
          page: 1,
          pageSize: RECENT_ACTIVITY_LIMIT,
        },
      );
      setRecentTranscripts(data.transcripts);
    } catch (err) {
      console.error("Failed to fetch recent transcripts:", err);
    }
  }, [isAuthenticated, tokens?.access_token]);

  const fetchRecentActions = useCallback(async () => {
    if (!isAuthenticated || !tokens?.access_token) return;
    try {
      const data = await invoke<PaginatedActionHistoryResponse>(
        "get_action_history",
        {
          page: 1,
          pageSize: RECENT_ACTIVITY_LIMIT,
        },
      );
      setRecentActions(data.actions);
    } catch (err) {
      console.error("Failed to fetch recent actions:", err);
    }
  }, [isAuthenticated, tokens?.access_token]);

  const fetchMeetings = useCallback(async () => {
    if (!isAuthenticated || !tokens?.access_token) return;
    try {
      setMeetings(await invoke<Meeting[]>("list_meetings"));
    } catch (err) {
      console.error("Failed to fetch meetings:", err);
    }
  }, [isAuthenticated, tokens?.access_token]);

  // Effects
  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) {
      setBillingLoading(false);
      return;
    }
    let c = false;
    setBillingLoading(true);
    (async () => {
      try {
        await fetchBillingUsage();
      } finally {
        if (!c) setBillingLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [isAuthenticated, tokens?.access_token, fetchBillingUsage]);

  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) {
      setRecentLoading(false);
      return;
    }
    let c = false;
    setRecentLoading(true);
    (async () => {
      try {
        await fetchRecentTranscripts();
      } finally {
        if (!c) setRecentLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [isAuthenticated, tokens?.access_token, fetchRecentTranscripts]);

  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) {
      setMeetingsLoading(false);
      return;
    }
    let c = false;
    setMeetingsLoading(true);
    (async () => {
      try {
        await fetchMeetings();
      } finally {
        if (!c) setMeetingsLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [isAuthenticated, tokens?.access_token, fetchMeetings]);

  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) {
      setActionsLoading(false);
      return;
    }
    let c = false;
    setActionsLoading(true);
    (async () => {
      try {
        await fetchRecentActions();
      } finally {
        if (!c) setActionsLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [isAuthenticated, tokens?.access_token, fetchRecentActions]);

  // Derived
  const userName = user?.name?.split(" ")[0] || "there";
  const planUsageRows = useMemo(
    () =>
      billingUsage?.features
        ? sortPlanUsageFeatures(billingUsage.features)
        : [],
    [billingUsage],
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

  const handleUpgradeClick = useCallback(async () => {
    try {
      await invoke("open_external_url", { url: UPGRADE_URL });
    } catch (e) {
      console.error("Failed to open upgrade URL:", e);
    }
  }, []);

  const showUpgradeCta =
    isAuthenticated &&
    billingUsage &&
    !billingLoading &&
    !isProPlan(billingUsage.plan_type);

  return (
    <motion.div
      className="home-container"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* ── Greeting ── */}
      <motion.header className="home-greeting" variants={itemVariants}>
        <div className="greeting-section">
          <p className="greeting-date">{formatCurrentDate()}</p>
          <h1 className="greeting-text">
            {getGreeting()}, <span className="user-name">{userName}</span>
          </h1>
          <p className="greeting-sub">
            Voice-first Work OS for thinking, meetings, and writing
          </p>
        </div>
      </motion.header>

      {/* ── Quick Actions with descriptions ── */}
      <motion.section className="quick-actions-section" variants={itemVariants}>
        <div className="quick-actions-grid">
          <QuickAction
            icon={Mic}
            label="Transcribe"
            description="Convert speech to text instantly"
            onClick={() => onNavigate?.("transcripts")}
          />
          <QuickAction
            icon={Video}
            label="New Meeting"
            description="Record and transcribe live meetings"
            onClick={() => onNavigate?.("meetings")}
          />
          <QuickAction
            icon={FileText}
            label="Create Doc"
            description="Draft documents with voice input"
            onClick={() => onNavigate?.("docs")}
          />
          <QuickAction
            icon={Atom}
            label="Actions"
            description="Hold Action and speak—AI output at your cursor"
            onClick={() => onNavigate?.("actions")}
          />
        </div>
      </motion.section>

      {/* ── Main Grid: Recent Activity | Plan Usage ── */}
      <div className="home-grid">
        {/* Left: Recent Activity (tabbed) */}
        <motion.section
          className="recent-activity-section"
          variants={itemVariants}
        >
          <div className="section-header section-header--recent-activity">
            <h2 className="section-title">Recent Activity</h2>
          </div>

          <div className="recent-activity-content">
            {isAuthenticated && recentActivityLoading ? (
              <HomeRecentSkeleton />
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
          className="billing-usage-section"
          variants={itemVariants}
        >
          <div className="section-header">
            <div>
              <h2 className="section-title">Plan Usage</h2>
              {billingUsage && (
                <div className="billing-usage-meta">
                  <span className="billing-plan-badge">
                    {billingUsage.plan_type}
                  </span>
                  {!isProPlan(billingUsage.plan_type) && (
                    <BillingResetCountdown
                      periodEndIso={billingUsage.period_end}
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
          ) : billingUsage && planUsageRows.length > 0 ? (
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
                              Unlimited
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
