/**
 * App Config Store
 *
 * In-memory UI mirror of app settings. Source of truth is Rust (Tauri Store + cloud sync).
 */

import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppConfig } from "../types";

let config: AppConfig | null = null;
let isLoading = false;
let isInitialized = false;
let error: string | null = null;

const listeners = new Set<() => void>();

const notifyListeners = () => {
  listeners.forEach((listener) => listener());
};

const loadFromRust = async () => {
  isLoading = true;
  error = null;
  notifyListeners();

  try {
    config = await invoke<AppConfig>("get_app_config");
  } catch (e) {
    console.error("Failed to load app config from Rust:", e);
    error = e instanceof Error ? e.message : "Failed to load configuration";
  } finally {
    isLoading = false;
    isInitialized = true;
    notifyListeners();
  }
};

const refreshFromCloud = async () => {
  isLoading = true;
  error = null;
  notifyListeners();

  try {
    config = await invoke<AppConfig>("refresh_app_config");
  } catch (e) {
    console.error("Failed to refresh app config from cloud:", e);
    error = e instanceof Error ? e.message : "Failed to refresh configuration";
  } finally {
    isLoading = false;
    notifyListeners();
  }
};

void loadFromRust();

listen("app_config_changed", () => {
  void loadFromRust();
});

export const appConfigStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot() {
    return { config, isLoading, isInitialized, error };
  },

  async refreshFromCloud() {
    await refreshFromCloud();
  },
};

export function useAppConfigStore(): {
  config: AppConfig | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  refreshFromCloud: () => Promise<void>;
} {
  const snapshot = React.useSyncExternalStore(
    appConfigStore.subscribe,
    appConfigStore.getSnapshot,
    appConfigStore.getSnapshot,
  );

  return {
    ...snapshot,
    refreshFromCloud: appConfigStore.refreshFromCloud,
  };
}
