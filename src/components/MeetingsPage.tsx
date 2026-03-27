import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft } from "lucide-react";
import { useAuthStore } from "../store/authStore";
import { MeetingsListPage, type Meeting } from "./meetings/MeetingsListPage";
import { MeetingDetailPage } from "./meetings/MeetingDetailPage";
import "./meetings.css";
import { formatAppDateTime } from "../lib/dateUtils";
import { useToast } from "./toast/useToast";

interface TranscriptSegment {
  id: string;
  segment_index: number;
  start_time: string;
  end_time: string;
  text: string;
  message_type: string;
}

interface MeetingsPageProps {
  autoStart?: boolean;
  autoStartPlatform?: string | null;
  onAutoStartConsumed?: () => void;
  /** When a meeting is started from the pill overlay, focus that meeting and show transcript tab. */
  pillMeetingId?: string | null;
  onPillMeetingConsumed?: () => void;
  /** When true, open the end-meeting confirmation modal (e.g. from tray "Stop Meeting"). */
  triggerEndMeetingFromTray?: boolean;
  onEndMeetingFromTrayConsumed?: () => void;
  /** When set, auto-run the full end-meeting flow (no extra confirmation). */
  triggerAutoEndMeetingFromReminderId?: string | null;
  onAutoEndMeetingFromReminderConsumed?: () => void;
  activeRecordingMeetingId?: string | null;
  onRecordingStartedGlobal?: (meetingId: string) => void;
  onRecordingStoppedGlobal?: () => void;
}

export const MeetingsPage: React.FC<MeetingsPageProps> = ({
  autoStart,
  autoStartPlatform,
  onAutoStartConsumed,
  pillMeetingId,
  onPillMeetingConsumed,
  triggerEndMeetingFromTray,
  onEndMeetingFromTrayConsumed,
  triggerAutoEndMeetingFromReminderId,
  onAutoEndMeetingFromReminderConsumed,
  activeRecordingMeetingId = null,
  onRecordingStartedGlobal,
  onRecordingStoppedGlobal,
}) => {
  const { tokens } = useAuthStore();
  const toast = useToast();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isMeetingsLoading, setIsMeetingsLoading] = useState(false);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(
    null,
  );
  const [openToSummaryTab, setOpenToSummaryTab] = useState(false);
  const [recordingMeetingId, setRecordingMeetingId] = useState<string | null>(
    null,
  );
  const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);
  const [isEditingMeetingTitle, setIsEditingMeetingTitle] = useState(false);
  const [meetingTitleDraft, setMeetingTitleDraft] = useState("");
  const [isSavingMeetingTitle, setIsSavingMeetingTitle] = useState(false);
  const skipTitleBlurSaveRef = useRef(false);

  const selectedMeeting = selectedMeetingId
    ? (meetings.find((m) => m.id === selectedMeetingId) ?? null)
    : null;

  const fetchMeetings = useCallback(async () => {
    setIsMeetingsLoading(true);
    try {
      const result = await invoke<Meeting[]>("list_meetings");
      setMeetings(result);
    } catch (error) {
      console.error("Failed to fetch meetings:", error);
    } finally {
      setIsMeetingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tokens?.access_token) {
      fetchMeetings();
    }
  }, [tokens, fetchMeetings]);

  // Keep recording state stable across page unmount/remount by syncing from app-level state.
  useEffect(() => {
    setRecordingMeetingId(activeRecordingMeetingId ?? null);
  }, [activeRecordingMeetingId]);

  // Real-time transcript listener
  useEffect(() => {
    let isMounted = true;
    let unlistenFn: (() => void) | undefined;

    const setupListener = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<TranscriptSegment & { type?: string }>(
        "meeting-transcript",
        (event) => {
          if (!isMounted) return;
          const payload = event.payload;
          const segment: TranscriptSegment = {
            id:
              payload.id ||
              `live-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            segment_index: payload.segment_index ?? 0,
            start_time: payload.start_time ?? "",
            end_time: payload.end_time ?? "",
            text: payload.text ?? "",
            message_type: payload.message_type ?? "user_audio",
          };
          setLiveSegments((prev) => [...prev, segment]);
        },
      );
      unlistenFn = unlisten;
    };

    setupListener();

    return () => {
      isMounted = false;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const handleCreateAndStartMeeting = async () => {
    if (!tokens?.access_token) return;

    try {
      const platform =
        typeof autoStartPlatform === "string" &&
        autoStartPlatform.trim().length > 0
          ? autoStartPlatform
          : "Lexi AI";
      const name =
        platform.trim().length > 0 ? `${platform} Meeting` : "Meeting Session";

      const newMeeting = await invoke<Meeting>("create_meeting", {
        name,
        platform,
      });

      setMeetings((prev) => [newMeeting, ...prev]);
      setSelectedMeetingId(newMeeting.id);
      setRecordingMeetingId(newMeeting.id);

      try {
        await invoke("start_meeting_recording", { meetingId: newMeeting.id });
      } catch (error: unknown) {
        console.error("Failed to start meeting recording:", error);
        setRecordingMeetingId(null);
        const message =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "Failed to start recording";
        toast.error(message);
      }
    } catch (error: unknown) {
      console.error("Failed to create new meeting:", error);
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Failed to create meeting";
      toast.error(message);
    }
  };

  // Auto-start meeting when triggered from system tray
  useEffect(() => {
    if (autoStart && !recordingMeetingId) {
      handleCreateAndStartMeeting();
      onAutoStartConsumed?.();
    }
  }, [autoStart]);

  // Focus meeting when triggered from pill overlay
  useEffect(() => {
    if (!pillMeetingId) return;

    fetchMeetings();
    setSelectedMeetingId(pillMeetingId);
    setRecordingMeetingId(pillMeetingId);

    onPillMeetingConsumed?.();
  }, [pillMeetingId]);

  // When tray triggers end meeting: navigate to detail if on list, so detail page can show modal
  useEffect(() => {
    if (!triggerEndMeetingFromTray) return;
    if (recordingMeetingId && !selectedMeetingId) {
      setSelectedMeetingId(recordingMeetingId);
    }
    // Detail page will call onEndMeetingFromTrayConsumed when it shows the modal
  }, [triggerEndMeetingFromTray, recordingMeetingId, selectedMeetingId]);

  // When reminder triggers auto-end: open that meeting detail so it can run
  // the same end flow used by the End button.
  useEffect(() => {
    if (!triggerAutoEndMeetingFromReminderId) return;
    setSelectedMeetingId(triggerAutoEndMeetingFromReminderId);
    setRecordingMeetingId(triggerAutoEndMeetingFromReminderId);
    onAutoEndMeetingFromReminderConsumed?.();
  }, [
    triggerAutoEndMeetingFromReminderId,
    onAutoEndMeetingFromReminderConsumed,
  ]);

  const handleStopRecording = useCallback(() => {
    setRecordingMeetingId(null);
    setLiveSegments([]);
  }, []);

  const handleLiveSegmentAdded = useCallback((segment: TranscriptSegment) => {
    setLiveSegments((prev) => [...prev, segment]);
  }, []);

  const selectedMeetingDateLabel = selectedMeeting
    ? formatAppDateTime(selectedMeeting.created_at)
    : "";

  useEffect(() => {
    setIsEditingMeetingTitle(false);
  }, [selectedMeetingId]);

  useEffect(() => {
    if (!isEditingMeetingTitle && selectedMeeting) {
      setMeetingTitleDraft(selectedMeeting.name || "");
    }
  }, [selectedMeetingId, selectedMeeting, isEditingMeetingTitle]);

  const cancelMeetingTitleEdit = useCallback(() => {
    if (selectedMeeting) {
      setMeetingTitleDraft(selectedMeeting.name || "");
    }
    setIsEditingMeetingTitle(false);
  }, [selectedMeeting]);

  const saveMeetingTitle = useCallback(async () => {
    if (!selectedMeetingId || !selectedMeeting) return;
    const trimmed = meetingTitleDraft.trim();
    if (!trimmed) {
      setMeetingTitleDraft(selectedMeeting.name || "");
      setIsEditingMeetingTitle(false);
      return;
    }
    if (trimmed === (selectedMeeting.name || "").trim()) {
      setIsEditingMeetingTitle(false);
      return;
    }
    setIsSavingMeetingTitle(true);
    try {
      await invoke("update_meeting", {
        meetingId: selectedMeetingId,
        name: trimmed,
      });
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === selectedMeetingId ? { ...m, name: trimmed } : m,
        ),
      );
      setIsEditingMeetingTitle(false);
    } catch (error) {
      console.error("Failed to update meeting title:", error);
      setMeetingTitleDraft(selectedMeeting.name || "");
      setIsEditingMeetingTitle(false);
    } finally {
      setIsSavingMeetingTitle(false);
    }
  }, [selectedMeetingId, selectedMeeting, meetingTitleDraft]);

  return (
    <div className={`page ${selectedMeetingId ? "page--meetings-detail" : ""}`}>
      {selectedMeetingId && selectedMeeting && (
        <div className="meetings-page-header">
          <button
            type="button"
            className="meetings-page-header__back"
            onClick={() => {
              setSelectedMeetingId(null);
              setOpenToSummaryTab(false);
            }}
            aria-label="Back to meetings list"
          >
            <ArrowLeft size={20} strokeWidth={2} />
            <span>Meetings</span>
          </button>
          <div className="meetings-page-header__title meetings-page-header__title--editable">
            {isEditingMeetingTitle ? (
              <input
                type="text"
                className="meetings-page-header__title-input"
                value={meetingTitleDraft}
                onChange={(e) => setMeetingTitleDraft(e.target.value)}
                disabled={isSavingMeetingTitle}
                autoFocus
                aria-label="Meeting title"
                onBlur={() => {
                  requestAnimationFrame(() => {
                    if (skipTitleBlurSaveRef.current) {
                      skipTitleBlurSaveRef.current = false;
                      return;
                    }
                    void saveMeetingTitle();
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    skipTitleBlurSaveRef.current = true;
                    cancelMeetingTitleEdit();
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="meetings-page-header__title-text"
                onClick={() => setIsEditingMeetingTitle(true)}
              >
                {selectedMeeting.name || "Untitled Meeting"}
              </button>
            )}
          </div>
          <div className="meetings-page-header__meta">
            {recordingMeetingId === selectedMeetingId && (
              <span className="meetings-page-header__badge meetings-page-header__badge--live">
                <span className="meetings-page-header__badge-dot" />
                Live
              </span>
            )}
            {selectedMeetingDateLabel ? (
              <span className="meetings-page-header__date">
                {selectedMeetingDateLabel}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {selectedMeetingId ? (
        <MeetingDetailPage
          meetingId={selectedMeetingId}
          meeting={selectedMeeting}
          initialTab={openToSummaryTab ? "summary" : undefined}
          onBackToList={() => {
            setSelectedMeetingId(null);
            setOpenToSummaryTab(false);
          }}
          onMeetingDeleted={() => {
            setMeetings((prev) =>
              prev.filter((m) => m.id !== selectedMeetingId),
            );
            setSelectedMeetingId(null);
            if (recordingMeetingId === selectedMeetingId) {
              handleStopRecording();
            }
          }}
          onMeetingsUpdated={setMeetings}
          isThisMeetingRecording={recordingMeetingId === selectedMeetingId}
          liveSegments={liveSegments}
          onLiveSegmentAdded={handleLiveSegmentAdded}
          triggerEndMeetingFromTray={
            triggerEndMeetingFromTray &&
            recordingMeetingId === selectedMeetingId
          }
          onEndMeetingFromTrayConsumed={onEndMeetingFromTrayConsumed}
          triggerAutoEndMeetingFromReminder={
            triggerAutoEndMeetingFromReminderId === selectedMeetingId
          }
          onRecordingStopped={() => {
            setRecordingMeetingId(null);
            setLiveSegments([]);
            onRecordingStoppedGlobal?.();
          }}
          onRecordingStarted={(id) => {
            setRecordingMeetingId(id);
            setLiveSegments([]);
            onRecordingStartedGlobal?.(id);
          }}
        />
      ) : (
        <MeetingsListPage
          meetings={meetings}
          onRefreshMeetings={fetchMeetings}
          onSelectMeeting={(id, openToSummary) => {
            setSelectedMeetingId(id);
            setOpenToSummaryTab(!!openToSummary);
          }}
          onStartNewMeeting={handleCreateAndStartMeeting}
          isRecording={!!recordingMeetingId}
          activeRecordingMeetingId={recordingMeetingId}
          isGeneratingSummary={false}
          isLoading={isMeetingsLoading}
        />
      )}
    </div>
  );
};
