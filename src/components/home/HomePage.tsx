/**
 * HomePage Component
 *
 * The main dashboard displaying greeting, usage tips, stats,
 * past transcriptions, and analytics.
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
import type { Transcript, HotkeyConfig } from "../../types";
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

interface HomePageProps {
  onViewAllTranscripts?: () => void;
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

// Stats card component
interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subValue?: string;
  accentColor: string;
}

const StatCard: React.FC<StatCardProps> = ({
  icon: Icon,
  label,
  value,
  subValue,
  accentColor,
}) => (
  <motion.div className="stat-card" variants={itemVariants} style={{ ["--stat-accent" as string]: accentColor }}>
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

const PeriodButton: React.FC<PeriodButtonProps> = ({
  label,
  active,
  onClick,
}) => (
  <button className={`period-btn ${active ? "active" : ""}`} onClick={onClick}>
    {label}
  </button>
);

export const HomePage: React.FC<HomePageProps> = ({ onViewAllTranscripts }) => {
  const { user, isAuthenticated, tokens } = useAuthStore();
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(false);
  const [activePeriod, setActivePeriod] = useState<AnalyticsPeriod>("7d");
  const [transcriptionHotkeys, setTranscriptionHotkeys] = useState<string[]>(["fn"]);

  const [stats, setStats] = useState<AnalyticsStats>({
    words_typed_this_week: 0,
    time_saved_minutes: 0,
    current_streak: 0,
  });

  const [chartData, setChartData] = useState<ChartData>({
    labels: [],
    data: [],
    total_transcriptions: 0,
  });

  // Fetch transcripts
  const fetchTranscripts = useCallback(async () => {
    if (!isAuthenticated || !tokens?.access_token) return;

    setLoading(true);
    try {
      const response = await invoke<{
        transcripts: Transcript[];
        total: number;
        page: number;
        page_size: number;
        total_pages: number;
      }>("get_transcripts", {
        page: 1,
        pageSize: 5,
      });
      setTranscripts(response.transcripts);
    } catch (err) {
      console.error("Failed to fetch transcripts:", err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, tokens?.access_token]);

  // Fetch analytics stats
  const fetchStats = useCallback(async () => {
    if (!isAuthenticated || !tokens?.access_token) return;

    try {
      const data = await invoke<AnalyticsStats>("get_analytics_stats");
      setStats(data);
    } catch (error: any) {
      console.error("Failed to fetch analytics stats:", error);
    }
  }, [isAuthenticated, tokens?.access_token]);

  // Fetch chart data when period changes
  useEffect(() => {
    const fetchChart = async () => {
      if (!isAuthenticated || !tokens?.access_token) return;

      try {
        const data = await invoke<ChartData>("get_analytics_chart", {
          period: activePeriod,
        });
        setChartData(data);
      } catch (error: any) {
        console.error(
          `Failed to fetch analytics chart for period ${activePeriod}:`,
          error,
        );
      }
    };

    fetchChart();
  }, [isAuthenticated, tokens?.access_token, activePeriod]);

  useEffect(() => {
    fetchTranscripts();
    fetchStats();
  }, [fetchTranscripts, fetchStats]);

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

  const maxChartValue = useMemo(() => {
    return Math.max(...chartData.data, 1);
  }, [chartData.data]);

  return (
    <motion.div
      className="home-container"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Greeting Section */}
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

      {/* Usage Tip Section */}
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
            key{transcriptionHotkeys.length > 1 && "s"} and speak naturally
            — Lexi will transcribe in real-time
          </p>
        </div>
        <ChevronRight className="tip-arrow" size={16} />
      </motion.div>

      {/* Hero Stats Section */}
      <motion.section className="stats-section" variants={itemVariants}>
        <div className="stats-grid">
          <StatCard
            icon={FileText}
            label="Words Typed"
            value={stats.words_typed_this_week.toLocaleString()}
            subValue="this week"
            accentColor="rgba(99, 102, 241, 0.15)"
          />
          <StatCard
            icon={Clock}
            label="Time Saved"
            value={`${stats.time_saved_minutes}m`}
            subValue="vs typing"
            accentColor="rgba(16, 185, 129, 0.15)"
          />
          <StatCard
            icon={Flame}
            label="Streak"
            value={`${stats.current_streak}`}
            subValue="days"
            accentColor="rgba(245, 158, 11, 0.15)"
          />
        </div>
      </motion.section>

      {/* Main Content Grid */}
      <div className="home-grid">
        {/* Past Transcriptions Section */}
        <motion.section
          className="transcriptions-section"
          variants={itemVariants}
        >
          <div className="section-header">
            <h2 className="section-title">Recent Transcriptions</h2>
            <button
              type="button"
              className="view-all-btn"
              onClick={onViewAllTranscripts}
            >
              View all
            </button>
          </div>

          <div className="transcriptions-list">
            {loading ? (
              <div className="loading-state">
                <div className="loading-spinner" />
                <span>Loading transcriptions...</span>
              </div>
            ) : transcripts.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <FileText size={32} />
                </div>
                <p className="empty-title">No transcriptions yet</p>
                <p className="empty-sub">
                  Hold {transcriptionHotkeys.join(" or ")} and speak to create your first transcription
                </p>
              </div>
            ) : (
              transcripts.map((transcript) => (
                <motion.div
                  key={transcript.id}
                  className="transcript-card"
                  whileHover={{ scale: 1.01 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="transcript-card-header"></div>
                  <p className="transcript-preview">
                    {transcript.original_text
                      ? transcript.original_text.length > 120
                        ? `${transcript.original_text.slice(0, 120)}...`
                        : transcript.original_text
                      : "Processing..."}
                  </p>
                  <div className="transcript-meta">
                    <span>
                      {transcript.original_text_word_count || 0} words
                    </span>
                    {transcript.focused_app && (
                      <span>• {transcript.focused_app}</span>
                    )}
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </motion.section>

        {/* Analytics Section */}
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
            <div className="analytics-main-stat">
              <div className="analytics-icon">
                <TrendingUp size={24} />
              </div>
              <div className="analytics-value">
                {chartData.total_transcriptions}
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
              {/* Visual bar representation */}
              <div className="chart-bars">
                {chartData.data.map((value, i) => (
                  <div
                    key={i}
                    className="chart-bar"
                    style={{
                      ["--chart-height" as string]: `${(value / maxChartValue) * 100}%`,
                      ["--chart-opacity" as string]: i === chartData.data.length - 1 ? 1 : 0.5,
                      ["--chart-min-height" as string]: value > 0 ? "4px" : "0",
                    } as React.CSSProperties}
                    title={`${value} transcriptions`}
                  />
                ))}
              </div>
              <div className="chart-labels">
                {chartData.labels.map((label, i) => (
                  <span key={i}>{label}</span>
                ))}
              </div>
            </div>

            <div className="analytics-insights">
              <div className="insight-item">
                <span className="insight-dot success" />
                <span className="insight-text">
                  {chartData.total_transcriptions} successful this period
                </span>
              </div>
              <div className="insight-item">
                <span className="insight-dot info" />
                <span className="insight-text">
                  Avg.{" "}
                  {Math.round(
                    stats.words_typed_this_week /
                    Math.max(chartData.total_transcriptions, 1),
                  )}{" "}
                  words per session
                </span>
              </div>
            </div>
          </div>
        </motion.section>
      </div>
    </motion.div>
  );
};
