/**
 * Shared loading indicator used across all pages.
 * Same spinner + "Loading..." label everywhere (no page-specific text).
 */

import React from "react";

interface PageLoaderProps {
  /** Optional class for layout (e.g. full page vs inline) */
  className?: string;
}

export const PageLoader: React.FC<PageLoaderProps> = ({ className }) => (
  <div className={`loading-state page-loader ${className ?? ""}`.trim()}>
    <div className="loading-spinner" />
    <span>Loading...</span>
  </div>
);
