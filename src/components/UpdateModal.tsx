import React, { useState } from "react";
import { useUpdaterStore } from "../store/updaterStore";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, X } from "lucide-react";
import { useToast } from "./toast/useToast";

export const UpdateModal: React.FC = () => {
  const update = useUpdaterStore((state) => state.update);
  const updateDetails = useUpdaterStore((state) => state.updateDetails);
  const showModal = useUpdaterStore((state) => state.showModal);
  const closeModal = useUpdaterStore((state) => state.closeModal);

  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState(-1);
  const toast = useToast();

  if (!update || !showModal) return null;

  const sizeMb = updateDetails?.size_mb
    ? updateDetails.size_mb.toFixed(2)
    : null;

  const handleInstall = async () => {
    try {
      setIsInstalling(true);
      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength || 0;
            setProgress(contentLength > 0 ? 0 : -1);
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case "Finished":
            setProgress(100);
            break;
        }
      });

      toast.success("Install complete! Restarting App.");
      setTimeout(() => relaunch(), 1000);
    } catch (e: any) {
      console.error(e);
      toast.error(`Update failed: ${e.message}`);
      setIsInstalling(false);
    }
  };

  const handleClose = () => {
    if (!isInstalling) {
      closeModal();
    }
  };

  return (
    <div
      className="modal-overlay"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.4)" }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          padding: "28px",
          borderRadius: "16px",
          width: "480px",
          maxWidth: "90vw",
          maxHeight: "80vh",
          overflowY: "auto",
          border: "1px solid #e5e7eb",
          boxShadow:
            "0 20px 60px rgba(0, 0, 0, 0.15), 0 4px 16px rgba(0, 0, 0, 0.08)",
          position: "relative",
          color: "#111827",
        }}
      >
        <button
          onClick={handleClose}
          disabled={isInstalling}
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            background: "#f3f4f6",
            border: "none",
            borderRadius: "8px",
            cursor: isInstalling ? "not-allowed" : "pointer",
            padding: "6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#6b7280",
            transition: "all 0.2s ease",
          }}
        >
          <X size={18} />
        </button>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "20px",
          }}
        >
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              background: "linear-gradient(135deg, #ecfdf5, #d1fae5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Download size={20} color="#059669" />
          </div>
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: "18px",
                fontWeight: 600,
                color: "#111827",
                letterSpacing: "-0.01em",
              }}
            >
              Update Available
            </h2>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <span
            style={{
              fontSize: "14px",
              fontWeight: 500,
              color: "#6b7280",
            }}
          >
            Version {update.version}
          </span>
          {sizeMb && (
            <span
              style={{
                fontSize: "12px",
                backgroundColor: "#f3f4f6",
                padding: "4px 10px",
                borderRadius: "6px",
                color: "#6b7280",
                fontWeight: 500,
              }}
            >
              📦 {sizeMb} MB
            </span>
          )}
        </div>

        <div
          style={{
            backgroundColor: "#f9fafb",
            padding: "14px 16px",
            borderRadius: "10px",
            border: "1px solid #f3f4f6",
            margin: "0 0 20px 0",
            fontSize: "13px",
            lineHeight: "1.6",
            whiteSpace: "pre-wrap",
            maxHeight: "180px",
            overflowY: "auto",
            color: "#374151",
          }}
        >
          {updateDetails?.notes || update.body || "No release notes provided."}
        </div>

        {isInstalling && (
          <div style={{ margin: "0 0 20px 0" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "8px",
                fontSize: "13px",
                color: "#6b7280",
              }}
            >
              <span>Downloading update...</span>
              <span>{progress > -1 ? `${progress}%` : ""}</span>
            </div>
            <div
              style={{
                width: "100%",
                height: "6px",
                backgroundColor: "#f3f4f6",
                borderRadius: "4px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  backgroundColor: "#111827",
                  width: progress > -1 ? `${progress}%` : "100%",
                  borderRadius: "4px",
                  transition: "width 0.2s",
                  animation:
                    progress === -1 ? "pulse 1s infinite alternate" : "none",
                }}
              />
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
          }}
        >
          <button
            onClick={handleClose}
            disabled={isInstalling}
            style={{
              padding: "8px 18px",
              fontSize: "14px",
              fontWeight: 500,
              border: "none",
              borderRadius: "8px",
              cursor: isInstalling ? "not-allowed" : "pointer",
              background: "#f3f4f6",
              color: "#6b7280",
              transition: "all 0.2s ease",
              opacity: isInstalling ? 0.5 : 1,
            }}
          >
            Later
          </button>
          <button
            onClick={handleInstall}
            disabled={isInstalling}
            style={{
              padding: "8px 18px",
              fontSize: "14px",
              fontWeight: 500,
              border: "none",
              borderRadius: "8px",
              cursor: isInstalling ? "not-allowed" : "pointer",
              background: "#111827",
              color: "#ffffff",
              transition: "all 0.2s ease",
              opacity: isInstalling ? 0.7 : 1,
            }}
          >
            {isInstalling ? "Installing..." : "Download & Install"}
          </button>
        </div>
      </div>
    </div>
  );
};
