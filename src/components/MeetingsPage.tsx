import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../store/authStore";
import { MeetingsListPage, type Meeting } from "./meetings/MeetingsListPage";
import { MeetingDetailPage } from "./meetings/MeetingDetailPage";
import "./meetings.css";

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
}

export const MeetingsPage: React.FC<MeetingsPageProps> = ({
  autoStart,
  autoStartPlatform,
  onAutoStartConsumed,
  pillMeetingId,
  onPillMeetingConsumed,
  triggerEndMeetingFromTray,
  onEndMeetingFromTrayConsumed,
}) => {
    const { tokens } = useAuthStore();
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
    const [openToSummaryTab, setOpenToSummaryTab] = useState(false);
    const [recordingMeetingId, setRecordingMeetingId] = useState<string | null>(null);
    const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);

    const selectedMeeting = selectedMeetingId
        ? meetings.find((m) => m.id === selectedMeetingId) ?? null
        : null;

    const fetchMeetings = useCallback(async () => {
        try {
            const result = await invoke<Meeting[]>("list_meetings");
            setMeetings(result);
        } catch (error) {
            console.error("Failed to fetch meetings:", error);
        }
    }, []);

    useEffect(() => {
        if (tokens?.access_token) {
            fetchMeetings();
        }
    }, [tokens, fetchMeetings]);

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
                        id: payload.id || `live-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                        segment_index: payload.segment_index ?? 0,
                        start_time: payload.start_time ?? "",
                        end_time: payload.end_time ?? "",
                        text: payload.text ?? "",
                        message_type: payload.message_type ?? "user_audio",
                    };
                    setLiveSegments((prev) => [...prev, segment]);
                }
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
                typeof autoStartPlatform === "string" && autoStartPlatform.trim().length > 0
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
            } catch (error) {
                console.error("Failed to start meeting recording:", error);
                setRecordingMeetingId(null);
            }
        } catch (error) {
            console.error("Failed to create new meeting:", error);
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

    const handleStopRecording = useCallback(() => {
        setRecordingMeetingId(null);
        setLiveSegments([]);
    }, []);

    const handleLiveSegmentAdded = useCallback((segment: TranscriptSegment) => {
        setLiveSegments((prev) => [...prev, segment]);
    }, []);

    const formatMeetingDate = (m: Meeting | null) => {
        if (!m?.created_at) return null;
        try {
            const d = new Date(m.created_at);
            return d.toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            });
        } catch {
            return null;
        }
    };

    return (
        <div className={`page ${selectedMeetingId ? "page--meetings-detail" : ""}`}>
            <div className="meetings-page-header">
                {selectedMeeting ? (
                    <div className="meetings-page-header__title">
                        {selectedMeeting.name || "Untitled Meeting"}
                    </div>
                ) : (
                    <div className="meetings-page-header__title">Meetings</div>
                )}
                {selectedMeeting && (
                    <div className="meetings-page-header__meta">
                        {recordingMeetingId === selectedMeetingId && (
                            <span className="meetings-page-header__badge meetings-page-header__badge--live">
                                <span className="meetings-page-header__badge-dot" />
                                Live
                            </span>
                        )}
                        {formatMeetingDate(selectedMeeting) && (
                            <span className="meetings-page-header__date">
                                {formatMeetingDate(selectedMeeting)}
                            </span>
                        )}
                    </div>
                )}
            </div>

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
                        setMeetings((prev) => prev.filter((m) => m.id !== selectedMeetingId));
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
                        triggerEndMeetingFromTray && recordingMeetingId === selectedMeetingId
                    }
                    onEndMeetingFromTrayConsumed={onEndMeetingFromTrayConsumed}
                    onRecordingStopped={() => {
                        setRecordingMeetingId(null);
                        setLiveSegments([]);
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
                    isGeneratingSummary={false}
                />
            )}
        </div>
    );
};
