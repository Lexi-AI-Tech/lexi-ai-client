/**
 * Date formatting utilities for use across the app.
 * Replaces Tauri format_date_relative / format_date_time to avoid N invokes.
 *
 * **API contract:** Responses use ISO-8601 instants in UTC (`Z` on the wire), with
 * no conversion to the server host's local zone. The Tauri layer forwards JSON
 * strings without rewriting times.
 *
 * **Inbound-only server logic** (e.g. parsing meeting segment times) normalizes
 * client-submitted strings to UTC for storage; that is not applied again when
 * reading rows for API responses.
 *
 * **Parsing here:** `parseServerDate` accepts ISO strings plus SQL-style
 * literals (e.g. space between date and time, long fractional seconds) so the
 * same instant is recovered; `formatAppDateTime` / `toLocaleString` then display
 * in the **user’s** locale and timezone.
 */

/**
 * Parse a server- or DB-provided timestamp into a valid `Date`, or null.
 * Trims input, normalizes SQL `YYYY-MM-DD HH:MM:SS` to ISO `T` separator, and
 * rounds fractional seconds to milliseconds (with second rollover when needed).
 */
export function parseServerDate(input: string | null | undefined): Date | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;

  // SQL-style: space between date and time — use `T` for reliable ISO parsing.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    s = s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/, "$1T$2");
  }

  // Optional fractional seconds + optional `Z` or `±HH:MM` / `±HHMM` offset
  const withFrac = s.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?([Zz]|[+-]\d{2}:?\d{2})?$/,
  );
  if (withFrac?.[2]) {
    const msRounded = Math.round(parseFloat(withFrac[2]) * 1000);
    const head = withFrac[1];
    const tz = withFrac[3] ?? "";
    if (msRounded >= 1000) {
      const base = new Date(`${head}${tz || "Z"}`);
      if (Number.isNaN(base.getTime())) {
        return null;
      }
      return new Date(base.getTime() + msRounded);
    }
    s = `${head}.${String(msRounded).padStart(3, "0")}${tz}`;
  } else {
    // No fractional part (e.g. `...09+05:30`): still benefit from space→T above
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
    // Legacy: trim extra sub-ms digits only (Python µs, etc.)
    s = s.replace(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})\d+/, "$1");
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Standard list/card timestamp: weekday, month, day, and time — same style as
 * the Meetings list. Uses the user's locale and local timezone.
 */
export function formatAppDateTime(
  isoString: string | null | undefined,
): string {
  const date = parseServerDate(isoString);
  if (!date) return "";
  try {
    return date.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/**
 * Time-of-day with seconds, localized (e.g. inline transcript / segment stamps).
 */
export function formatLocaleTimeWithSeconds(
  isoString: string | null | undefined,
): string {
  const date = parseServerDate(isoString);
  if (!date) return "00:00:00";
  try {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "00:00:00";
  }
}

/** Start of the given instant’s calendar day in the local timezone. */
function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function capitalizeFirstLetter(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLocaleUpperCase(undefined) + s.slice(1);
}

/** Whole calendar days between `earlier` and `later` (local dates), both inclusive of their midnights. */
function localCalendarDaysBetween(earlier: Date, later: Date): number {
  const a = startOfLocalDay(earlier).getTime();
  const b = startOfLocalDay(later).getTime();
  return Math.round((b - a) / 86400000);
}

/**
 * Human-friendly list/card timestamp: relative only for **today** (same local calendar day);
 * **yesterday** as localized “yesterday” + time; **two or more days ago** (and future instants)
 * as {@link formatAppDateTime}.
 */
export function formatDateRelative(dateString: string): string {
  try {
    const date = parseServerDate(dateString);
    if (!date) return dateString;
    const now = new Date();

    if (date.getTime() > now.getTime()) {
      return formatAppDateTime(dateString);
    }

    const dayDiff = localCalendarDaysBetween(date, now);

    if (dayDiff === 0) {
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      if (diffMins < 1) return "Just now";
      if (diffMins < 60) {
        return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
      }
      return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
    }

    if (dayDiff === 1) {
      const timePart = date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
      const yesterdayLabel = capitalizeFirstLetter(
        new Intl.RelativeTimeFormat(undefined, {
          numeric: "auto",
        }).format(-1, "day"),
      );
      return `${yesterdayLabel} at ${timePart}`;
    }

    return formatAppDateTime(dateString);
  } catch {
    return dateString;
  }
}
