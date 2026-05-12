import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Maximize2, X } from "lucide-react";

const BODY_CLASS = "lexi-windows-frameless";

/**
 * Windows-only: custom caption strip after native decorations are removed in Rust.
 * Matches the macOS grey shell; provides drag region and window controls.
 */
export function WindowsTitleBar() {
  const [active, setActive] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("@tauri-apps/plugin-os")
      .then(({ platform }) => {
        if (cancelled || platform() !== "windows") return;
        try {
          if (getCurrentWindow().label !== "main") return;
        } catch {
          return;
        }
        setActive(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    document.body.classList.add(BODY_CLASS);
    return () => document.body.classList.remove(BODY_CLASS);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const w = getCurrentWindow();
    const sync = () => {
      void w.isMaximized().then(setMaximized);
    };
    sync();
    let unlisten: (() => void) | undefined;
    void w.onResized(() => sync()).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [active]);

  if (!active) return null;

  const w = getCurrentWindow();

  return (
    <div className="windows-titlebar" aria-hidden>
      <div className="windows-titlebar__drag" data-tauri-drag-region />
      <div className="windows-titlebar__controls">
        <button
          type="button"
          className="windows-titlebar__btn"
          title="Minimize"
          onClick={() => void w.minimize()}
        >
          <Minus size={14} strokeWidth={2.25} />
        </button>
        <button
          type="button"
          className="windows-titlebar__btn"
          title={maximized ? "Restore" : "Maximize"}
          onClick={() => void w.toggleMaximize()}
        >
          {maximized ? (
            <Square size={12} strokeWidth={2.25} />
          ) : (
            <Maximize2 size={12} strokeWidth={2.25} />
          )}
        </button>
        <button
          type="button"
          className="windows-titlebar__btn windows-titlebar__btn--close"
          title="Close"
          onClick={() => void w.close()}
        >
          <X size={14} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
