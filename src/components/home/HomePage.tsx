/**
 * HomePage Component
 *
 * The main dashboard displaying greeting, quick actions, stats,
 * recent activity, plan usage, and analytics.
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import {
  Clock,
  FileText,
  TrendingUp,
  Sparkles,
  ChevronRight,
  Flame,
  Mic,
  Video,
  ArrowLeftRight,
  AudioLines,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../../store/authStore";
import type { HotkeyConfig, Transcript, PaginatedTranscriptsResponse } from "../../types";
import type { Meeting } from "../meetings/MeetingsListPage";
import "./home.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnalyticsStats {
  words_typed_this_week: number;
  time_saved_minutes: number;
  current_streak: number;
}

interface ChartData {
  labels: string[];
  data: number[];
  total_transcriptions: number;
}

type AnalyticsPeriod = "1d" | "7d" | "30d";

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

const UPGRADE_URL = "https://speaklexi.com";

const FEATURE_LABELS: Record<string, string> = {
  "assistant.speech_to_text": "Assistant",
  "meetings.create": "Meeting",
  "actions.perform": "Actions",
};

/** Suffix after "used / limit" in plan usage metrics (e.g. "1608 / 2000 words"). */
const FEATURE_USAGE_SUFFIX: Record<string, string> = {
  "assistant.speech_to_text": "words",
  "meetings.create": "sessions",
  "actions.perform": "actions",
};

/** Display order for plan usage rows (unknown keys sort after, by key). */
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

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
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
// Hooks
// ---------------------------------------------------------------------------

/** Animate a number from 0 to `end` over `duration` ms. */
function useCountUp(end: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const prevEnd = useRef(0);

  useEffect(() => {
    if (end === prevEnd.current) return;
    prevEnd.current = end;
    if (end === 0) {
      setValue(0);
      return;
    }
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * end));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [end, duration]);

  return value;
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

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

// Stat card with count-up
interface StatCardProps {
  icon: React.ElementType;
  label: string;
  rawValue: number;
  suffix?: string;
  subValue?: string;
  accentColor: string;
  iconColor?: string;
}

const StatCard: React.FC<StatCardProps> = ({
  icon: Icon,
  label,
  rawValue,
  suffix = "",
  subValue,
  accentColor,
  iconColor,
}) => {
  const animatedValue = useCountUp(rawValue);
  return (
    <motion.div
      className="stat-card"
      variants={itemVariants}
      style={{
        ["--stat-accent" as string]: accentColor,
        ["--stat-icon-color" as string]: iconColor ?? "var(--lexi-primary)",
      }}
    >
      <div className="stat-card-icon">
        <Icon size={20} />
      </div>
      <div className="stat-card-content">
        <span className="stat-card-value">
          {animatedValue.toLocaleString()}
          {suffix}
        </span>
        <span className="stat-card-label">{label}</span>
        {subValue && <span className="stat-card-sub">{subValue}</span>}
      </div>
    </motion.div>
  );
};

// Period button
const PeriodButton: React.FC<{
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ label, active, onClick }) => (
  <button
    type="button"
    className={`period-btn ${active ? "active" : ""}`}
    onClick={onClick}
  >
    {label}
  </button>
);

// Quick action card
const QuickAction: React.FC<{
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}> = ({ icon: Icon, label, onClick }) => (
  <motion.button
    className="quick-action-card"
    onClick={onClick}
    whileHover={{ y: -2 }}
    whileTap={{ scale: 0.98 }}
    transition={{ duration: 0.2 }}
  >
    <div className="quick-action-icon">
      <Icon size={20} />
    </div>
    <span className="quick-action-label">{label}</span>
  </motion.button>
);

// Skeleton block
const SkBlock: React.FC<{
  className?: string;
  style?: React.CSSProperties;
}> = ({ className, style }) => (
  <div className={`skeleton-block ${className ?? ""}`.trim()} style={style} />
);

const HomeStatsSkeleton: React.FC = () => (
  <div className="home-stats-skeleton" aria-hidden>
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="home-stats-skeleton__card">
        <SkBlock className="home-stats-skeleton__icon" />
        <div className="home-stats-skeleton__lines">
          <SkBlock style={{ height: 28, width: "55%", borderRadius: 8 }} />
          <SkBlock style={{ height: 14, width: "42%", borderRadius: 6 }} />
          <SkBlock style={{ height: 12, width: "68%", borderRadius: 6 }} />
        </div>
      </div>
    ))}
  </div>
);

const HomeBillingSkeleton: React.FC = () => (
  <div className="home-billing-skeleton" aria-hidden>
    {Array.from({ length: 3 }).map((_, i) => (
      <div key={i} className="home-billing-skeleton__row">
        <SkBlock style={{ height: 12, width: "38%", borderRadius: 6, marginBottom: 10 }} />
        <SkBlock style={{ height: 14, width: "72%", borderRadius: 8, marginBottom: 8 }} />
        <SkBlock style={{ height: 10, width: "48%", borderRadius: 6 }} />
      </div>
    ))}
  </div>
);

const HomeAnalyticsSkeleton: React.FC = () => {
  const barHeights = [28, 52, 36, 64, 44, 58, 32, 48, 40, 56];
  return (
    <div className="home-analytics-skeleton" aria-hidden>
      <div className="home-analytics-skeleton__main">
        <SkBlock style={{ width: 48, height: 48, borderRadius: 12 }} />
        <SkBlock style={{ height: 40, width: "45%", borderRadius: 10 }} />
        <SkBlock style={{ height: 12, width: "62%", borderRadius: 6 }} />
      </div>
      <div className="home-analytics-skeleton__chart">
        <div className="home-analytics-skeleton__bars">
          {barHeights.map((h, i) => (
            <SkBlock key={i} className="home-analytics-skeleton__bar" style={{ height: h }} />
          ))}
        </div>
        <div className="home-analytics-skeleton__labels">
          {Array.from({ length: 7 }).map((_, i) => (
            <SkBlock key={i} style={{ flex: 1, height: 10, borderRadius: 4 }} />
          ))}
        </div>
      </div>
      <div className="home-analytics-skeleton__insights">
        <SkBlock style={{ height: 12, width: "100%", borderRadius: 6 }} />
        <SkBlock style={{ height: 12, width: "88%", borderRadius: 6 }} />
      </div>
    </div>
  );
};

const HomeRecentSkeleton: React.FC = () => (
  <div className="home-recent-skeleton" aria-hidden>
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="home-recent-skeleton__row">
        <SkBlock style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <SkBlock style={{ height: 14, width: "75%", borderRadius: 6 }} />
          <SkBlock style={{ height: 10, width: "50%", borderRadius: 4 }} />
        </div>
      </div>
    ))}
  </div>
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

  // Loading states
  const [billingLoading, setBillingLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [meetingsLoading, setMeetingsLoading] = useState(false);

  // Data
  const [activePeriod, setActivePeriod] = useState<AnalyticsPeriod>("7d");
  const [transcriptionHotkeys, setTranscriptionHotkeys] = useState<string[]>([]);
  const [stats, setStats] = useState<AnalyticsStats | null>(null);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [billingUsage, setBillingUsage] = useState<BillingUsageResponse | null>(null);
  const [recentTranscripts, setRecentTranscripts] = useState<Transcript[]>([]);
  const [meetingCount, setMeetingCount] = useState(0);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchBillingUsage = useCallback(async () => {
    if (!isAuthenticated || !tokens?.access_token) return;
    try {
      const data = await invoke<BillingUsageResponse>("get_billing_usage");
      setBillingUsage(data);
    } catch (err) {
      console.error("Failed to fetch billing usage:", err);
      setBillingUsage(null);
    }
  }, [isAuthenticated, tokens?.access_token]);

  const fetchStats = useCallback(async () => {
    if (!isAuthenticated || !tokens?.access_token) return;
    try {
      const data = await invoke<AnalyticsStats>("get_analytics_stats");
      setStats(data);
    } catch (error: unknown) {
      console.error("Failed to fetch analytics stats:", error);
    }
  }, [isAuthenticated, tokens?.access_token]);

  const fetchChart = useCallback(
    async (period: AnalyticsPeriod) => {
      if (!isAuthenticated || !tokens?.access_token) return;
      try {
        const data = await invoke<ChartData>("get_analytics_chart", { period });
        setChartData(data);
      } catch (error: unknown) {
        console.error(`Failed to fetch analytics chart for period ${period}:`, error);
      }
    },
    [isAuthenticated, tokens?.access_token],
  );

  const fetchRecentTranscripts = useCallback(async () => {
    if (!isAuthenticated || !tokens?.access_token) return;
    try {
      const data = await invoke<PaginatedTranscriptsResponse>("get_transcripts", {
        page: 1,
        pageSize: 5,
      });
      setRecentTranscripts(data.transcripts);
    } catch (err) {
      console.error("Failed to fetch recent transcripts:", err);
    }
  }, [isAuthenticated, tokens?.access_token]);

  const fetchMeetingCount = useCallback(async () => {
    if (!isAuthenticated || !tokens?.access_token) return;
    try {
      const meetings = await invoke<Meeting[]>("list_meetings");
      setMeetingCount(meetings.length);
    } catch (err) {
      console.error("Failed to fetch meetings:", err);
    }
  }, [isAuthenticated, tokens?.access_token]);

  // Billing
  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) { setBillingLoading(false); return; }
    let cancelled = false;
    setBillingLoading(true);
    (async () => {
      try { await fetchBillingUsage(); } finally { if (!cancelled) setBillingLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, tokens?.access_token, fetchBillingUsage]);

  // Stats
  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) { setStatsLoading(false); return; }
    let cancelled = false;
    setStatsLoading(true);
    (async () => {
      try { await fetchStats(); } finally { if (!cancelled) setStatsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, tokens?.access_token, fetchStats]);

  // Chart
  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) { setChartLoading(false); return; }
    let cancelled = false;
    setChartLoading(true);
    (async () => {
      try { await fetchChart(activePeriod); } finally { if (!cancelled) setChartLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, tokens?.access_token, activePeriod, fetchChart]);

  // Recent transcripts
  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) { setRecentLoading(false); return; }
    let cancelled = false;
    setRecentLoading(true);
    (async () => {
      try { await fetchRecentTranscripts(); } finally { if (!cancelled) setRecentLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, tokens?.access_token, fetchRecentTranscripts]);

  // Meeting count
  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) { setMeetingsLoading(false); return; }
    let cancelled = false;
    setMeetingsLoading(true);
    (async () => {
      try { await fetchMeetingCount(); } finally { if (!cancelled) setMeetingsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, tokens?.access_token, fetchMeetingCount]);

  // Hotkey
  useEffect(() => {
    const fetchHotkey = async () => {
      try {
        const hotkeyJson = await invoke<string>("get_current_hotkey");
        const hotkeyData: HotkeyConfig = JSON.parse(hotkeyJson);
        if (hotkeyData.hotkeys && hotkeyData.hotkeys.length > 0) {
          setTranscriptionHotkeys(hotkeyData.hotkeys);
        }
      } catch (err) {
        console.error("Failed to load global hotkey:", err);
      }
    };
    fetchHotkey();
  }, []);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const userName = user?.name?.split(" ")[0] || "there";
  const resolvedStats = stats ?? { words_typed_this_week: 0, time_saved_minutes: 0, current_streak: 0 };
  const resolvedChartData = chartData ?? { labels: [], data: [], total_transcriptions: 0 };
  const planUsageRows = useMemo(
    () => billingUsage?.features ? sortPlanUsageFeatures(billingUsage.features) : ([] as FeatureUsageEntry[]),
    [billingUsage],
  );
  const maxChartValue = useMemo(
    () => Math.max(...resolvedChartData.data, 1),
    [resolvedChartData.data],
  );

  const streakLevel =
    resolvedStats.current_streak >= 7
      ? "high"
      : resolvedStats.current_streak >= 3
        ? "medium"
        : "low";

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
      {/* ── Greeting Card ── */}
      <motion.header className="home-greeting-card" variants={itemVariants}>
        <div className="greeting-section">
          <h1 className="greeting-text">
            {getGreeting()}, <span className="user-name">{userName}</span>
          </h1>
          <p className="greeting-sub">
            Ready to transform your voice into text?
          </p>
          <p className="greeting-date">{formatCurrentDate()}</p>
        </div>
      </motion.header>

      {/* ── Quick Actions ── */}
      <motion.section className="quick-actions-section" variants={itemVariants}>
        <div className="quick-actions-grid">
          <QuickAction
            icon={Mic}
            label="Transcribe"
            onClick={() => {/* hotkey hint or no-op */}}
          />
          <QuickAction
            icon={Video}
            label="New Meeting"
            onClick={() => onNavigate?.("meetings")}
          />
          <QuickAction
            icon={FileText}
            label="Create Doc"
            onClick={() => onNavigate?.("docs")}
          />
          <QuickAction
            icon={ArrowLeftRight}
            label="Shortcuts"
            onClick={() => onNavigate?.("shortcuts")}
          />
        </div>
      </motion.section>

      {/* ── Usage Tip ── */}
      {transcriptionHotkeys.length > 0 && (
        <motion.div className="usage-tip" variants={itemVariants}>
          <div className="tip-icon">
            <Sparkles size={18} />
          </div>
          <div className="tip-content">
            <span className="tip-label">Quick tip</span>
            <p className="tip-text">
              Hold{" "}
              {transcriptionHotkeys.map((key, i) => (
                <React.Fragment key={key}>
                  {i > 0 && " or "}
                  <kbd className="hotkey-badge">{key}</kbd>
                </React.Fragment>
              ))}{" "}
              key and speak naturally — Lexi will transcribe in real-time
            </p>
          </div>
          <ChevronRight className="tip-arrow" size={16} />
        </motion.div>
      )}

      {/* ── Stats (4 cards) ── */}
      <motion.section className="stats-section" variants={itemVariants}>
        {isAuthenticated && (statsLoading || meetingsLoading) ? (
          <HomeStatsSkeleton />
        ) : (
          <div className="stats-grid">
            <StatCard
              icon={FileText}
              label="Words Typed"
              rawValue={resolvedStats.words_typed_this_week}
              subValue="this week"
              accentColor="var(--lexi-primary-muted)"
              iconColor="var(--lexi-primary)"
            />
            <StatCard
              icon={Clock}
              label="Time Saved"
              rawValue={resolvedStats.time_saved_minutes}
              suffix="m"
              subValue="vs typing"
              accentColor="var(--lexi-primary-muted)"
              iconColor="var(--lexi-primary)"
            />
            <StatCard
              icon={Video}
              label="Meetings"
              rawValue={meetingCount}
              subValue="total"
              accentColor="rgba(59, 130, 246, 0.15)"
              iconColor="#2563eb"
            />
            <StatCard
              icon={Flame}
              label="Streak"
              rawValue={resolvedStats.current_streak}
              subValue="days"
              accentColor={
                streakLevel === "high"
                  ? "rgba(239, 68, 68, 0.15)"
                  : streakLevel === "medium"
                    ? "rgba(245, 158, 11, 0.2)"
                    : "rgba(245, 158, 11, 0.12)"
              }
              iconColor={
                streakLevel === "high"
                  ? "#dc2626"
                  : streakLevel === "medium"
                    ? "#d97706"
                    : "#d4a053"
              }
            />
          </div>
        )}
      </motion.section>

      {/* ── Main Grid: Recent Activity | Analytics + Plan Usage ── */}
      <div className="home-grid">
        {/* Left: Recent Activity */}
        <motion.section className="recent-activity-section" variants={itemVariants}>
          <div className="section-header">
            <h2 className="section-title">Recent Activity</h2>
            <button
              type="button"
              className="view-all-btn"
              onClick={() => onNavigate?.("transcripts")}
            >
              View all
            </button>
          </div>

          <div className="recent-activity-content">
            {isAuthenticated && recentLoading ? (
              <HomeRecentSkeleton />
            ) : recentTranscripts.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <AudioLines size={28} />
                </div>
                <p className="empty-title">No transcriptions yet</p>
                <p className="empty-sub">
                  Start your first transcription and it will appear here.
                </p>
              </div>
            ) : (
              <ul className="recent-activity-list">
                {recentTranscripts.map((t) => (
                  <li
                    key={t.id}
                    className="recent-activity-row"
                    onClick={() => onNavigate?.("transcripts")}
                  >
                    <div className="recent-activity-app-icon">
                      <FileText size={16} />
                    </div>
                    <div className="recent-activity-info">
                      <span className="recent-activity-text">
                        {t.original_text.length > 80
                          ? t.original_text.slice(0, 80) + "..."
                          : t.original_text}
                      </span>
                      <div className="recent-activity-meta">
                        <span className="recent-activity-words">
                          {t.original_text_word_count} words
                        </span>
                        <span className="recent-activity-dot" />
                        <span className="recent-activity-time">
                          {formatRelativeTime(t.created_at)}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </motion.section>

        {/* Right: Analytics + Plan Usage stacked */}
        <div className="home-right-stack">
          {/* Analytics */}
          <motion.section className="analytics-section" variants={itemVariants}>
            <div className="section-header">
              <h2 className="section-title">Analytics</h2>
              <div className="period-selector">
                <PeriodButton label="1D" active={activePeriod === "1d"} onClick={() => setActivePeriod("1d")} />
                <PeriodButton label="7D" active={activePeriod === "7d"} onClick={() => setActivePeriod("7d")} />
                <PeriodButton label="30D" active={activePeriod === "30d"} onClick={() => setActivePeriod("30d")} />
              </div>
            </div>

            <div className="analytics-content">
              {isAuthenticated && chartLoading ? (
                <HomeAnalyticsSkeleton />
              ) : (
                <>
                  <div className="analytics-main-stat">
                    <div className="analytics-icon">
                      <TrendingUp size={24} />
                    </div>
                    <div className="analytics-value">
                      {resolvedChartData.total_transcriptions}
                    </div>
                    <div className="analytics-label">
                      Transcriptions in{" "}
                      {activePeriod === "1d" ? "24 hours" : activePeriod === "7d" ? "7 days" : "30 days"}
                    </div>
                  </div>

                  <div className="analytics-chart">
                    <div className="chart-bars">
                      {resolvedChartData.data.map((value, i) => (
                        <div
                          key={i}
                          className="chart-bar"
                          style={{
                            ["--chart-height" as string]: `${(value / maxChartValue) * 100}%`,
                            ["--chart-opacity" as string]: i === resolvedChartData.data.length - 1 ? 1 : 0.5,
                            ["--chart-min-height" as string]: value > 0 ? "4px" : "0",
                          } as React.CSSProperties}
                          title={`${resolvedChartData.labels[i] ?? ""}: ${value} transcriptions`}
                        />
                      ))}
                    </div>
                    <div className="chart-labels">
                      {resolvedChartData.labels.map((label, i) => (
                        <span key={i}>{label}</span>
                      ))}
                    </div>
                  </div>

                  <div className="analytics-insights">
                    <div className="insight-item">
                      <span className="insight-dot success" />
                      <span className="insight-text">
                        {resolvedChartData.total_transcriptions} successful this period
                      </span>
                    </div>
                    <div className="insight-item">
                      <span className="insight-dot info" />
                      <span className="insight-text">
                        Avg.{" "}
                        {Math.round(
                          resolvedStats.words_typed_this_week /
                            Math.max(resolvedChartData.total_transcriptions, 1),
                        )}{" "}
                        words per session
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.section>

          {/* Plan Usage */}
          <motion.section className="billing-usage-section" variants={itemVariants}>
            <div className="section-header">
              <div>
                <h2 className="section-title">Plan usage</h2>
                {billingUsage && (
                  <p className="billing-usage-meta">
                    <span className="billing-plan-badge">{billingUsage.plan_type}</span>
                    {!isProPlan(billingUsage.plan_type) && (
                      <BillingResetCountdown periodEndIso={billingUsage.period_end} />
                    )}
                  </p>
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

            <div className="transcriptions-list">
              {isAuthenticated && billingLoading ? (
                <HomeBillingSkeleton />
              ) : !isAuthenticated ? (
                <div className="empty-state">
                  <div className="empty-icon"><FileText size={32} /></div>
                  <p className="empty-title">Plan usage</p>
                  <p className="empty-sub">Sign in to see limits and usage for your plan.</p>
                </div>
              ) : !billingUsage ? (
                <div className="empty-state">
                  <div className="empty-icon"><FileText size={32} /></div>
                  <p className="empty-title">Couldn&apos;t load plan usage</p>
                  <p className="empty-sub">Check your connection and try again.</p>
                </div>
              ) : planUsageRows.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon"><FileText size={32} /></div>
                  <p className="empty-title">No plan usage yet</p>
                  <p className="empty-sub">Usage will appear once activity starts.</p>
                </div>
              ) : (
                <ul className="billing-feature-list">
                  {planUsageRows.map((feature) => {
                    const limit = feature.limit_value;
                    const isUnlimited = limit === null;
                    const used = feature.used ?? 0;
                    const enabled = !!feature.enabled;
                    const pct = isUnlimited ? 0 : clamp01(limit > 0 ? used / limit : used > 0 ? 1 : 0);

                    return (
                      <motion.li
                        key={feature.feature_key}
                        className={`billing-feature-row ${!enabled ? "is-disabled" : ""}`}
                        whileHover={enabled ? { scale: 1.01 } : undefined}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="billing-feature-info">
                          <div className="billing-feature-name-wrap">
                            <span className="billing-feature-name">{featureLabel(feature.feature_key)}</span>
                            {!enabled && <span className="billing-feature-disabled">Disabled</span>}
                          </div>
                          <div className="billing-feature-metrics">
                            {isUnlimited ? (
                              <span className="billing-feature-usage billing-usage-unlimited">Unlimited</span>
                            ) : (
                              <span className="billing-feature-usage">
                                <span className="billing-usage-numbers">{used} / {limit}</span>{" "}
                                <span className="billing-feature-usage-suffix">
                                  {featureUsageSuffix(feature.feature_key)}
                                </span>
                              </span>
                            )}
                          </div>
                        </div>
                        {!isUnlimited && feature.metered && (
                          <div className="billing-usage-bar" aria-hidden>
                            <div
                              className="billing-usage-bar-fill"
                              style={{ width: `${Math.round(pct * 100)}%`, opacity: enabled ? 1 : 0.45 }}
                            />
                          </div>
                        )}
                      </motion.li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.section>
        </div>
      </div>
    </motion.div>
  );
};
