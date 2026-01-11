/**
 * Secure Storage Utility
 *
 * Provides secure storage for authentication tokens using OS keychain
 * via Tauri commands from commands/auth.rs. This is much more secure than localStorage or Tauri Store.
 *
 * All functions in this module call Tauri commands:
 * - store_auth_data: Stores auth data in secure storage
 * - get_auth_data: Retrieves auth data from secure storage
 * - clear_auth_data: Clears auth data from secure storage
 * - has_auth_data: Checks if auth data exists in secure storage
 *
 * On macOS: Uses Keychain
 * On Windows: Uses Credential Manager
 * On Linux: Uses Secret Service
 * In dev mode: Uses Tauri Store (to avoid keychain prompts)
 */

import { invoke } from "@tauri-apps/api/core";

import type { AuthData } from "../types";

/**
 * Store authentication data securely in OS keychain
 */
export async function storeAuthDataSecure(data: AuthData): Promise<void> {
  try {
    await invoke("store_auth_data", {
      data: {
        access_token: data.access_token,
        refresh_token: data.refresh_token || null,
        expires_at: data.expires_at || null,
        expires_in: data.expires_in || null,
        user: data.user
          ? {
              id: data.user.id,
              email: data.user.email,
              name: data.user.name,
              picture: data.user.picture || null,
            }
          : null,
      },
    });
    console.log("✅ Auth data stored securely in OS keychain");
  } catch (error) {
    console.error("Failed to store auth data securely:", error);
    throw error;
  }
}

/**
 * Retrieve authentication data from OS keychain
 */
export async function getAuthDataSecure(): Promise<AuthData | null> {
  try {
    const data = await invoke<AuthData | null>("get_auth_data");
    return data;
  } catch (error) {
    console.error("Failed to retrieve auth data securely:", error);
    return null;
  }
}

/**
 * Clear all authentication data from OS keychain
 */
export async function clearAuthDataSecure(): Promise<void> {
  try {
    await invoke("clear_auth_data");
    console.log("✅ Auth data cleared from OS keychain");
  } catch (error) {
    console.error("Failed to clear auth data securely:", error);
    throw error;
  }
}

/**
 * Check if authentication data exists in keychain
 */
export async function hasAuthDataSecure(): Promise<boolean> {
  try {
    const hasData = await invoke<boolean>("has_auth_data");
    return hasData;
  } catch (error) {
    console.error("Failed to check auth data:", error);
    return false;
  }
}
