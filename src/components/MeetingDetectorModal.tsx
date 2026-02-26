import { useState, useEffect } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

interface MeetingContext {
    platform: string;
    title: string;
    confidence: number;
}

export function MeetingDetectorModal() {
    const [meeting, setMeeting] = useState<MeetingContext | null>(null);

    useEffect(() => {
        let unlisten: UnlistenFn;

        const setupListener = async () => {
            unlisten = await listen<MeetingContext>("meeting-detected", async (event) => {
                console.log("meeting-detected event received:", event.payload);
                setMeeting(event.payload);

                try {
                    const appWindow = getCurrentWebviewWindow();
                    await appWindow.unminimize();
                    await appWindow.setFocus();
                } catch (e) {
                    console.error("Failed to focus window:", e);
                }
            });
        };

        setupListener();
        return () => {
            if (unlisten) unlisten();
        };
    }, []);

    if (!meeting) return null;

    return (
        <div className="modal-overlay" onClick={() => setMeeting(null)} style={{ zIndex: 9999 }}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%' }}>
                <div style={{ textAlign: "center", marginBottom: "1rem" }}>
                    <span style={{ fontSize: "2.5rem" }}>🎙️</span>
                </div>
                <h3 style={{ textAlign: "center", marginTop: 0 }}>
                    Record {meeting.platform === "slack" ? "Slack Huddle" : meeting.platform}?
                </h3>
                <p className="modal-content__desc" style={{ textAlign: "center", marginBottom: "1.5rem" }}>
                    Lexi noticed you started a {meeting.title.includes("huddle") ? "Huddle" : "meeting"}. Want to record and transcribe it?
                </p>

                <div className="modal-actions" style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
                    <button
                        type="button"
                        onClick={() => setMeeting(null)}
                        className="delete-modal-btn-cancel"
                        style={{ flex: 1 }}
                    >
                        Dismiss
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            console.log("User clicked Record for meeting:", meeting.title);
                            // TODO: Wire up actual recording trigger.
                            setMeeting(null);
                        }}
                        style={{
                            flex: 1,
                            backgroundColor: "#6366f1",
                            color: "white",
                            border: "none",
                            borderRadius: "8px",
                            padding: "10px 16px",
                            cursor: "pointer",
                            fontWeight: 500
                        }}
                    >
                        Record
                    </button>
                </div>
            </div>
        </div>
    );
}
