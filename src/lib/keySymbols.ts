import { invoke } from "@tauri-apps/api/core";

export type KeycapLayout = "mac" | "windows";

let rustKeycapLayout: KeycapLayout | null = null;
let rustFetchStarted = false;
const keycapLayoutListeners = new Set<() => void>();

function notifyKeycapLayoutListeners() {
  keycapLayoutListeners.forEach((fn) => fn());
}

function startResolveKeycapLayoutFromRust() {
  if (rustFetchStarted) return;
  rustFetchStarted = true;
  void invoke<string>("get_system_type")
    .then((t) => {
      const next: KeycapLayout = t === "mac" ? "mac" : "windows";
      if (rustKeycapLayout !== next) {
        rustKeycapLayout = next;
        notifyKeycapLayoutListeners();
      }
    })
    .catch(() => {
      notifyKeycapLayoutListeners();
    });
}

/**
 * Start loading OS layout from Rust `get_system_type`. Idempotent.
 * Call from app entry (e.g. `main.tsx`) so the command runs before UI that needs keycaps.
 */
export function prefetchKeycapLayout(): void {
  startResolveKeycapLayoutFromRust();
}

/**
 * Subscribe to keycap layout updates after `get_system_type` completes.
 * For `useSyncExternalStore` with {@link getKeycapLayout}.
 */
export function subscribeKeycapLayout(onStoreChange: () => void): () => void {
  keycapLayoutListeners.add(onStoreChange);
  startResolveKeycapLayoutFromRust();
  return () => {
    keycapLayoutListeners.delete(onStoreChange);
  };
}

/** `null` until Rust `get_system_type` succeeds; no navigator or other heuristics. */
export function getKeycapLayout(): KeycapLayout | null {
  return rustKeycapLayout;
}

type KeyCapDisplay = { symbol: string; label: string };

const MAC_KEYCAPS: Record<string, KeyCapDisplay> = {
  fn: { symbol: "fn", label: "🌐" },
  control: { symbol: "^", label: "control" },
  option: { symbol: "⌥", label: "option" },
  command: { symbol: "⌘", label: "command" },
  shift: { symbol: "⇧", label: "shift" },
  caps: { symbol: "⇪", label: "caps" },
  capslock: { symbol: "⇪", label: "caps lock" },
  tab: { symbol: "⇥", label: "tab" },
  escape: { symbol: "⎋", label: "esc" },
  return: { symbol: "↩", label: "return" },
  enter: { symbol: "↩", label: "enter" },
  delete: { symbol: "⌫", label: "delete" },
  backspace: { symbol: "⌫", label: "delete" },
  space: { symbol: "␣", label: "space" },
};

const WINDOWS_KEYCAPS: Record<string, KeyCapDisplay> = {
  fn: { symbol: "Fn", label: "" },
  control: { symbol: "Ctrl", label: "" },
  option: { symbol: "Alt", label: "" },
  windows: { symbol: "", label: "Win" },
  shift: { symbol: "Shift", label: "" },
  caps: { symbol: "Caps", label: "" },
  capslock: { symbol: "Caps", label: "Lock" },
  tab: { symbol: "Tab", label: "" },
  escape: { symbol: "Esc", label: "" },
  return: { symbol: "Enter", label: "" },
  enter: { symbol: "Enter", label: "" },
  delete: { symbol: "Del", label: "" },
  backspace: { symbol: "Bksp", label: "" },
  space: { symbol: "Space", label: "" },
};

/** Normalize hotkey segment to a table id (lowercase logical id). */
function normalizeKeyPart(part: string): string {
  const k = part.trim().toLowerCase();
  switch (k) {
    case "ctrl":
    case "control":
      return "control";
    case "alt":
    case "option":
      return "option";
    case "shift":
      return "shift";
    case "fn":
      return "fn";
    case "cmd":
    case "command":
    case "meta":
      return "command";
    case "win":
    case "windows":
      return "windows";
    case "caps":
    case "capslock":
    case "caps lock":
      return "capslock";
    case "esc":
    case "escape":
      return "escape";
    case "return":
      return "return";
    case "enter":
      return "enter";
    case "backspace":
      return "backspace";
    case "delete":
    case "del":
      return "delete";
    case "tab":
      return "tab";
    case " ":
    case "space":
      return "space";
    default:
      return k;
  }
}

/** Windows / Command key: show four-pane logo instead of text (see `HotkeyKeycapSymbol`). */
export function isWindowsSuperKeyKeycap(
  part: string,
  layout: KeycapLayout,
): boolean {
  if (layout !== "windows") return false;
  const id = normalizeKeyPart(part);
  return id === "windows" || id === "command";
}

/**
 * Symbol + subtitle for a single key segment, or undefined for literal keys (letters, arrows, etc.).
 * Only call after layout is known from {@link getKeycapLayout} (non-null).
 */
export function lookupKeycap(
  part: string,
  layout: KeycapLayout,
): KeyCapDisplay | undefined {
  const id = normalizeKeyPart(part);
  if (layout === "mac") {
    if (id === "windows") {
      return { symbol: "⊞", label: "Win" };
    }
    if (id === "command") return MAC_KEYCAPS.command;
    return MAC_KEYCAPS[id];
  }
  if (id === "command") return WINDOWS_KEYCAPS.windows;
  if (id === "windows") return WINDOWS_KEYCAPS.windows;
  return WINDOWS_KEYCAPS[id];
}
