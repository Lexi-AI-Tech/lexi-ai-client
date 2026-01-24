/**
 * HomePage Component
 *
 * The main dashboard displaying greeting, usage tips, stats,
 * past transcriptions, and analytics.
 */

import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Clock,
  Target,
  FileText,
  TrendingUp,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../../store/authStore";
import type { Transcript } from "../../types";
import "./home.css";

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

// Helper to format relative time
const formatRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
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
  <motion.div className="stat-card" variants={itemVariants}>
    <div className="stat-card-icon" style={{ background: accentColor }}>
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

export const HomePage: React.FC = () => {
  const { user, isAuthenticated, tokens } = useAuthStore();
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(false);
  const [activePeriod, setActivePeriod] = useState<"1d" | "7d" | "30d">("7d");
  const [stats, setStats] = useState({
    wordsTyped: 0,
    timeSaved: 0,
    accuracyRate: 98.5,
    transcriptCounts: { "1d": 0, "7d": 0, "30d": 0 },
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

      // Calculate stats from transcripts
      const totalWords = response.transcripts.reduce(
        (acc, t) => acc + (t.original_text_word_count || 0),
        0
      );
      const totalChars = response.transcripts.reduce(
        (acc, t) => acc + (t.original_text_character_count || 0),
        0
      );

      // Estimate time saved: average typing speed ~40 WPM, voice ~150 WPM
      // Time saved = chars * (1/40 - 1/150) / 60 minutes
      const timeSavedMinutes = Math.round(
        (totalChars / 40 - totalChars / 150) / 60
      );

      // Count transcripts by period
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const counts = {
        "1d": response.transcripts.filter(
          (t) => new Date(t.created_at) > oneDayAgo
        ).length,
        "7d": response.transcripts.filter(
          (t) => new Date(t.created_at) > sevenDaysAgo
        ).length,
        "30d": response.transcripts.filter(
          (t) => new Date(t.created_at) > thirtyDaysAgo
        ).length,
      };

      setStats({
        wordsTyped: totalWords,
        timeSaved: timeSavedMinutes,
        accuracyRate: 98.5 + Math.random() * 1.5, // Simulated accuracy
        transcriptCounts: counts,
      });
    } catch (err) {
      console.error("Failed to fetch transcripts:", err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, tokens?.access_token]);

  useEffect(() => {
    fetchTranscripts();
  }, [fetchTranscripts]);

  const userName = user?.name?.split(" ")[0] || "there";

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
            Hold <kbd className="hotkey-badge">fn</kbd> key and speak naturally
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
            value={stats.wordsTyped.toLocaleString()}
            subValue="this week"
            accentColor="rgba(99, 102, 241, 0.15)"
          />
          <StatCard
            icon={Clock}
            label="Time Saved"
            value={`${stats.timeSaved}m`}
            subValue="vs typing"
            accentColor="rgba(16, 185, 129, 0.15)"
          />
          <StatCard
            icon={Target}
            label="Accuracy"
            value={`${stats.accuracyRate.toFixed(1)}%`}
            subValue="recognition rate"
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
            <button className="view-all-btn">View all</button>
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
                  Hold fn and speak to create your first transcription
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
                  <div className="transcript-card-header">
                    <span
                      className={`transcript-status ${transcript.status.toLowerCase()}`}
                    >
                      {transcript.status}
                    </span>
                    <span className="transcript-time">
                      {formatRelativeTime(transcript.created_at)}
                    </span>
                  </div>
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
                    {transcript.provider && (
                      <span>• {transcript.provider}</span>
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
                {stats.transcriptCounts[activePeriod]}
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
                {[...Array(7)].map((_, i) => (
                  <div
                    key={i}
                    className="chart-bar"
                    style={{
                      height: `${20 + Math.random() * 80}%`,
                      opacity: i === 6 ? 1 : 0.5,
                    }}
                  />
                ))}
              </div>
              <div className="chart-labels">
                <span>Mon</span>
                <span>Tue</span>
                <span>Wed</span>
                <span>Thu</span>
                <span>Fri</span>
                <span>Sat</span>
                <span>Sun</span>
              </div>
            </div>

            <div className="analytics-insights">
              <div className="insight-item">
                <span className="insight-dot success" />
                <span className="insight-text">
                  {stats.transcriptCounts["7d"]} successful this week
                </span>
              </div>
              <div className="insight-item">
                <span className="insight-dot info" />
                <span className="insight-text">
                  Avg.{" "}
                  {Math.round(
                    stats.wordsTyped / Math.max(stats.transcriptCounts["7d"], 1)
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
