/**
 * HomePage Component
 *
 * Onboarding + feature-spotlight surface: greeting, a "getting started" checklist
 * built from real usage signals (first transcription/meeting/action/shortcut), and
 * cards teaching each core feature — the pain point it solves and how to use it.
 * Deep usage breakdowns live on the Analytics page; plan/billing usage lives
 * on the dedicated Usage page.
 */

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Atom,
  BookText,
  Check,
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

interface PaginatedTotal {
  total: number;
}

interface ChecklistState {
  hasTranscript: boolean;
  hasMeeting: boolean;
  hasAction: boolean;
  hasShortcut: boolean;
}

interface ChecklistStep {
  id: keyof ChecklistState;
  label: string;
  description: string;
  page: string;
}

interface FeatureSpotlight {
  icon: React.ElementType;
  title: string;
  painPoint: string;
  howTo: string;
  page: string;
  cta: string;
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const CHECKLIST_STEPS: ChecklistStep[] = [
  {
    id: "hasTranscript",
    label: "Try your first transcription",
    description: "Hold your hotkey and speak — text appears wherever your cursor is.",
    page: "transcripts",
  },
  {
    id: "hasMeeting",
    label: "Record a meeting",
    description: "Lexi joins silently and transcribes everyone, live.",
    page: "meetings",
  },
  {
    id: "hasAction",
    label: "Run your first Action",
    description: "Speak an instruction, get AI output right at your cursor.",
    page: "actions",
  },
  {
    id: "hasShortcut",
    label: "Set up a shortcut",
    description: "Bind hotkeys so every feature is one keypress away.",
    page: "shortcuts",
  },
];

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

  const [checklist, setChecklist] = useState<ChecklistState | null>(null);

  // One-time, lightweight existence checks (page_size=1 / small lists) — no
  // polling, no live-refresh listeners. This is onboarding guidance, not a
  // live dashboard; Analytics owns the detailed, continuously-refreshed data.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const [transcripts, actions, meetings, shortcuts] = await Promise.all([
          invoke<PaginatedTotal>("get_transcripts", { page: 1, pageSize: 1 }).catch(
            () => ({ total: 0 }),
          ),
          invoke<PaginatedTotal>("get_action_history", {
            page: 1,
            pageSize: 1,
          }).catch(() => ({ total: 0 })),
          invoke<unknown[]>("list_meetings").catch(() => []),
          invoke<unknown[]>("get_shortcuts").catch(() => []),
        ]);
        if (cancelled) return;
        setChecklist({
          hasTranscript: transcripts.total > 0,
          hasAction: actions.total > 0,
          hasMeeting: meetings.length > 0,
          hasShortcut: shortcuts.length > 0,
        });
      } catch (err) {
        console.error("Failed to load getting-started checklist:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const userName = user?.name?.split(" ")[0] || "there";
  const completedCount = checklist
    ? CHECKLIST_STEPS.filter((s) => checklist[s.id]).length
    : 0;
  const allComplete = checklist != null && completedCount === CHECKLIST_STEPS.length;

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

      {/* ── Getting Started ── */}
      {isAuthenticated && checklist && !allComplete && (
        <motion.section className="getting-started-section" variants={itemVariants}>
          <div className="getting-started-header">
            <h2 className="section-title">Get started with Lexi</h2>
            <span className="getting-started-progress">
              {completedCount}/{CHECKLIST_STEPS.length}
            </span>
          </div>
          <div className="getting-started-track">
            <div
              className="getting-started-track__fill"
              style={{
                width: `${(completedCount / CHECKLIST_STEPS.length) * 100}%`,
              }}
            />
          </div>
          <ul className="getting-started-list">
            {CHECKLIST_STEPS.map((step) => {
              const done = checklist[step.id];
              return (
                <li
                  key={step.id}
                  className={`getting-started-item${done ? " is-done" : ""}`}
                  onClick={() => !done && onNavigate?.(step.page)}
                >
                  <span className="getting-started-item__check">
                    {done && <Check size={12} strokeWidth={3} />}
                  </span>
                  <div className="getting-started-item__text">
                    <span className="getting-started-item__label">
                      {step.label}
                    </span>
                    <span className="getting-started-item__desc">
                      {step.description}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </motion.section>
      )}

      {isAuthenticated && allComplete && (
        <motion.section className="getting-started-done" variants={itemVariants}>
          <Sparkles size={16} />
          <span>
            You've explored every core feature — see how it's paid off on{" "}
            <button
              type="button"
              className="getting-started-done__link"
              onClick={() => onNavigate?.("analytics")}
            >
              Analytics
            </button>{" "}
            or check your{" "}
            <button
              type="button"
              className="getting-started-done__link"
              onClick={() => onNavigate?.("usage")}
            >
              Usage
            </button>
            .
          </span>
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
