import { useSyncExternalStore } from "react";
import {
  getKeycapLayout,
  subscribeKeycapLayout,
  type KeycapLayout,
} from "../lib/keySymbols";

/** OS layout from Rust `get_system_type`; `null` until the command completes. */
export function useKeycapLayout(): KeycapLayout | null {
  return useSyncExternalStore<KeycapLayout | null>(
    subscribeKeycapLayout,
    getKeycapLayout,
    () => null,
  );
}
