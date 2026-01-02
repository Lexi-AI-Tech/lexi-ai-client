/**
 * Device information utilities for authentication
 */

import { invoke } from "@tauri-apps/api/core";

import type { DeviceInfo } from "../types";

/**
 * Get device information for the current platform
 */
export async function getDeviceInfo(): Promise<DeviceInfo> {
  const userAgent = navigator.userAgent.toLowerCase();

  // Determine device type
  let deviceType = "desktop";
  if (
    /mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(userAgent)
  ) {
    deviceType = "mobile";
  } else if (/tablet|ipad|playbook|silk/i.test(userAgent)) {
    deviceType = "tablet";
  }

  // Get device name (try to detect OS/platform)
  let deviceName = "Unknown Device";
  if (/windows/i.test(userAgent)) {
    deviceName = "Windows Device";
  } else if (/macintosh|mac os x/i.test(userAgent)) {
    deviceName = "Mac Device";
  } else if (/linux/i.test(userAgent)) {
    deviceName = "Linux Device";
  } else if (/android/i.test(userAgent)) {
    deviceName = "Android Device";
  } else if (/iphone|ipad|ipod/i.test(userAgent)) {
    deviceName = "iOS Device";
  }

  // Try to get more specific device name if available
  // For Tauri apps, we might be able to get system info
  if (typeof window !== "undefined" && (window as any).__TAURI__) {
    // Tauri-specific device detection could go here
    deviceName = "Tauri App";
  }

  // Detect system type using Rust utility
  const systemType = await invoke<string>("get_system_type");
  if (
    systemType !== "mac" &&
    systemType !== "windows" &&
    systemType !== "unknown"
  ) {
    throw new Error(`Invalid system type returned from Rust: ${systemType}`);
  }

  return {
    device_name: deviceName,
    device_type: deviceType,
    system_type: systemType,
  };
}
