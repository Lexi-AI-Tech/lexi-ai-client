import React from "react";

export const ShortcutsPage: React.FC = () => {
  return (
    <div className="shortcuts-page">
      <h2
        style={{
          margin: 0,
          marginBottom: "32px",
          fontSize: "24px",
          fontWeight: 600,
          color: "#ffffff",
        }}
      >
        Shortcuts
      </h2>

      <div
        style={{
          padding: "40px",
          color: "rgba(255, 255, 255, 0.6)",
          fontSize: "14px",
          textAlign: "center",
        }}
      >
        Shortcuts configuration will be available here.
      </div>
    </div>
  );
};
