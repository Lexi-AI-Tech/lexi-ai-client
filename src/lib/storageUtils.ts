/**
 * Storage Utilities
 *
 * Helper functions for managing localStorage (non-auth data)
 * Note: Auth data is now stored in OS keychain via secure storage
 */

/**
 * Clear all Lexi AI related localStorage data (non-auth)
 */
export function clearAllStorage(): void {
  try {
    localStorage.removeItem("lexi-onboarding");
    console.log("✅ All localStorage cleared");
  } catch (e) {
    console.error("Failed to clear localStorage:", e);
    throw e;
  }
}

/**
 * Clear only authentication data from secure storage
 */
export async function clearAuthStorage(): Promise<void> {
  try {
    const { clearAuthDataSecure } = await import("./secureStorage");
    await clearAuthDataSecure();
    console.log("✅ Auth storage cleared from secure storage");
  } catch (e) {
    console.error("Failed to clear auth storage:", e);
    throw e;
  }
}

/**
 * Clear only onboarding data
 */
export function clearOnboardingStorage(): void {
  try {
    localStorage.removeItem("lexi-onboarding");
    console.log("✅ Onboarding storage cleared");
  } catch (e) {
    console.error("Failed to clear onboarding storage:", e);
    throw e;
  }
}

/**
 * Get all Lexi AI storage keys and their values (for debugging)
 * Note: Auth data is stored in OS keychain, not localStorage
 */
export async function getAllStorage(): Promise<Record<string, any>> {
  const storage: Record<string, any> = {};

  try {
    // Check secure storage for auth data
    const { getAuthDataSecure } = await import("./secureStorage");
    const authData = await getAuthDataSecure();
    if (authData) {
      storage["lexi-auth"] = authData;
    }

    const onboarding = localStorage.getItem("lexi-onboarding");
    if (onboarding) {
      storage["lexi-onboarding"] = JSON.parse(onboarding);
    }
  } catch (e) {
    console.error("Failed to read storage:", e);
  }

  return storage;
}
