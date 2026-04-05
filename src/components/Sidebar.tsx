import React, { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useUpdaterStore } from "../store/updaterStore";
import {
  Atom,
  AudioLines,
  NotebookPen,
  Languages,
  BookText,
  ArrowLeftRight,
  LayoutDashboard,
} from "lucide-react";

import type { SidebarProps } from "../types";

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
}) => {
  const update = useUpdaterStore((state) => state.update);
  const updateDetails = useUpdaterStore((state) => state.updateDetails);
  const openModal = useUpdaterStore((state) => state.openModal);

  const [appVersion, setAppVersion] = useState<string>("");
  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  const sizeMb = updateDetails?.size_mb
    ? updateDetails.size_mb.toFixed(1)
    : null;

  return (
    <div className="sidebar">
      <div className="sidebar-logo" onClick={() => onNavigate("home")}>
        <div className="sidebar-logo-icon">
          <svg
            viewBox="0 0 320 320"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="m160.265 62c-8.669 0-16.983 3.4417-23.112 9.5678-6.13 6.1262-9.573 14.4351-9.573 23.0989v87.1113c0 8.664 3.443 16.972 9.573 23.099 6.129 6.126 14.443 9.567 23.112 9.567 8.668 0 16.982-3.441 23.111-9.567 6.13-6.127 9.573-14.435 9.573-23.099v-87.1113c0-8.6638-3.443-16.9727-9.573-23.0989-6.129-6.1261-14.443-9.5678-23.111-9.5678z"
              stroke="currentColor"
              strokeWidth="22.1429"
            />
            <path
              d="m236.529 160v21.778c0 20.215-8.035 39.603-22.337 53.897-14.303 14.294-33.701 22.325-53.927 22.325-20.227 0-39.625-8.031-53.928-22.325-14.302-14.294-22.337-33.682-22.337-53.897v-21.778"
              stroke="currentColor"
              strokeWidth="22.1429"
            />
          </svg>
        </div>
        <span className="sidebar-logo-text">Lexi AI</span>
      </div>
      <nav className="sidebar-nav">
        {/* === Section 1: Primary Workflow === */}

        {/* Home */}
        <button
          className={`sidebar-item ${currentPage === "home" ? "active" : ""}`}
          onClick={() => onNavigate("home")}
        >
          <LayoutDashboard size={18} strokeWidth={2} />
          <span>Home</span>
        </button>

        {/* Transcripts */}
        <button
          className={`sidebar-item ${
            currentPage === "transcripts" ? "active" : ""
          }`}
          onClick={() => onNavigate("transcripts")}
        >
          <AudioLines size={18} strokeWidth={2} />
          <span>Transcriptions</span>
        </button>

        {/* Meetings */}
        <button
          className={`sidebar-item ${currentPage === "meetings" ? "active" : ""}`}
          onClick={() => onNavigate("meetings")}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M23 7l-7 5 7 5V7z"></path>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
          <span>Meetings</span>
        </button>

        {/* Actions */}
        <button
          className={`sidebar-item ${
            currentPage === "actions" ? "active" : ""
          }`}
          onClick={() => onNavigate("actions")}
        >
          <Atom size={18} strokeWidth={2} />
          <span>Actions</span>
        </button>

        {/* Docs */}
        <button
          className={`sidebar-item ${currentPage === "docs" ? "active" : ""}`}
          onClick={() => onNavigate("docs")}
        >
          <BookText size={18} strokeWidth={2} />
          <span>Docs</span>
        </button>

        {/* Shortcuts */}
        <button
          className={`sidebar-item ${
            currentPage === "shortcuts" ? "active" : ""
          }`}
          onClick={() => onNavigate("shortcuts")}
        >
          <ArrowLeftRight size={18} strokeWidth={1.5} />
          <span>Shortcuts</span>
        </button>

        {/* Notes */}
        <button
          className={`sidebar-item ${currentPage === "notes" ? "active" : ""}`}
          onClick={() => onNavigate("notes")}
        >
          <NotebookPen size={18} strokeWidth={2} />
          <span>Notes</span>
        </button>

        {/* Vocabulary */}
        <button
          className={`sidebar-item ${currentPage === "vocabulary" ? "active" : ""}`}
          onClick={() => onNavigate("vocabulary")}
        >
          <Languages size={18} strokeWidth={2} />
          <span>Vocabulary</span>
        </button>

        {/* Settings */}
        <button
          className={`sidebar-item ${
            currentPage === "settings" ? "active" : ""
          }`}
          onClick={() => onNavigate("settings")}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          <span>Settings</span>
        </button>
      </nav>

      {/* Update Available Banner */}
      {update && (
        <button className="sidebar-update-banner" onClick={openModal}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <div className="sidebar-update-banner__text">
            <span className="sidebar-update-banner__title">
              Update v{update.version}
            </span>
            {sizeMb && (
              <span className="sidebar-update-banner__size">{sizeMb} MB</span>
            )}
          </div>
        </button>
      )}

      {/* Current version label */}
      {appVersion && <span className="sidebar-version">v{appVersion}</span>}
    </div>
  );
};
