/**
 * HomePage Component
 *
 * Compact dashboard: greeting, quick actions with descriptions,
 * unified stats card with plan usage, mixed recent activity feed, and analytics.
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

// Unified activity item for mixed feed
interface ActivityItem {
  id: string;
  type: "transcription" | "meeting";
  title: string;
  subtitle: string;
  timestamp: string;
  icon: React.ElementType;
}

// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------

const UPGRADE_URL = "https://speaklexi.com";

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

function sortPlanUsageFeatures<T extends { feature_key: string }>(features: T[]): T[] {
  const orderMap = new Map<string, number>(PLAN_USAGE_FEATURE_ORDER.map((k, i) => [k, i]));
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
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatCurrentDate(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

/** Build mixed activity feed from transcripts + meetings, sorted by date desc. */
function buildActivityFeed(transcripts: Transcript[], meetings: Meeting[]): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const t of transcripts) {
    items.push({
      id: `t-${t.id}`,
      type: "transcription",
      title: t.original_text.length > 70 ? t.original_text.slice(0, 70) + "..." : t.original_text,
      subtitle: `${t.original_text_word_count} words`,
      timestamp: t.created_at,
      icon: AudioLines,
    });
  }

  for (const m of meetings) {
    items.push({
      id: `m-${m.id}`,
      type: "meeting",
      title: m.name || "Untitled Meeting",
      subtitle: m.platform ?? "Meeting",
      timestamp: m.created_at,
      icon: Video,
    });
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return items.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useCountUp(end: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const prevEnd = useRef(0);

  useEffect(() => {
    if (end === prevEnd.current) return;
    prevEnd.current = end;
    if (end === 0) { setValue(0); return; }
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
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
  const [label, setLabel] = useState(() => formatResetsInCountdown(endMs, Date.now()));
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
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } },
};

// Inline stat inside the unified card
const InlineStat: React.FC<{
  icon: React.ElementType;
  label: string;
  rawValue: number;
  suffix?: string;
  subValue?: string;
  accentColor: string;
  iconColor?: string;
}> = ({ icon: Icon, label, rawValue, suffix = "", subValue, accentColor, iconColor }) => {
  const animatedValue = useCountUp(rawValue);
  return (
    <div
      className="inline-stat"
      style={{
        ["--stat-accent" as string]: accentColor,
        ["--stat-icon-color" as string]: iconColor ?? "var(--lexi-primary)",
      }}
    >
      <div className="inline-stat-icon">
        <Icon size={18} />
      </div>
      <div className="inline-stat-content">
        <span className="inline-stat-value">{animatedValue.toLocaleString()}{suffix}</span>
        <span className="inline-stat-label">{label}</span>
        {subValue && <span className="inline-stat-sub">{subValue}</span>}
      </div>
    </div>
  );
};

const PeriodButton: React.FC<{ label: string; active: boolean; onClick: () => void }> = ({ label, active, onClick }) => (
  <button type="button" className={`period-btn ${active ? "active" : ""}`} onClick={onClick}>{label}</button>
);

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
const SkBlock: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className, style }) => (
  <div className={`skeleton-block ${className ?? ""}`.trim()} style={style} />
);

const HomeStatsSkeleton: React.FC = () => (
  <div className="stats-card" aria-hidden>
    <div className="stats-card-grid">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="inline-stat">
          <SkBlock style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <SkBlock style={{ height: 22, width: "50%", borderRadius: 6 }} />
            <SkBlock style={{ height: 12, width: "65%", borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  </div>
);

const HomeAnalyticsSkeleton: React.FC = () => {
  const barHeights = [28, 52, 36, 64, 44, 58, 32, 48, 40, 56];
  return (
    <div className="home-analytics-skeleton" aria-hidden>
      <div className="home-analytics-skeleton__main">
        <SkBlock style={{ width: 40, height: 40, borderRadius: 10 }} />
        <SkBlock style={{ height: 32, width: "40%", borderRadius: 8 }} />
        <SkBlock style={{ height: 12, width: "55%", borderRadius: 6 }} />
      </div>
      <div className="home-analytics-skeleton__chart">
        <div className="home-analytics-skeleton__bars">
          {barHeights.map((h, i) => (
            <SkBlock key={i} className="home-analytics-skeleton__bar" style={{ height: h }} />
          ))}
        </div>
      </div>
    </div>
  );
};

const HomeRecentSkeleton: React.FC = () => (
  <div className="home-recent-skeleton" aria-hidden>
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="home-recent-skeleton__row">
        <SkBlock style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
          <SkBlock style={{ height: 13, width: "70%", borderRadius: 5 }} />
          <SkBlock style={{ height: 10, width: "45%", borderRadius: 4 }} />
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

export const HomePage: React.FC<HomePageProps> = ({ onViewAllTranscripts: _onViewAllTranscripts, onNavigate }) => {
  const { user, isAuthenticated, tokens } = useAuthStore();

  const [billingLoading, setBillingLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [meetingsLoading, setMeetingsLoading] = useState(false);

  const [activePeriod, setActivePeriod] = useState<AnalyticsPeriod>("7d");
  const [transcriptionHotkeys, setTranscriptionHotkeys] = useState<string[]>([]);
  const [stats, setStats] = useState<AnalyticsStats | null>(null);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [billingUsage, setBillingUsage] = useState<BillingUsageResponse | null>(null);
  const [recentTranscripts, setRecentTranscripts] = useState<Transcript[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);

  // Data fetching
  const fetchBillingUsage = useCallback(async () => {
    if (!isAuthenticated || !tokens?.access_token) return;
    try { setBillingUsage(await invoke<BillingUsageResponse>("get_billing_usage")); }
    catch (err) { console.error("Failed to fetch billing usage:", err); setBillingUsage(null); }
  }, [isAuthenticated, tokens?.access_token]);

  const fetchStats = useCallback(async () => {
    if (!isAuthenticated || !tokens?.access_token) return;
    try { setStats(await invoke<AnalyticsStats>("get_analytics_stats")); }
    catch (e) { console.error("Failed to fetch analytics stats:", e); }
  }, [isAuthenticated, tokens?.access_token]);

  const fetchChart = useCallback(async (period: AnalyticsPeriod) => {
    if (!isAuthenticated || !tokens?.access_token) return;
    try { setChartData(await invoke<ChartData>("get_analytics_chart", { period })); }
    catch (e) { console.error(`Failed to fetch chart for ${period}:`, e); }
  }, [isAuthenticated, tokens?.access_token]);

  const fetchRecentTranscripts = useCallback(async () => {
    if (!isAuthenticated || !tokens?.access_token) return;
    try {
      const data = await invoke<PaginatedTranscriptsResponse>("get_transcripts", { page: 1, pageSize: 5 });
      setRecentTranscripts(data.transcripts);
    } catch (err) { console.error("Failed to fetch recent transcripts:", err); }
  }, [isAuthenticated, tokens?.access_token]);

  const fetchMeetings = useCallback(async () => {
    if (!isAuthenticated || !tokens?.access_token) return;
    try { setMeetings(await invoke<Meeting[]>("list_meetings")); }
    catch (err) { console.error("Failed to fetch meetings:", err); }
  }, [isAuthenticated, tokens?.access_token]);

  // Effects
  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) { setBillingLoading(false); return; }
    let c = false; setBillingLoading(true);
    (async () => { try { await fetchBillingUsage(); } finally { if (!c) setBillingLoading(false); } })();
    return () => { c = true; };
  }, [isAuthenticated, tokens?.access_token, fetchBillingUsage]);

  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) { setStatsLoading(false); return; }
    let c = false; setStatsLoading(true);
    (async () => { try { await fetchStats(); } finally { if (!c) setStatsLoading(false); } })();
    return () => { c = true; };
  }, [isAuthenticated, tokens?.access_token, fetchStats]);

  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) { setChartLoading(false); return; }
    let c = false; setChartLoading(true);
    (async () => { try { await fetchChart(activePeriod); } finally { if (!c) setChartLoading(false); } })();
    return () => { c = true; };
  }, [isAuthenticated, tokens?.access_token, activePeriod, fetchChart]);

  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) { setRecentLoading(false); return; }
    let c = false; setRecentLoading(true);
    (async () => { try { await fetchRecentTranscripts(); } finally { if (!c) setRecentLoading(false); } })();
    return () => { c = true; };
  }, [isAuthenticated, tokens?.access_token, fetchRecentTranscripts]);

  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) { setMeetingsLoading(false); return; }
    let c = false; setMeetingsLoading(true);
    (async () => { try { await fetchMeetings(); } finally { if (!c) setMeetingsLoading(false); } })();
    return () => { c = true; };
  }, [isAuthenticated, tokens?.access_token, fetchMeetings]);

  useEffect(() => {
    (async () => {
      try {
        const hotkeyJson = await invoke<string>("get_current_hotkey");
        const hotkeyData: HotkeyConfig = JSON.parse(hotkeyJson);
        if (hotkeyData.hotkeys?.length) setTranscriptionHotkeys(hotkeyData.hotkeys);
      } catch (err) { console.error("Failed to load global hotkey:", err); }
    })();
  }, []);

  // Derived
  const userName = user?.name?.split(" ")[0] || "there";
  const resolvedStats = stats ?? { words_typed_this_week: 0, time_saved_minutes: 0, current_streak: 0 };
  const resolvedChartData = chartData ?? { labels: [], data: [], total_transcriptions: 0 };
  const planUsageRows = useMemo(
    () => billingUsage?.features ? sortPlanUsageFeatures(billingUsage.features) : [],
    [billingUsage],
  );
  const maxChartValue = useMemo(() => Math.max(...resolvedChartData.data, 1), [resolvedChartData.data]);
  const streakLevel = resolvedStats.current_streak >= 7 ? "high" : resolvedStats.current_streak >= 3 ? "medium" : "low";
  const activityFeed = useMemo(() => buildActivityFeed(recentTranscripts, meetings), [recentTranscripts, meetings]);

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
    <motion.div className="home-container" variants={containerVariants} initial="hidden" animate="visible">
      {/* ── Greeting ── */}
      <motion.header className="home-greeting" variants={itemVariants}>
        <div className="greeting-section">
          <p className="greeting-date">{formatCurrentDate()}</p>
          <h1 className="greeting-text">
            {getGreeting()}, <span className="user-name">{userName}</span>
          </h1>
          <p className="greeting-sub">Ready to transform your voice into text?</p>
        </div>
      </motion.header>

      {/* ── Quick Actions with descriptions ── */}
      <motion.section className="quick-actions-section" variants={itemVariants}>
        <div className="quick-actions-grid">
          <QuickAction
            icon={Mic}
            label="Transcribe"
            description="Convert speech to text instantly"
            onClick={() => {}}
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
            icon={ArrowLeftRight}
            label="Shortcuts"
            description="Custom text expansion shortcuts"
            onClick={() => onNavigate?.("shortcuts")}
          />
        </div>
      </motion.section>

      {/* ── Hotkey Tip ── */}
      {transcriptionHotkeys.length > 0 && (
        <motion.div className="usage-tip" variants={itemVariants}>
          <div className="tip-icon"><Sparkles size={16} /></div>
          <div className="tip-content">
            <p className="tip-text">
              Hold{" "}
              {transcriptionHotkeys.map((key, i) => (
                <React.Fragment key={key}>
                  {i > 0 && " or "}
                  <kbd className="hotkey-badge">{key}</kbd>
                </React.Fragment>
              ))}{" "}
              and speak — Lexi transcribes in real-time
            </p>
          </div>
          <ChevronRight className="tip-arrow" size={14} />
        </motion.div>
      )}

      {/* ── Unified Stats Card ── */}
      <motion.section className="stats-section" variants={itemVariants}>
        {isAuthenticated && (statsLoading || meetingsLoading) ? (
          <HomeStatsSkeleton />
        ) : (
          <div className="stats-card">
            <div className="stats-card-grid">
              <InlineStat
                icon={FileText}
                label="Words Typed"
                rawValue={resolvedStats.words_typed_this_week}
                subValue="this week"
                accentColor="var(--lexi-primary-muted)"
                iconColor="var(--lexi-primary)"
              />
              <InlineStat
                icon={Clock}
                label="Time Saved"
                rawValue={resolvedStats.time_saved_minutes}
                suffix="m"
                subValue="vs typing"
                accentColor="var(--lexi-primary-muted)"
                iconColor="var(--lexi-primary)"
              />
              <InlineStat
                icon={Video}
                label="Meetings"
                rawValue={meetings.length}
                subValue="total"
                accentColor="rgba(59, 130, 246, 0.15)"
                iconColor="#2563eb"
              />
              <InlineStat
                icon={Flame}
                label="Streak"
                rawValue={resolvedStats.current_streak}
                subValue="days"
                accentColor={streakLevel === "high" ? "rgba(239,68,68,0.15)" : streakLevel === "medium" ? "rgba(245,158,11,0.2)" : "rgba(245,158,11,0.12)"}
                iconColor={streakLevel === "high" ? "#dc2626" : streakLevel === "medium" ? "#d97706" : "#d4a053"}
              />
            </div>

            {/* Plan usage strip inside stats card */}
            {billingUsage && planUsageRows.length > 0 && (
              <div className="plan-usage-strip">
                <div className="plan-usage-strip-header">
                  <div className="plan-usage-strip-header-left">
                    <span className="billing-plan-badge">{billingUsage.plan_type}</span>
                    {!isProPlan(billingUsage.plan_type) && (
                      <BillingResetCountdown periodEndIso={billingUsage.period_end} />
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
                <div className="plan-usage-bars">
                  {planUsageRows.map((feature) => {
                    const limit = feature.limit_value;
                    const isUnlimited = limit === null;
                    const used = feature.used ?? 0;
                    const pct = isUnlimited ? 0 : clamp01(limit > 0 ? used / limit : used > 0 ? 1 : 0);
                    return (
                      <div key={feature.feature_key} className="plan-usage-item">
                        <div className="plan-usage-item-header">
                          <span className="plan-usage-item-name">{featureLabel(feature.feature_key)}</span>
                          <span className="plan-usage-item-value">
                            {isUnlimited
                              ? "Unlimited"
                              : `${used} / ${limit} ${featureUsageSuffix(feature.feature_key)}`}
                          </span>
                        </div>
                        {!isUnlimited && feature.metered && (
                          <div className="plan-usage-bar">
                            <div className="plan-usage-bar-fill" style={{ width: `${Math.round(pct * 100)}%` }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </motion.section>

      {/* ── Main Grid: Recent Activity | Analytics ── */}
      <div className="home-grid">
        {/* Left: Mixed Recent Activity */}
        <motion.section className="recent-activity-section" variants={itemVariants}>
          <div className="section-header">
            <h2 className="section-title">Recent Activity</h2>
            <button type="button" className="view-all-btn" onClick={() => onNavigate?.("transcripts")}>
              View all
            </button>
          </div>

          <div className="recent-activity-content">
            {isAuthenticated && (recentLoading || meetingsLoading) ? (
              <HomeRecentSkeleton />
            ) : activityFeed.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><AudioLines size={24} /></div>
                <p className="empty-title">No activity yet</p>
                <p className="empty-sub">Transcriptions and meetings will appear here.</p>
              </div>
            ) : (
              <ul className="recent-activity-list">
                {activityFeed.map((item) => (
                  <li
                    key={item.id}
                    className="recent-activity-row"
                    onClick={() => onNavigate?.(item.type === "meeting" ? "meetings" : "transcripts")}
                  >
                    <div className={`recent-activity-badge ${item.type}`}>
                      <item.icon size={14} />
                    </div>
                    <div className="recent-activity-info">
                      <span className="recent-activity-text">{item.title}</span>
                      <div className="recent-activity-meta">
                        <span className="recent-activity-type">{item.type === "meeting" ? "Meeting" : "Transcription"}</span>
                        <span className="recent-activity-dot" />
                        <span className="recent-activity-subtitle">{item.subtitle}</span>
                        <span className="recent-activity-dot" />
                        <span className="recent-activity-time">{formatRelativeTime(item.timestamp)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </motion.section>

        {/* Right: Analytics */}
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
                  <div className="analytics-icon"><TrendingUp size={20} /></div>
                  <div className="analytics-value">{resolvedChartData.total_transcriptions}</div>
                  <div className="analytics-label">
                    Transcriptions in {activePeriod === "1d" ? "24h" : activePeriod === "7d" ? "7 days" : "30 days"}
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
                    {resolvedChartData.labels.map((label, i) => <span key={i}>{label}</span>)}
                  </div>
                </div>

                <div className="analytics-insights">
                  <div className="insight-item">
                    <span className="insight-dot success" />
                    <span className="insight-text">{resolvedChartData.total_transcriptions} successful this period</span>
                  </div>
                  <div className="insight-item">
                    <span className="insight-dot info" />
                    <span className="insight-text">
                      Avg. {Math.round(resolvedStats.words_typed_this_week / Math.max(resolvedChartData.total_transcriptions, 1))} words per session
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </motion.section>
      </div>
    </motion.div>
  );
};
