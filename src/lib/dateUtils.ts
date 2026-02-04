/**
 * Date formatting utilities for use across the app.
 * Replaces Tauri format_date_relative / format_date_time to avoid N invokes.
 */

/**
 * Format a date string as relative time (e.g. "Just now", "5 minutes ago", "2 hours ago").
 * For dates older than 7 days, returns a locale date string.
 */
export function formatDateRelative(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60)
      return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
    if (diffHours < 24)
      return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
    if (diffDays < 7)
      return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
    return date.toLocaleDateString();
  } catch {
    return dateString;
  }
}

/**
 * Format a date string as locale-aware date and time (e.g. "Jan 10, 2024 at 2:30 PM").
 */
export function formatDateTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return dateString;
  }
}
