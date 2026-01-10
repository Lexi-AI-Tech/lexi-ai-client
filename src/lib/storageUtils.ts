/**
 * Storage Utilities
 *
 * Helper functions for managing localStorage (non-auth data)
 */

import { clearAuthDataSecure } from "./secureStorage";

/**
 * Clear only authentication data from secure storage
 */
export async function clearAuthStorage(): Promise<void> {
  try {
    await clearAuthDataSecure();
    console.log("✅ Auth storage cleared from secure storage");
  } catch (e) {
    console.error("Failed to clear auth storage:", e);
    throw e;
  }
}
