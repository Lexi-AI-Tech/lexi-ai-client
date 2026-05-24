import {
  isWindowsSuperKeyKeycap,
  lookupKeycap,
  type KeycapLayout,
} from "../lib/keySymbols";

type HotkeyKeycapSymbolProps = {
  part: string;
  layout: KeycapLayout | null;
};

/** Windows 11–style four-pane mark (SVG); scales with `currentColor`. */
function WindowsKeyGlyph() {
  return (
    <svg
      className="hotkey-selector__win-svg"
      viewBox="0 0 16 16"
      width="14"
      height="14"
    >
      <rect x="1" y="1" width="6" height="6" rx="0.9" />
      <rect x="9" y="1" width="6" height="6" rx="0.9" />
      <rect x="1" y="9" width="6" height="6" rx="0.9" />
      <rect x="9" y="9" width="6" height="6" rx="0.9" />
    </svg>
  );
}

export function HotkeyKeycapSymbol({ part, layout }: HotkeyKeycapSymbolProps) {
  if (layout === null) return null;
  const keyInfo = lookupKeycap(part, layout);
  if (!keyInfo) return null;
  if (isWindowsSuperKeyKeycap(part, layout)) {
    return (
      <span
        className="hotkey-selector__key-symbol hotkey-selector__key-symbol--win-logo"
        aria-hidden
      >
        <WindowsKeyGlyph />
      </span>
    );
  }
  if (!keyInfo.symbol) return null;
  return <span className="hotkey-selector__key-symbol">{keyInfo.symbol}</span>;
}
