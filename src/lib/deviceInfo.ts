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

  const systemType = await invoke<string>("get_system_type");
  if (
    systemType !== "mac" &&
    systemType !== "windows" &&
    systemType !== "unknown"
  ) {
    throw new Error(`Invalid system type: ${systemType}`);
  }

  return {
    device_type: deviceType,
    system_type: systemType,
  };
}
