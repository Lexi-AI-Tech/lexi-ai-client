import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronRight,
  FileText,
  FilePlus,
  MessageCircle,
  Mic,
  MicOff,
  RefreshCw,
  Trash2,
  Video,
} from "lucide-react";
import { useAuthStore } from "../../store/authStore";
import type { Meeting } from "./MeetingsListPage";
import type { SummaryLine } from "./StreamingSummaryDisplay";
import {
  StreamingSummaryDisplay,
  createSummaryLine,
} from "./StreamingSummaryDisplay";
import "../meetings.css";
import "./meetings-list.css";
import "./meeting-detail-product.css";
import { formatLocaleTimeWithSeconds } from "../../lib/dateUtils";
import { useToast } from "../toast/useToast";

/** Gutter (24px) + max Q&A column (480px) — used for slide animation */
const Q_A_RAIL_OUTER_WIDTH_PX = 504;
/** Summary column should keep at least this width; rail outer width = split width − this (capped at 504). */
const SPLIT_MIN_SUMMARY_WIDTH_PX = 260;

const RAIL_PANEL_TRANSITION = {
  duration: 0.68,
  ease: [0.16, 1, 0.3, 1] as const,
};

function summarySeedFromMeeting(m: Meeting | null): string | null {
  if (!m?.summary || typeof m.summary !== "string") return null;
  const t = m.summary.trim();
  return t.length > 0 ? m.summary : null;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const m = window.matchMedia(query);
    const handler = () => setMatches(m.matches);
    m.addEventListener("change", handler);
    setMatches(m.matches);
    return () => m.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

interface TranscriptSegment {
  id: string;
  segment_index: number;
  start_time: string;
  end_time: string;
  text: string;
  message_type: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface MeetingDetailPageProps {
  meetingId: string;
  meeting: Meeting | null;
  onBackToList: () => void;
  onMeetingDeleted: () => void;
  onMeetingsUpdated: (updater: (prev: Meeting[]) => Meeting[]) => void;
  /** When this meeting is the one being recorded */
  isThisMeetingRecording: boolean;
  /** Live transcript segments (only when isThisMeetingRecording) */
  liveSegments: TranscriptSegment[];
  /** Append a segment to live transcript (e.g. when adding a note during recording) */
  onLiveSegmentAdded?: (segment: TranscriptSegment) => void;
  /** When tray triggers end meeting */
  triggerEndMeetingFromTray?: boolean;
  onEndMeetingFromTrayConsumed?: () => void;
  /** Opened from a global flow after Rust ended the session; generate summary once transcript is loaded */
  runSummaryAfterExternalEnd?: boolean;
  onRunSummaryAfterExternalEndConsumed?: () => void;
  /** Called when recording is stopped (so parent can clear recording state) */
  onRecordingStopped?: () => void;
  /** Called when recording is started (e.g. Resume) so parent can set recordingMeetingId and show live segments */
  onRecordingStarted?: (meetingId: string) => void;
  /** When set, the detail page opens on this tab (e.g. "summary" when coming from list "View details"). */
  initialTab?: "transcript" | "summary";
}

export const MeetingDetailPage: React.FC<MeetingDetailPageProps> = ({
  meetingId,
  meeting,
  onBackToList: _onBackToList,
  onMeetingDeleted,
  onMeetingsUpdated,
  isThisMeetingRecording,
  liveSegments,
  onLiveSegmentAdded,
  triggerEndMeetingFromTray,
  onEndMeetingFromTrayConsumed,
  runSummaryAfterExternalEnd,
  onRunSummaryAfterExternalEndConsumed,
  onRecordingStopped,
  onRecordingStarted,
  initialTab,
}) => {
  useAuthStore();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<"transcript" | "summary">(
    initialTab ?? "transcript",
  );
  const [fetchedSegments, setFetchedSegments] = useState<TranscriptSegment[]>(
    [],
  );
  const [activeSummary, setActiveSummary] = useState<string | null>(() =>
    summarySeedFromMeeting(meeting),
  );
  const [streamingLines, setStreamingLines] = useState<SummaryLine[]>([]);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryStreamError, setSummaryStreamError] = useState<string | null>(
    null,
  );
  /** False once get_meeting_details finishes for this meeting; avoids "Generate" flash before we know server state. */
  const [isMeetingDetailsLoading, setIsMeetingDetailsLoading] = useState(
    () => !summarySeedFromMeeting(meeting),
  );
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [isInitializingMeeting, setIsInitializingMeeting] = useState(false);
  const [showCreateDocModal, setShowCreateDocModal] = useState(false);
  const [docInstructionsInput, setDocInstructionsInput] = useState("");
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[] | null>(
    null,
  );
  const [isLoadingSuggestedQuestions, setIsLoadingSuggestedQuestions] =
    useState(false);
  /** Q&A rail on Summary tab: open by default; user can collapse to focus on notes */
  const [isChatRailOpen, setIsChatRailOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const streamingForMeetingIdRef = useRef<string | null>(null);
  /** When true, suggested questions are being fetched in the stream-done handler; useEffect should skip to avoid double fetch */
  const suggestedQuestionsFetchedByStreamRef = useRef(false);

  /** Server-backed lifecycle (draft | live | paused | ended); drives Pause/End visibility */
  const [sessionStatus, setSessionStatus] = useState<string>(
    () => meeting?.status ?? "draft",
  );

  const DEFAULT_SUGGESTED_QUESTIONS = [
    "What were the action items?",
    "Summarize key decisions",
    "Who is responsible for follow-ups?",
    "Any risks or blockers mentioned?",
  ];

  const segments = isThisMeetingRecording
    ? [...fetchedSegments, ...liveSegments]
    : fetchedSegments;

  const summaryLines = useMemo(() => {
    if (streamingLines.length > 0) return streamingLines;
    if (!activeSummary) return [];
    return activeSummary
      .split("\n")
      .map((raw, i) => createSummaryLine(raw, i))
      .filter((l) => l.type !== "empty");
  }, [streamingLines, activeSummary]);

  const fetchMeetingDetails = useCallback(async () => {
    if (!meetingId) return;
    try {
      const details = await invoke<{
        transcripts?: TranscriptSegment[];
        summary?: string | null;
        status?: string;
      }>("get_meeting_details", { meetingId });
      setFetchedSegments(details.transcripts ?? []);
      setActiveSummary(details.summary ?? null);
      if (typeof details.status === "string" && details.status.length > 0) {
        setSessionStatus(details.status);
      }
    } catch (error) {
      console.error("Failed to fetch meeting details:", error);
      setFetchedSegments([]);
    } finally {
      setIsMeetingDetailsLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    fetchMeetingDetails();
  }, [fetchMeetingDetails]);

  useLayoutEffect(() => {
    const seed = summarySeedFromMeeting(meeting);
    setActiveSummary(seed);
    setFetchedSegments([]);
    setStreamingLines([]);
    setIsGeneratingSummary(false);
    streamingForMeetingIdRef.current = null;
    setIsMeetingDetailsLoading(!seed);
    setSessionStatus(meeting?.status ?? "draft");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed per meetingId; meeting is list row for this id
  }, [meetingId]);

  // When recording stops, refetch so we show the latest saved transcripts (they were saved by the server during the stream)
  const wasRecordingRef = useRef(isThisMeetingRecording);
  useEffect(() => {
    if (wasRecordingRef.current && !isThisMeetingRecording) {
      fetchMeetingDetails();
    }
    wasRecordingRef.current = isThisMeetingRecording;
  }, [isThisMeetingRecording, fetchMeetingDetails]);

  useEffect(() => {
    setSuggestedQuestions(null);
  }, [meetingId]);

  useEffect(() => {
    setIsChatRailOpen(true);
  }, [meetingId]);

  useEffect(() => {
    if (!meetingId || !activeSummary?.trim() || suggestedQuestions !== null)
      return;
    if (suggestedQuestionsFetchedByStreamRef.current) {
      suggestedQuestionsFetchedByStreamRef.current = false;
      return;
    }
    let cancelled = false;
    setIsLoadingSuggestedQuestions(true);
    (async () => {
      try {
        const questions = await invoke<string[]>(
          "get_meeting_suggested_questions",
          {
            meetingId,
          },
        );
        if (!cancelled)
          setSuggestedQuestions(Array.isArray(questions) ? questions : []);
      } catch {
        if (!cancelled) setSuggestedQuestions([]);
      } finally {
        if (!cancelled) setIsLoadingSuggestedQuestions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId, activeSummary, suggestedQuestions]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, isSendingChat]);

  useEffect(() => {
    if (!triggerEndMeetingFromTray) return;
    setActiveTab("summary");
    setShowEndConfirm(true);
    onEndMeetingFromTrayConsumed?.();
  }, [triggerEndMeetingFromTray, onEndMeetingFromTrayConsumed]);

  // Listen for streaming summary events from Rust backend
  useEffect(() => {
    const unlisten = (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<{ line?: string; done?: boolean; error?: string }>(
        "meeting-summary-stream",
        (event) => {
          const payload = event.payload;
          if (streamingForMeetingIdRef.current !== meetingId) return;
          if (payload.error) {
            console.error("Meeting summary stream error:", payload.error);
            streamingForMeetingIdRef.current = null;
            setIsGeneratingSummary(false);
            // Discard partial stream; keep prior `activeSummary` (if any).
            setStreamingLines([]);
            setSummaryStreamError(
              payload.error ||
                "Failed to generate meeting summary. Please try again.",
            );
            toast.error(payload.error);
            return;
          }
          if (payload.done) {
            suggestedQuestionsFetchedByStreamRef.current = true;
            setSummaryStreamError(null);
            setStreamingLines((prev) => {
              const full = prev.map((l) => l.raw).join("\n");
              setActiveSummary(full || null);
              if (full && meeting) {
                onMeetingsUpdated((p) =>
                  p.map((m) =>
                    m.id === meetingId ? { ...m, summary: full } : m,
                  ),
                );
              }
              streamingForMeetingIdRef.current = null;
              setIsGeneratingSummary(false);
              // Keep `streamingLines` as the rendered source of truth so the UI
              // doesn't "jump" from streaming → full re-render on completion.
              return prev;
            });
            // Refresh meeting details (including AI title updates) and suggested
            // questions in parallel to reduce post-stream latency.
            setIsLoadingSuggestedQuestions(true);
            void (async () => {
              const [detailsResult, suggestedQuestionsResult] =
                await Promise.allSettled([
                  invoke<{
                    name?: string | null;
                    summary?: string | null;
                    status?: string;
                  }>("get_meeting_details", { meetingId }),
                  invoke<string[]>("get_meeting_suggested_questions", {
                    meetingId,
                  }),
                ]);

              if (detailsResult.status === "fulfilled") {
                const details = detailsResult.value;
                const serverName =
                  typeof details?.name === "string" ? details.name : null;
                const serverSummary =
                  typeof details?.summary === "string" ? details.summary : null;
                const serverStatus =
                  typeof details?.status === "string" ? details.status : null;
                if (serverStatus) setSessionStatus(serverStatus);
                onMeetingsUpdated((p) =>
                  p.map((m) =>
                    m.id === meetingId
                      ? {
                          ...m,
                          ...(serverName ? { name: serverName } : {}),
                          ...(serverSummary ? { summary: serverSummary } : {}),
                          ...(serverStatus ? { status: serverStatus } : {}),
                        }
                      : m,
                  ),
                );
              }

              if (suggestedQuestionsResult.status === "fulfilled") {
                const q = suggestedQuestionsResult.value;
                setSuggestedQuestions(Array.isArray(q) ? q : []);
              } else {
                setSuggestedQuestions([]);
              }

              setIsLoadingSuggestedQuestions(false);
            })();
            return;
          }
          if (payload.line) {
            setStreamingLines((prev) => [
              ...prev,
              createSummaryLine(payload.line!, prev.length),
            ]);
          }
        },
      );
    })();
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [meetingId, meeting, onMeetingsUpdated]);

  const startRecording = async () => {
    if (sessionStatus === "ended") {
      toast.error("This meeting has ended. You can’t resume recording.");
      return;
    }
    setIsInitializingMeeting(true);
    try {
      await invoke("start_meeting_recording", { meetingId });
      onRecordingStarted?.(meetingId);
      await fetchMeetingDetails();
    } catch (error) {
      console.error("Failed to start meeting recording:", error);
      toast.error(error);
    } finally {
      setIsInitializingMeeting(false);
    }
  };

  const stopRecording = async () => {
    try {
      await invoke("stop_meeting_recording", { meetingId });
      onRecordingStopped?.();
    } catch (error) {
      console.error("Failed to stop meeting recording:", error);
      toast.error(error);
    }
  };

  const handleGenerateSummary = async (regenerate = false) => {
    if (!meetingId || isGeneratingSummary) return;
    // Prevent confusing server/proxy errors when there is nothing to summarize yet.
    // (e.g. meeting exists but no transcript segments were captured/saved)
    if (segments.length === 0) {
      toast.error(
        "No transcript yet. Record the meeting (or add note) before generating a summary.",
      );
      return;
    }
    setIsGeneratingSummary(true);
    setSummaryStreamError(null);
    setStreamingLines([]);
    setSuggestedQuestions(null);
    setIsLoadingSuggestedQuestions(true);
    streamingForMeetingIdRef.current = meetingId;
    try {
      await invoke("stream_meeting_summary", {
        meetingId,
        regenerate,
      });
    } catch (error) {
      console.error("Failed to generate meeting summary:", error);
      streamingForMeetingIdRef.current = null;
      setIsGeneratingSummary(false);
      const msg = error instanceof Error ? error.message : String(error);
      // Don't keep partially streamed content on failure.
      setStreamingLines([]);
      setSummaryStreamError(
        msg || "Failed to generate meeting summary. Please try again.",
      );
      toast.error(msg);
    } finally {
      // Don't flip `isGeneratingSummary` here.
      // We rely on the `meeting-summary-stream` { done: true } event so the UI
      // doesn't enter a brief "done but still rendering" state.
    }
  };

  const handleCreateDocFromSummary = () => {
    const instructions = docInstructionsInput.trim();
    if (!meetingId || !instructions) return;
    setShowCreateDocModal(false);
    const instr = instructions;
    setDocInstructionsInput("");
    window.dispatchEvent(
      new CustomEvent("lexi-start-meeting-doc-generation", {
        detail: {
          requestId: crypto.randomUUID(),
          meetingId,
          instructions: instr,
        },
      }),
    );
  };

  const handleSendChatMessage = async (
    e?: React.FormEvent,
    contentOverride?: string,
  ) => {
    if (e) e.preventDefault();
    const text = (contentOverride != null ? contentOverride : chatInput).trim();
    if (!text || !meetingId || isSendingChat) return;
    const tempId = Math.random().toString();
    const newMessage: ChatMessage = {
      id: tempId,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, newMessage]);
    setChatInput("");
    setIsSendingChat(true);
    try {
      const apiHistory = chatMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));
      const raw = await invoke<{
        id?: string;
        role?: string;
        content?: string;
        created_at?: string;
      }>("send_meeting_chat", {
        meetingId,
        content: text,
        history: apiHistory,
      });
      const assistantMessage: ChatMessage = {
        id: raw?.id ?? crypto.randomUUID(),
        role: "assistant",
        content:
          typeof raw?.content === "string"
            ? raw.content
            : String(raw?.content ?? ""),
        created_at:
          typeof raw?.created_at === "string"
            ? raw.created_at
            : new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Failed to send meeting chat:", error);
      const errorText = error instanceof Error ? error.message : String(error);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `err-${tempId}`,
          role: "assistant" as const,
          content: `Unable to get a response. ${errorText || "Please try again."}`,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsSendingChat(false);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = noteInput.trim();
    if (!meetingId || !text || isAddingNote) return;
    setIsAddingNote(true);
    try {
      const segment = await invoke<TranscriptSegment>("add_meeting_note", {
        meetingId,
        text,
      });
      if (isThisMeetingRecording && onLiveSegmentAdded) {
        onLiveSegmentAdded(segment);
      } else {
        setFetchedSegments((prev) => [...prev, segment]);
      }
      setNoteInput("");
      if (scrollRef.current)
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    } catch (error) {
      console.error("Failed to add meeting note:", error);
      toast.error(error);
    } finally {
      setIsAddingNote(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmId) return;
    setDeletingId(deleteConfirmId);
    try {
      await invoke("delete_meeting", { meetingId: deleteConfirmId });
      onMeetingDeleted();
      setDeleteConfirmId(null);
    } catch (error) {
      console.error("Failed to delete meeting:", error);
      toast.error(error);
    } finally {
      setDeletingId(null);
    }
  };

  const handleEndMeeting = async () => {
    setIsEnding(true);
    try {
      const updated = await invoke<Meeting>("end_meeting_session", {
        meetingId,
      });
      setSessionStatus(updated.status ?? "ended");
      onMeetingsUpdated((prev) =>
        prev.map((m) =>
          m.id === meetingId
            ? {
                ...m,
                status: updated.status,
                name: updated.name,
                summary: updated.summary ?? m.summary,
              }
            : m,
        ),
      );
      if (isThisMeetingRecording) onRecordingStopped?.();
      setShowEndConfirm(false);
      setActiveTab("summary");
      await handleGenerateSummary(false);
    } catch (error) {
      console.error("Failed to end meeting:", error);
      toast.error(error);
    } finally {
      setIsEnding(false);
    }
  };

  const externalSummaryRanRef = useRef(false);
  useEffect(() => {
    if (!runSummaryAfterExternalEnd) {
      externalSummaryRanRef.current = false;
      return;
    }
    if (segments.length === 0 || externalSummaryRanRef.current) return;
    externalSummaryRanRef.current = true;
    setActiveTab("summary");
    void (async () => {
      try {
        await handleGenerateSummary(false);
      } finally {
        onRunSummaryAfterExternalEndConsumed?.();
      }
    })();
  }, [
    runSummaryAfterExternalEnd,
    segments.length,
    meetingId,
    onRunSummaryAfterExternalEndConsumed,
  ]);

  const PAGE_VARIANTS = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.06, delayChildren: 0.1 },
    },
  };

  const SECTION_VARIANTS = {
    hidden: { opacity: 0, y: 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.5, ease: [0.22, 0.61, 0.36, 1] as const },
    },
  };

  const hasSummaryContent = activeSummary || isGeneratingSummary;
  const showSummaryChatRail = hasSummaryContent && isChatRailOpen;
  /** Server returned no suggested questions (e.g. no transcripts); show alternate copy instead of placeholder chips. */
  const noSuggestedQuestionsFromServer =
    suggestedQuestions !== null &&
    suggestedQuestions.length === 0 &&
    !isLoadingSuggestedQuestions;
  const isNarrowSplit = useMediaQuery("(max-width: 900px)");
  const summarySplitRef = useRef<HTMLDivElement>(null);
  const [railOuterWidthPx, setRailOuterWidthPx] = useState(
    Q_A_RAIL_OUTER_WIDTH_PX,
  );

  useLayoutEffect(() => {
    if (activeTab !== "summary") return;
    const el = summarySplitRef.current;
    if (!el) return;
    const update = () => {
      const w = el.getBoundingClientRect().width;
      const inner = Math.max(0, Math.floor(w - SPLIT_MIN_SUMMARY_WIDTH_PX));
      const cap = Math.min(Q_A_RAIL_OUTER_WIDTH_PX, inner);
      setRailOuterWidthPx(Number.isFinite(cap) ? cap : Q_A_RAIL_OUTER_WIDTH_PX);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeTab, hasSummaryContent]);

  const chatInputForm = (
    <form
      onSubmit={handleSendChatMessage}
      className="meeting-detail-rail__form"
    >
      <input
        type="text"
        className="meeting-detail-rail__input"
        value={chatInput}
        onChange={(e) => setChatInput(e.target.value)}
        placeholder="Ask a question..."
        disabled={isSendingChat || isThisMeetingRecording}
      />
      <button
        type="submit"
        className="meeting-detail-btn meeting-detail-btn--primary meeting-detail-rail__submit"
        disabled={isSendingChat || !chatInput.trim() || isThisMeetingRecording}
      >
        Send
      </button>
    </form>
  );

  return (
    <motion.div
      className="meeting-detail-product"
      initial="hidden"
      animate="visible"
      variants={PAGE_VARIANTS}
    >
      {/* Toolbar */}
      <motion.div
        className="meeting-detail-toolbar"
        variants={SECTION_VARIANTS}
      >
        <div className="meeting-detail-toolbar__left">
          <div className="meeting-detail-tabs">
            <button
              type="button"
              className={`meeting-detail-tabs__btn ${activeTab === "summary" ? "meeting-detail-tabs__btn--active" : ""}`}
              onClick={() => setActiveTab("summary")}
              disabled={isThisMeetingRecording}
            >
              <FileText
                size={16}
                style={{ marginRight: 6, verticalAlign: -3 }}
              />
              Summary
            </button>
            <button
              type="button"
              className={`meeting-detail-tabs__btn ${activeTab === "transcript" ? "meeting-detail-tabs__btn--active" : ""}`}
              onClick={() => setActiveTab("transcript")}
            >
              <Mic size={16} style={{ marginRight: 6, verticalAlign: -3 }} />
              Transcript
            </button>
          </div>
          {sessionStatus !== "ended" && !isInitializingMeeting && (
            <div className="meeting-detail-controls">
              <button
                type="button"
                className={`meeting-detail-controls__btn meeting-detail-controls__btn--resume ${isThisMeetingRecording ? "meeting-detail-controls__btn--recording" : ""}`}
                onClick={() =>
                  isThisMeetingRecording ? stopRecording() : startRecording()
                }
              >
                {isThisMeetingRecording ? (
                  <>
                    <MicOff
                      size={14}
                      style={{ marginRight: 6, verticalAlign: -2 }}
                    />
                    Pause
                  </>
                ) : (
                  <>
                    <Mic
                      size={14}
                      style={{ marginRight: 6, verticalAlign: -2 }}
                    />
                    Resume
                  </>
                )}
              </button>
              <button
                type="button"
                className="meeting-detail-controls__btn meeting-detail-controls__btn--end"
                onClick={() => setShowEndConfirm(true)}
              >
                End
              </button>
            </div>
          )}
        </div>
        <div className="meeting-detail-toolbar__right">
          <button
            type="button"
            className="meeting-detail-toolbar__delete"
            onClick={() => setDeleteConfirmId(meetingId)}
            disabled={!!deletingId}
            title="Delete meeting"
          >
            <Trash2 size={18} strokeWidth={1.5} />
          </button>
        </div>
      </motion.div>

      {/* Content */}
      <div className="meeting-detail-content">
        <AnimatePresence mode="wait">
          {activeTab === "transcript" && (
            <motion.div
              key="transcript"
              className="meeting-detail-transcript"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{
                duration: 0.3,
                ease: [0.22, 0.61, 0.36, 1] as const,
              }}
            >
              <div
                ref={scrollRef}
                className="meeting-detail-transcript__scroll"
              >
                {isInitializingMeeting ? (
                  <div className="meeting-detail-transcript__initializing">
                    <div className="meeting-detail-transcript__initializing-spinner" />
                    <p className="meeting-detail-transcript__initializing-text">
                      Getting ready…
                    </p>
                  </div>
                ) : segments.length === 0 ? (
                  <p className="meeting-detail-transcript__empty">
                    {isThisMeetingRecording
                      ? "Listening for speech..."
                      : "Click Resume to start capturing."}
                  </p>
                ) : null}
                {segments.map((seg, idx) => {
                  const timeString = seg.start_time
                    ? formatLocaleTimeWithSeconds(seg.start_time)
                    : "00:00:00";
                  const msgType = seg.message_type;
                  const isUser =
                    msgType === "user_audio" || msgType === "user_note";
                  const isSystem = msgType === "system_audio";
                  const segmentAlign = isUser
                    ? "user"
                    : isSystem
                      ? "system"
                      : "unknown";
                  const bubbleVariant = isUser
                    ? "user"
                    : isSystem
                      ? "system"
                      : "unknown";
                  return (
                    <div
                      key={seg.id ?? idx}
                      className={`meeting-detail-transcript__segment meeting-detail-transcript__segment--${segmentAlign}`}
                    >
                      <div className="meeting-detail-transcript__block">
                        <div
                          className={`meeting-detail-transcript__bubble meeting-detail-transcript__bubble--${bubbleVariant}`}
                        >
                          <span>{seg.text}</span>
                        </div>
                        <span className="meeting-detail-transcript__time-subtitle">
                          {timeString}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <form
                onSubmit={handleAddNote}
                className="meeting-detail-transcript-notes"
              >
                <input
                  type="text"
                  className="meeting-detail-transcript-notes__input"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Add a note..."
                  disabled={isAddingNote || !meetingId || isInitializingMeeting}
                />
                <button
                  type="submit"
                  className="meeting-detail-btn meeting-detail-btn--primary"
                  disabled={
                    isAddingNote ||
                    !noteInput.trim() ||
                    !meetingId ||
                    isInitializingMeeting
                  }
                >
                  {isAddingNote ? "Adding…" : "Add note"}
                </button>
              </form>
            </motion.div>
          )}

          {activeTab === "summary" && (
            <motion.div
              key="summary"
              ref={summarySplitRef}
              className="meeting-detail-split"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{
                duration: 0.3,
                ease: [0.22, 0.61, 0.36, 1] as const,
              }}
            >
              <div className="meeting-detail-main">
                <div className="meeting-detail-card meeting-detail-summary-panel">
                  <div className="meeting-detail-summary-panel__header">
                    <h3 className="meeting-detail-summary-panel__title">
                      AI Summary
                    </h3>
                    <div className="meeting-detail-summary-panel__actions">
                      {hasSummaryContent && !isChatRailOpen && (
                        <motion.button
                          type="button"
                          className="meeting-detail-btn meeting-detail-btn--secondary"
                          onClick={() => setIsChatRailOpen(true)}
                          title="Show Q&A"
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{
                            duration: 0.25,
                            ease: [0.16, 1, 0.3, 1],
                          }}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.97 }}
                        >
                          <MessageCircle
                            size={14}
                            className="meeting-detail-btn__icon"
                            aria-hidden
                          />
                          Q&A
                        </motion.button>
                      )}
                      {activeSummary && (
                        <button
                          type="button"
                          className="meeting-detail-btn meeting-detail-btn--secondary"
                          onClick={() => {
                            if (segments.length === 0) {
                              toast.error(
                                "No transcript yet. Record the meeting (or add a note) before creating a doc.",
                              );
                              return;
                            }
                            setShowCreateDocModal(true);
                          }}
                          title="Create a document from this meeting"
                        >
                          <FilePlus
                            size={14}
                            className="meeting-detail-btn__icon"
                            aria-hidden
                          />
                          Create doc
                        </button>
                      )}
                      {(activeSummary || isGeneratingSummary) && (
                        <button
                          type="button"
                          className="meeting-detail-btn meeting-detail-btn--secondary"
                          onClick={() => handleGenerateSummary(true)}
                          disabled={!meetingId || isGeneratingSummary}
                          title="Generate a new summary"
                        >
                          <RefreshCw
                            size={14}
                            className={`meeting-detail-btn__icon ${isGeneratingSummary ? "meeting-detail-btn__icon--spin" : ""}`}
                            aria-hidden
                          />
                          {isGeneratingSummary ? "Generating…" : "Regenerate"}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="meeting-detail-summary-panel__body">
                    {summaryLines.length > 0 ? (
                      <StreamingSummaryDisplay
                        lines={summaryLines}
                        isStreaming={isGeneratingSummary}
                        className="meetings-summary-body"
                      />
                    ) : isMeetingDetailsLoading && !isGeneratingSummary ? (
                      <div
                        className="meeting-detail-summary-loading"
                        aria-busy="true"
                        aria-label="Loading summary"
                      >
                        <div
                          className="meetings-list-page__skeleton-line meetings-list-page__skeleton-line--lg meeting-detail-summary-loading__line"
                          aria-hidden
                        />
                        <div
                          className="meetings-list-page__skeleton-line meetings-list-page__skeleton-line--md meeting-detail-summary-loading__line"
                          aria-hidden
                        />
                        <div
                          className="meetings-list-page__skeleton-line meetings-list-page__skeleton-line--lg meeting-detail-summary-loading__line"
                          aria-hidden
                        />
                        <div
                          className="meetings-list-page__skeleton-line meetings-list-page__skeleton-line--md meeting-detail-summary-loading__line"
                          style={{ width: "72%" }}
                          aria-hidden
                        />
                      </div>
                    ) : summaryStreamError && !isGeneratingSummary ? (
                      <div className="meeting-detail-empty-state">
                        <h4 className="meeting-detail-empty-state__title">
                          Failed to generate summary
                        </h4>
                        <p className="meeting-detail-empty-state__hint">
                          {summaryStreamError}
                        </p>
                        <button
                          type="button"
                          className="meeting-detail-empty-state__btn"
                          onClick={() => handleGenerateSummary(false)}
                          disabled={!meetingId || isGeneratingSummary}
                        >
                          Try again
                        </button>
                      </div>
                    ) : (
                      <div className="meeting-detail-empty-state">
                        <div className="meeting-detail-empty-state__icon">
                          <Video
                            size={28}
                            strokeWidth={1.75}
                            className="meeting-detail-empty-state__icon-svg"
                            aria-hidden
                          />
                        </div>
                        <h4 className="meeting-detail-empty-state__title">
                          Generate AI Summary
                        </h4>
                        <p className="meeting-detail-empty-state__hint">
                          Transform your transcript into a structured summary
                          with key topics, decisions, and action items.
                        </p>
                        <button
                          type="button"
                          className="meeting-detail-empty-state__btn"
                          onClick={() => handleGenerateSummary(false)}
                          disabled={!meetingId || isGeneratingSummary}
                        >
                          {isGeneratingSummary
                            ? "Generating…"
                            : "Generate summary"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {hasSummaryContent && (
                <motion.div
                  className="meeting-detail-split__rail-host"
                  initial={false}
                  animate={
                    isNarrowSplit
                      ? {
                          maxHeight: showSummaryChatRail ? 9999 : 0,
                          opacity: showSummaryChatRail ? 1 : 0,
                          width: "100%",
                        }
                      : {
                          width: showSummaryChatRail ? railOuterWidthPx : 0,
                          opacity: 1,
                        }
                  }
                  transition={
                    isNarrowSplit
                      ? {
                          maxHeight: RAIL_PANEL_TRANSITION,
                          opacity: { duration: 0.42, ease: [0.16, 1, 0.3, 1] },
                        }
                      : {
                          width: RAIL_PANEL_TRANSITION,
                          opacity: { duration: 0.2 },
                        }
                  }
                  style={{
                    overflow: "hidden",
                    flexShrink: 0,
                    pointerEvents: showSummaryChatRail ? "auto" : "none",
                  }}
                >
                  <motion.div
                    className="meeting-detail-split__rail-bundle"
                    style={{
                      width: isNarrowSplit ? "100%" : railOuterWidthPx,
                      minWidth: isNarrowSplit ? 0 : railOuterWidthPx,
                      boxSizing: "border-box",
                    }}
                    initial={false}
                    animate={{
                      x: isNarrowSplit
                        ? 0
                        : showSummaryChatRail
                          ? 0
                          : Math.min(18, railOuterWidthPx * 0.04),
                    }}
                    transition={RAIL_PANEL_TRANSITION}
                  >
                    <div
                      className="meeting-detail-split__gutter"
                      role="separator"
                      aria-orientation={
                        isNarrowSplit ? "horizontal" : "vertical"
                      }
                    >
                      <motion.button
                        type="button"
                        className="meeting-detail-split__divider-btn"
                        onClick={() => setIsChatRailOpen(false)}
                        title="Collapse Q&A"
                        aria-label="Collapse Q&A"
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: 0.9 }}
                        transition={{
                          type: "spring",
                          stiffness: 500,
                          damping: 28,
                        }}
                      >
                        <ChevronRight size={14} strokeWidth={2} />
                      </motion.button>
                    </div>
                    <aside className="meeting-detail-rail">
                      <div className="meeting-detail-rail__header">
                        <span className="meeting-detail-rail__label">
                          <MessageCircle
                            size={12}
                            style={{ verticalAlign: -2, marginRight: 4 }}
                          />
                          Q&A
                        </span>
                        <p className="meeting-detail-rail__hint">
                          Ask about this meeting. Use suggested questions or
                          type your own.
                        </p>
                      </div>
                      <div className="meeting-detail-rail__section">
                        <div className="meeting-detail-rail__section-title">
                          Suggested questions
                        </div>
                        {isLoadingSuggestedQuestions ? (
                          <p className="meeting-detail-rail__suggestions-loading">
                            <span
                              className="skeleton-block app-page-subtitle-skeleton"
                              style={{
                                width: 170,
                                height: 12,
                                borderRadius: 10,
                              }}
                            />
                          </p>
                        ) : noSuggestedQuestionsFromServer ? (
                          <p className="meeting-detail-rail__suggestions-empty">
                            Could not suggest questions due to missing
                            transcripts. Add a transcript by recording or
                            capturing this meeting.
                          </p>
                        ) : (
                          (suggestedQuestions && suggestedQuestions.length > 0
                            ? suggestedQuestions
                            : DEFAULT_SUGGESTED_QUESTIONS
                          ).map((q) => (
                            <button
                              key={q}
                              type="button"
                              className="meeting-detail-rail__chip"
                              onClick={() =>
                                handleSendChatMessage(undefined, q)
                              }
                              disabled={
                                !activeSummary ||
                                isSendingChat ||
                                isThisMeetingRecording
                              }
                            >
                              {q}
                            </button>
                          ))
                        )}
                      </div>
                      <div className="meeting-detail-rail__section meeting-detail-rail__section--conversation">
                        <div className="meeting-detail-rail__section-title">
                          Conversation
                        </div>
                        {chatMessages.length === 0 && !isSendingChat ? (
                          <div className="meeting-detail-rail__empty-with-form">
                            <p className="meeting-detail-rail__empty">
                              Your questions and answers appear here.
                            </p>
                            {chatInputForm}
                          </div>
                        ) : (
                          <>
                            <div
                              ref={chatScrollRef}
                              className="meeting-detail-rail__messages"
                            >
                              {chatMessages.map((msg) => (
                                <div
                                  key={msg.id}
                                  className={`meeting-detail-rail__msg meeting-detail-rail__msg--${msg.role}`}
                                >
                                  <div className="meeting-detail-rail__msg-body">
                                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                                  </div>
                                </div>
                              ))}
                              {isSendingChat && (
                                <div className="meeting-detail-rail__msg meeting-detail-rail__msg--assistant meeting-detail-rail__msg--loading">
                                  <span
                                    className="meeting-detail-rail__loading-spinner"
                                    aria-hidden
                                  />
                                </div>
                              )}
                            </div>
                            {chatInputForm}
                          </>
                        )}
                      </div>
                    </aside>
                  </motion.div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {deleteConfirmId
        ? createPortal(
            <div
              className="delete-modal-overlay"
              onClick={() => !deletingId && setDeleteConfirmId(null)}
            >
              <div
                className="delete-modal-content"
                onClick={(e) => e.stopPropagation()}
              >
                <h3>Delete meeting?</h3>
                <p>
                  This action cannot be undone. The meeting and its entire
                  transcript will be permanently removed.
                </p>
                <div className="delete-modal-actions">
                  <button
                    type="button"
                    className="delete-modal-btn-cancel"
                    onClick={() => setDeleteConfirmId(null)}
                    disabled={!!deletingId}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="delete-modal-btn-delete"
                    onClick={handleConfirmDelete}
                    disabled={!!deletingId}
                  >
                    {deletingId ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {showEndConfirm
        ? createPortal(
            <div
              className="delete-modal-overlay"
              onClick={() => !isEnding && setShowEndConfirm(false)}
            >
              <div
                className="delete-modal-content"
                onClick={(e) => e.stopPropagation()}
              >
                <h3>End meeting?</h3>
                <p>
                  The transcript will be finalized and a summary will be
                  generated. You won't be able to resume recording after this.
                </p>
                <div className="delete-modal-actions">
                  <button
                    type="button"
                    className="delete-modal-btn-cancel"
                    onClick={() => setShowEndConfirm(false)}
                    disabled={isEnding}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="delete-modal-btn-delete"
                    onClick={handleEndMeeting}
                    disabled={isEnding}
                  >
                    {isEnding ? "Ending..." : "End Meeting"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {showCreateDocModal
        ? createPortal(
            <div
              className="delete-modal-overlay"
              onClick={() => setShowCreateDocModal(false)}
            >
              <div
                className="delete-modal-content meetings-create-doc-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <h3>Create document from this meeting</h3>
                <p>
                  Describe what you want to extract. The AI will suggest a
                  document title and generate structured content from the
                  meeting.
                </p>
                <label className="meetings-create-doc-label">
                  What would you like to get out of this meeting?
                </label>
                <textarea
                  className="meetings-create-doc-textarea"
                  placeholder="e.g. Extract key decisions and action items. Include who is responsible for each task and any deadlines mentioned."
                  value={docInstructionsInput}
                  onChange={(e) => setDocInstructionsInput(e.target.value)}
                  rows={4}
                />
                <div className="delete-modal-actions">
                  <button
                    type="button"
                    className="delete-modal-btn-cancel"
                    onClick={() => setShowCreateDocModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="delete-modal-btn-delete"
                    onClick={handleCreateDocFromSummary}
                    disabled={!docInstructionsInput.trim()}
                  >
                    Create
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </motion.div>
  );
};
