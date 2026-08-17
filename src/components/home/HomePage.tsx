/**
 * HomePage Component
 *
 * Onboarding + feature-spotlight surface: greeting, a use-case-grounded nudge
 * pulled from the same LLM insights that power Analytics, and cards teaching
 * each core feature — the pain point it solves and how to use it. Deep usage
 * breakdowns live on the Analytics page; plan/billing usage lives on the
 * dedicated Usage page.
 */

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Atom,
  BookText,
  FileText,
  Gauge,
  Mic,
  NotebookPen,
  Sparkles,
  Video,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../../store/authStore";
import "./home.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InsightsResponse {
  headline: string;
  highlights: string[];
  generated_at: string;
  nudge?: string | null;
  nudge_cta?: string | null;
  nudge_page?: string | null;
}

interface FeatureSpotlight {
  icon: React.ElementType;
  title: string;
  painPoint: string;
  howTo: string;
  page: string;
  cta: string;
}

const NUDGE_PAGES: readonly string[] = [
  "home",
  "meetings",
  "actions",
  "docs",
  "notes",
  "transcripts",
  "shortcuts",
];

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const FEATURE_SPOTLIGHTS: FeatureSpotlight[] = [
  {
    icon: Mic,
    title: "Transcribe",
    painPoint: "Typing slows you down and breaks your train of thought.",
    howTo: "Hold your hotkey anywhere and speak — Lexi types it for you.",
    page: "transcripts",
    cta: "Start transcribing",
  },
  {
    icon: Video,
    title: "Meetings",
    painPoint: "Taking notes in a call means you can't fully listen.",
    howTo: "Start a meeting and Lexi transcribes and summarizes it for you.",
    page: "meetings",
    cta: "Record a meeting",
  },
  {
    icon: Atom,
    title: "Actions",
    painPoint: "Switching to a chat app to ask AI for help breaks your flow.",
    howTo: "Hold the Action hotkey, speak what you need — output lands at your cursor.",
    page: "actions",
    cta: "Run an action",
  },
  {
    icon: FileText,
    title: "Docs",
    painPoint: "Drafting long documents by hand is slow.",
    howTo: "Dictate and let Lexi structure it into a clean document.",
    page: "docs",
    cta: "Create a doc",
  },
  {
    icon: NotebookPen,
    title: "Notes",
    painPoint: "Fleeting ideas get lost if you can't capture them fast.",
    howTo: "Jot voice or text notes in seconds, searchable later.",
    page: "notes",
    cta: "Add a note",
  },
  {
    icon: BookText,
    title: "Vocabulary",
    painPoint: "Names, acronyms, and jargon often get mistranscribed.",
    howTo: "Teach Lexi your custom terms so it recognizes them every time.",
    page: "vocabulary",
    cta: "Add vocabulary",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const FeatureCard: React.FC<{
  spotlight: FeatureSpotlight;
  onClick: () => void;
}> = ({ spotlight, onClick }) => {
  const Icon = spotlight.icon;
  return (
    <motion.button
      className="feature-spotlight-card"
      onClick={onClick}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.2 }}
    >
      <div className="feature-spotlight-card__icon">
        <Icon size={18} />
      </div>
      <h3 className="feature-spotlight-card__title">{spotlight.title}</h3>
      <p className="feature-spotlight-card__pain">{spotlight.painPoint}</p>
      <p className="feature-spotlight-card__howto">{spotlight.howTo}</p>
      <span className="feature-spotlight-card__cta">{spotlight.cta} →</span>
    </motion.button>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface HomePageProps {
  onViewAllTranscripts?: () => void;
  onNavigate?: (page: string) => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onNavigate }) => {
  const { user, isAuthenticated } = useAuthStore();

  const [insights, setInsights] = useState<InsightsResponse | null>(null);

  // Same recency-biased LLM insights that power Analytics — reused here just
  // for the nudge, not the headline/highlights.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await invoke<InsightsResponse>("get_analytics_insights");
        if (!cancelled) setInsights(data);
      } catch (err) {
        console.error("Failed to load home nudge:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const nudgePage =
    insights?.nudge_page && NUDGE_PAGES.includes(insights.nudge_page)
      ? insights.nudge_page
      : null;

  const userName = user?.name?.split(" ")[0] || "there";

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
        {isAuthenticated && (
          <button
            type="button"
            className="home-usage-cta"
            onClick={() => onNavigate?.("usage")}
          >
            <Gauge size={16} />
            <span>View plan usage</span>
          </button>
        )}
      </motion.header>

      {/* ── Nudge ── */}
      {isAuthenticated && insights?.nudge && (
        <motion.section className="home-nudge-card" variants={itemVariants}>
          <div className="home-nudge-card__icon">
            <Sparkles size={18} />
          </div>
          <div className="home-nudge-card__body">
            <p className="home-nudge-card__text">{insights.nudge}</p>
            {insights.nudge_cta && nudgePage && (
              <button
                type="button"
                className="home-nudge-card__cta"
                onClick={() => onNavigate?.(nudgePage)}
              >
                {insights.nudge_cta}
                <ArrowRight size={13} aria-hidden />
              </button>
            )}
          </div>
        </motion.section>
      )}

      {/* ── Feature Spotlights ── */}
      <motion.section className="feature-spotlight-section" variants={itemVariants}>
        <h2 className="section-title">What Lexi can do for you</h2>
        <div className="feature-spotlight-grid">
          {FEATURE_SPOTLIGHTS.map((spotlight) => (
            <FeatureCard
              key={spotlight.title}
              spotlight={spotlight}
              onClick={() => onNavigate?.(spotlight.page)}
            />
          ))}
        </div>
      </motion.section>
    </motion.div>
  );
};
