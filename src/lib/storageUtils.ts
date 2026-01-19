/**
 * Storage Utilities
 *
 * Helper functions for managing storage
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Clear only authentication data from secure storage
 */
export async function clearAuthStorage(): Promise<void> {
  try {
    await invoke("clear_auth_data");
    console.log("✅ Auth storage cleared");
  } catch (e) {
    console.error("Failed to clear auth storage:", e);
    throw e;
  }
}
