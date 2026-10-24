/**
 * ModelsSection Component
 *
 * Offline mode: switch dictation to on-device speech-to-text and manage local models.
 * The model catalog (with hardware requirements) comes from the Lexi server.
 */

import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown } from "lucide-react";

interface HardwareRequirements {
  min_ram_gb: number;
  recommended_ram_gb: number;
  disk_mb: number;
  supported_platforms: string[];
  recommended_chip: string;
  gpu_acceleration: string;
}

// Mirrors `OfflineModel` in src-tauri/src/offline.rs (server DTO + local state).
interface OfflineModel {
  id: string;
  slug: string;
  name: string;
  description: string;
  file_name: string;
  languages: "multilingual" | "english";
  speed: string;
  accuracy: string;
  hardware: HardwareRequirements;
  recommended: boolean;
  size_bytes: number;
  sha256: string;
  installed: boolean;
  selected: boolean;
}

interface OfflineStatus {
  mode: "cloud" | "offline";
  supported: boolean;
  stt_model: string | null;
  models_dir: string;
}

interface DownloadProgress {
  id: string;
  downloaded: number;
  total: number;
}

const TIER_LABEL: Record<string, string> = {
  fastest: "Fastest",
  fast: "Fast",
  balanced: "Balanced",
  accurate: "Accurate",
  most_accurate: "Most accurate",
};

const formatSize = (mb: number) =>
  mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`;

const smallButton: React.CSSProperties = {
  margin: 0,
  padding: "8px 14px",
  width: "fit-content",
};

export const ModelsSection: React.FC = () => {
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [models, setModels] = useState<OfflineModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await invoke<OfflineStatus>("get_offline_status");
      setStatus(s);
      if (!s.supported) return;
      try {
        setModels(await invoke<OfflineModel[]>("list_offline_models"));
        setModelsError(null);
      } catch (e) {
        setModelsError(String(e));
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<DownloadProgress>("offline_model_progress", (event) =>
      setProgress(event.payload),
    ).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refresh]);

  if (!status) return null;

  if (!status.supported) {
    return (
      <div>
        <h3 className="models-section__title">Offline Mode</h3>
        <div className="models-section__desc">
          Offline mode requires a Mac with Apple Silicon.
        </div>
      </div>
    );
  }

  const offline = status.mode === "offline";

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  // Enabling a model makes it the active one and switches dictation to on-device.
  const enable = (model: OfflineModel) =>
    run(async () => {
      await invoke("select_offline_model", { fileName: model.file_name });
      await invoke("set_inference_mode", { mode: "offline" });
    });

  const disable = () =>
    run(() => invoke("set_inference_mode", { mode: "cloud" }));

  const download = async (model: OfflineModel) => {
    setDownloadingId(model.slug);
    setProgress(null);
    await run(() =>
      invoke("download_offline_model", {
        slug: model.slug,
        fileName: model.file_name,
      }),
    );
    setDownloadingId(null);
    setProgress(null);
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="models-section__title"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "inherit",
          font: "inherit",
        }}
      >
        <span>Transcription</span>
        <ChevronDown
          size={18}
          style={{
            transform: expanded ? "rotate(180deg)" : undefined,
            transition: "transform 0.15s",
          }}
        />
      </button>

      {modelsError && <div className="settings-hint">{modelsError}</div>}

      {expanded &&
        models.map((model) => {
          const downloading = downloadingId === model.slug;
          const pct =
            downloading && progress && progress.total > 0
              ? Math.floor((progress.downloaded / progress.total) * 100)
              : null;
          const hw = model.hardware;
          const enabled = model.selected && offline;
          return (
            <div className="settings-row" key={model.id}>
              <div className="settings-row__content">
                <div className="settings-row__title">
                  {model.name} ({formatSize(hw.disk_mb)})
                  {model.recommended && " · Recommended"}
                  {enabled && " · Enabled"}
                </div>
                <div className="settings-row__desc">
                  {model.description}
                  <br />
                  {model.languages === "english"
                    ? "English only"
                    : "Multilingual"}{" "}
                  · Speed: {TIER_LABEL[model.speed] ?? model.speed} · Accuracy:{" "}
                  {TIER_LABEL[model.accuracy] ?? model.accuracy}
                  <br />
                  Needs {hw.min_ram_gb} GB RAM (recommended{" "}
                  {hw.recommended_ram_gb} GB) · {hw.recommended_chip}
                </div>
              </div>
              {model.installed ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="sidebar-update-banner"
                    style={smallButton}
                    onClick={() => void (enabled ? disable() : enable(model))}
                  >
                    {enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    className="sidebar-update-banner"
                    style={smallButton}
                    onClick={() =>
                      void run(() =>
                        invoke("delete_offline_model", {
                          fileName: model.file_name,
                        }),
                      )
                    }
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="sidebar-update-banner"
                  style={smallButton}
                  disabled={downloadingId !== null}
                  onClick={() => void download(model)}
                >
                  {downloading
                    ? pct !== null
                      ? `${pct}%`
                      : "Starting…"
                    : "Download"}
                </button>
              )}
            </div>
          );
        })}
      {error && <div className="settings-hint">{error}</div>}
    </div>
  );
};
