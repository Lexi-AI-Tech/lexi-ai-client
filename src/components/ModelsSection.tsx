/**
 * ModelsSection Component
 *
 * Model functionality has been removed.
 */

import React from "react";

export const ModelsSection: React.FC = () => {
  return (
    <div>
      <h3 className="models-section__title">Offline Models</h3>
      <div className="models-section__desc">
        Local model functionality has been removed. The app now uses cloud-based
        transcription only.
      </div>
    </div>
  );
};
