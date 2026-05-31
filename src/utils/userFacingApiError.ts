/**
 * Turns backend / HTTP error strings (including FastAPI JSON bodies) into short,
 * user-readable toast copy. Safe to call on any string — plain messages pass through.
 */

export const USAGE_QUOTA_EXCEEDED_MESSAGE =
  "You've reached your usage limit for this billing period. Upgrade your plan or try again when your quota resets.";

/** Server returns HTTP 403 with `detail: "usage_quota_exceeded"` (see BillingService.enforce_from_token / enforce_from_database). */
export const USAGE_QUOTA_EXCEEDED_DETAIL = "usage_quota_exceeded";

/** True when the error text includes the server usage-quota token (403 + this detail, not other 403s). */
export function isUsageQuotaExceededError(raw: string): boolean {
  return raw.toLowerCase().includes(USAGE_QUOTA_EXCEEDED_DETAIL);
}

/**
 * True when the error indicates the user needs to re-authenticate.
 *
 * Note: Tauri commands may return plain strings like "Authentication required" or
 * internal markers like "no_auth_data"/"expired", not only HTTP status text.
 */
export function isAuthErrorFromUnknown(err: unknown): boolean {
  const raw =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : String(err ?? "");
  const s = raw.trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  return (
    lower.includes("not authenticated") ||
    lower.includes("authentication required") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("no_auth_data") ||
    lower.includes("expired") ||
    // Some callers pass through upstream HTTP-ish strings.
    lower.includes(" 401") ||
    lower.includes(" 403") ||
    lower.includes("401 ") ||
    lower.includes("403 ")
  );
}

const SERVER_ERROR_PREFIX = /^Server Error\s*\([^)]+\)\s*:\s*/i;

function tryParseDetailFromJsonObject(jsonStr: string): string | null {
  const t = jsonStr.trim();
  if (!t.startsWith("{")) return null;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    const d = o.detail;
    if (typeof d === "string" && d.trim()) return d.trim();
    if (Array.isArray(d) && d.length > 0) {
      const first = d[0];
      if (typeof first === "string" && first.trim()) return first.trim();
      if (first && typeof first === "object" && "msg" in first) {
        const msg = (first as { msg?: unknown }).msg;
        if (typeof msg === "string" && msg.trim()) return msg.trim();
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Balanced `{ ... }` from index, respecting strings and escapes. */
function sliceBalancedJsonObject(s: string, start: number): string | null {
  if (s[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function extractDetailFromAnywhere(s: string): string | null {
  const direct = tryParseDetailFromJsonObject(s);
  if (direct) return direct;

  const needle = '"detail"';
  let searchFrom = 0;
  while (searchFrom < s.length) {
    const detailPos = s.indexOf(needle, searchFrom);
    if (detailPos < 0) break;
    let braceStart = detailPos;
    while (braceStart >= 0 && s[braceStart] !== "{") braceStart--;
    if (braceStart < 0) {
      searchFrom = detailPos + needle.length;
      continue;
    }
    const jsonStr = sliceBalancedJsonObject(s, braceStart);
    if (jsonStr) {
      const parsed = tryParseDetailFromJsonObject(jsonStr);
      if (parsed) return parsed;
    }
    searchFrom = detailPos + needle.length;
  }
  return null;
}

function mapDetailToFriendly(detail: string): string {
  const t = detail.trim();
  if (!t) return "Something went wrong";
  if (isUsageQuotaExceededError(t)) {
    return USAGE_QUOTA_EXCEEDED_MESSAGE;
  }
  const lower = t.toLowerCase();
  if (
    lower.includes("not authenticated") ||
    t === "Authentication required" ||
    lower === "authentication required"
  ) {
    return "Please sign in to continue.";
  }
  return t;
}

/**
 * Normalizes API/HTTP error text for display (toasts, inline messages).
 */
export function formatUserFacingApiError(raw: string): string {
  const s = raw.trim();
  if (!s) return "Something went wrong";

  const fromDetail = extractDetailFromAnywhere(s);
  if (fromDetail) {
    return mapDetailToFriendly(fromDetail);
  }

  const stripped = s.replace(SERVER_ERROR_PREFIX, "").trim();
  if (stripped && stripped !== s) {
    const inner =
      extractDetailFromAnywhere(stripped) ??
      tryParseDetailFromJsonObject(stripped);
    if (inner) return mapDetailToFriendly(inner);
    if (!stripped.includes("{")) return mapDetailToFriendly(stripped);
  }

  if (/^Server Error\s*\(/i.test(s)) {
    return "Something went wrong. Please try again.";
  }

  if (isUsageQuotaExceededError(s)) {
    return USAGE_QUOTA_EXCEEDED_MESSAGE;
  }

  return s;
}

export function formatUserFacingApiErrorFromUnknown(err: unknown): string {
  if (err == null) return "Something went wrong";
  if (typeof err === "string") return formatUserFacingApiError(err);
  if (err instanceof Error) return formatUserFacingApiError(err.message);
  try {
    return formatUserFacingApiError(String(err));
  } catch {
    return "Something went wrong";
  }
}
