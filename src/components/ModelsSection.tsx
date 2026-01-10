/**
 * ModelsSection Component
 *
 * Model functionality has been removed.
 */

import React from "react";

export const ModelsSection: React.FC = () => {
  return (
    <div>
      <h3
        style={{
          marginBottom: "16px",
          fontSize: "18px",
          fontWeight: 500,
          color: "#ffffff",
        }}
      >
        Offline Models
      </h3>

      <div
        style={{
          fontSize: "11px",
          color: "rgba(255, 255, 255, 0.6)",
          marginBottom: "16px",
          lineHeight: "1.5",
        }}
      >
        Local model functionality has been removed. The app now uses cloud-based
        transcription only.
      </div>
    </div>
  );
};
