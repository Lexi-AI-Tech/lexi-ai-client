/**
 * HomePage Component
 *
 * The main dashboard displaying greeting, usage tips, stats,
 * plan usage, and analytics.
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Clock,
  FileText,
  TrendingUp,
  Sparkles,
  ChevronRight,
  Flame,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../../store/authStore";
import type { HotkeyConfig } from "../../types";
import "./home.css";

// Analytics interfaces
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

const FEATURE_LABELS: Record<string, string> = {
  "assistant.speech_to_text": "Assistant",
  "meetings.create": "Meeting",
  "actions.perform": "Actions",
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

function isProPlan(planType: string): boolean {
  return planType.trim().toLowerCase() === "pro";
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

/** Time until ``periodEnd``; labels like "Resets in 05d 04h 12m 03s". */
function formatResetsInCountdown(periodEndMs: number, nowMs: number): string {
  const ms = periodEndMs - nowMs;
  if (Number.isNaN(ms) || periodEndMs <= 0) {
    return "Resets soon";
  }
  if (ms <= 0) {
    return "Resets soon";
  }
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const p2 = (n: number) => String(n).padStart(2, "0");
  const dPart = days < 100 ? p2(days) : String(days);
  return `Resets in ${dPart}d ${p2(h)}h ${p2(m)}m ${p2(s)}s`;
}

function BillingResetCountdown({ periodEndIso }: { periodEndIso: string }) {
  const endMs = useMemo(() => new Date(periodEndIso).getTime(), [periodEndIso]);
  const [label, setLabel] = useState(() =>
    formatResetsInCountdown(endMs, Date.now()),
  );

  useEffect(() => {
    const tick = () => {
      setLabel(formatResetsInCountdown(endMs, Date.now()));
    };
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
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
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

// Helper to get greeting based on time
const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

// Stats card component – accentColor = icon/badge tint; iconColor = icon stroke (theme-aligned)
interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subValue?: string;
  accentColor: string;
  iconColor?: string;
}

const StatCard: React.FC<StatCardProps> = ({
  icon: Icon,
  label,
  value,
  subValue,
  accentColor,
  iconColor,
}) => (
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
      <span className="stat-card-value">{value}</span>
      <span className="stat-card-label">{label}</span>
      {subValue && <span className="stat-card-sub">{subValue}</span>}
    </div>
  </motion.div>
);

// Analytics period button
interface PeriodButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

interface HomePageProps {
  onViewAllTranscripts?: () => void;
}

const PeriodButton: React.FC<PeriodButtonProps> = ({
  label,
  active,
  onClick,
}) => (
  <button
    type="button"
    className={`period-btn ${active ? "active" : ""}`}
    onClick={onClick}
  >
    {label}
  </button>
);

const SkBlock: React.FC<{
  className?: string;
  style?: React.CSSProperties;
}> = ({ className, style }) => (
  <div className={`skeleton-block ${className ?? ""}`.trim()} style={style} />
);

const HomeStatsSkeleton: React.FC = () => (
  <div className="home-stats-skeleton" aria-hidden>
    {Array.from({ length: 3 }).map((_, i) => (
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
        <SkBlock
          style={{
            height: 12,
            width: "38%",
            borderRadius: 6,
            marginBottom: 10,
          }}
        />
        <SkBlock
          style={{ height: 14, width: "72%", borderRadius: 8, marginBottom: 8 }}
        />
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
            <SkBlock
              key={i}
              className="home-analytics-skeleton__bar"
              style={{ height: h }}
            />
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

export const HomePage: React.FC<HomePageProps> = ({
  onViewAllTranscripts: _onViewAllTranscripts,
}) => {
  const { user, isAuthenticated, tokens } = useAuthStore();
  const [billingLoading, setBillingLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [activePeriod, setActivePeriod] = useState<AnalyticsPeriod>("7d");
  const [transcriptionHotkeys, setTranscriptionHotkeys] = useState<string[]>(
    [],
  );
  const [stats, setStats] = useState<AnalyticsStats | null>(null);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [billingUsage, setBillingUsage] = useState<BillingUsageResponse | null>(
    null,
  );

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
        const data = await invoke<ChartData>("get_analytics_chart", {
          period,
        });
        setChartData(data);
      } catch (error: unknown) {
        console.error(
          `Failed to fetch analytics chart for period ${period}:`,
          error,
        );
      }
    },
    [isAuthenticated, tokens?.access_token],
  );

  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) {
      setBillingLoading(false);
      setStatsLoading(false);
      return;
    }
    let cancelled = false;
    setBillingLoading(true);
    (async () => {
      try {
        await fetchBillingUsage();
      } finally {
        if (!cancelled) setBillingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, tokens?.access_token, fetchBillingUsage]);

  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) {
      setStatsLoading(false);
      return;
    }
    let cancelled = false;
    setStatsLoading(true);
    (async () => {
      try {
        await fetchStats();
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, tokens?.access_token, fetchStats]);

  useEffect(() => {
    if (!isAuthenticated || !tokens?.access_token) {
      setChartLoading(false);
      return;
    }
    let cancelled = false;
    setChartLoading(true);
    (async () => {
      try {
        await fetchChart(activePeriod);
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, tokens?.access_token, activePeriod, fetchChart]);

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

  const userName = user?.name?.split(" ")[0] || "there";
  const resolvedStats = stats ?? {
    words_typed_this_week: 0,
    time_saved_minutes: 0,
    current_streak: 0,
  };
  const resolvedChartData = chartData ?? {
    labels: [],
    data: [],
    total_transcriptions: 0,
  };
  const planUsageRows = useMemo(
    () =>
      billingUsage?.features
        ? sortPlanUsageFeatures(billingUsage.features)
        : ([] as FeatureUsageEntry[]),
    [billingUsage],
  );
  const maxChartValue = useMemo(
    () => Math.max(...resolvedChartData.data, 1),
    [resolvedChartData.data],
  );

  return (
    <motion.div
      className="home-container"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.header className="home-header" variants={itemVariants}>
        <div className="greeting-section">
          <h1 className="greeting-text">
            {getGreeting()}, <span className="user-name">{userName}</span>
          </h1>
          <p className="greeting-sub">
            Ready to transform your voice into text?
          </p>
        </div>
      </motion.header>

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

      <motion.section className="stats-section" variants={itemVariants}>
        {isAuthenticated && statsLoading ? (
          <HomeStatsSkeleton />
        ) : (
          <div className="stats-grid">
            <StatCard
              icon={FileText}
              label="Words Typed"
              value={resolvedStats.words_typed_this_week.toLocaleString()}
              subValue="this week"
              accentColor="var(--lexi-primary-muted)"
              iconColor="var(--lexi-primary)"
            />
            <StatCard
              icon={Clock}
              label="Time Saved"
              value={`${resolvedStats.time_saved_minutes}m`}
              subValue="vs typing"
              accentColor="var(--lexi-primary-muted)"
              iconColor="var(--lexi-primary)"
            />
            <StatCard
              icon={Flame}
              label="Streak"
              value={`${resolvedStats.current_streak}`}
              subValue="days"
              accentColor="rgba(245, 158, 11, 0.2)"
              iconColor="#d97706"
            />
          </div>
        )}
      </motion.section>

      <div className="home-grid">
        <motion.section
          className="billing-usage-section"
          variants={itemVariants}
        >
          <div className="section-header">
            <div>
              <h2 className="section-title">Plan usage</h2>
              {billingUsage && (
                <p className="billing-usage-meta">
                  <span className="billing-plan-badge">
                    {billingUsage.plan_type}
                  </span>
                  {!isProPlan(billingUsage.plan_type) && (
                    <BillingResetCountdown
                      periodEndIso={billingUsage.period_end}
                    />
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="transcriptions-list">
            {isAuthenticated && billingLoading ? (
              <HomeBillingSkeleton />
            ) : !isAuthenticated ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <FileText size={32} />
                </div>
                <p className="empty-title">Plan usage</p>
                <p className="empty-sub">
                  Sign in to see limits and usage for your plan.
                </p>
              </div>
            ) : !billingUsage ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <FileText size={32} />
                </div>
                <p className="empty-title">Couldn&apos;t load plan usage</p>
                <p className="empty-sub">
                  Check your connection and try again.
                </p>
              </div>
            ) : planUsageRows.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <FileText size={32} />
                </div>
                <p className="empty-title">No plan usage yet</p>
                <p className="empty-sub">
                  Usage will appear once activity starts.
                </p>
              </div>
            ) : (
              planUsageRows.map((feature) => (
                <motion.div
                  key={feature.feature_key}
                  className="transcript-card"
                  whileHover={{ scale: 1.01 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="transcript-card-header"></div>
                  <p className="transcript-preview">
                    {featureLabel(feature.feature_key)}
                  </p>
                  <div className="transcript-meta">
                    <span>{feature.used}</span>
                    <span>used</span>
                    {feature.limit_value !== null && (
                      <span>• {feature.limit_value} limit</span>
                    )}
                    <span>• {feature.enabled ? "Enabled" : "Disabled"}</span>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </motion.section>

        <motion.section className="analytics-section" variants={itemVariants}>
          <div className="section-header">
            <h2 className="section-title">Analytics</h2>
            <div className="period-selector">
              <PeriodButton
                label="1D"
                active={activePeriod === "1d"}
                onClick={() => setActivePeriod("1d")}
              />
              <PeriodButton
                label="7D"
                active={activePeriod === "7d"}
                onClick={() => setActivePeriod("7d")}
              />
              <PeriodButton
                label="30D"
                active={activePeriod === "30d"}
                onClick={() => setActivePeriod("30d")}
              />
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
                    {activePeriod === "1d"
                      ? "24 hours"
                      : activePeriod === "7d"
                        ? "7 days"
                        : "30 days"}
                  </div>
                </div>

                <div className="analytics-chart">
                  <div className="chart-bars">
                    {resolvedChartData.data.map((value, i) => (
                      <div
                        key={i}
                        className="chart-bar"
                        style={
                          {
                            ["--chart-height" as string]: `${(value / maxChartValue) * 100}%`,
                            ["--chart-opacity" as string]:
                              i === resolvedChartData.data.length - 1 ? 1 : 0.5,
                            ["--chart-min-height" as string]:
                              value > 0 ? "4px" : "0",
                          } as React.CSSProperties
                        }
                        title={`${value} transcriptions`}
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
                      {resolvedChartData.total_transcriptions} successful this
                      period
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
      </div>
    </motion.div>
  );
};
