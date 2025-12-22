/**
 * Device information utilities for authentication
 */

export interface DeviceInfo {
  device_name: string;
  device_type: string;
  system_type: 'mac' | 'windows';  // Operating system type
}

/**
 * Get device information for the current platform
 */
export function getDeviceInfo(): DeviceInfo {
  const userAgent = navigator.userAgent.toLowerCase();
  
  // Determine device type
  let deviceType = 'desktop';
  if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(userAgent)) {
    deviceType = 'mobile';
  } else if (/tablet|ipad|playbook|silk/i.test(userAgent)) {
    deviceType = 'tablet';
  }
  
  // Get device name (try to detect OS/platform)
  let deviceName = 'Unknown Device';
  if (/windows/i.test(userAgent)) {
    deviceName = 'Windows Device';
  } else if (/macintosh|mac os x/i.test(userAgent)) {
    deviceName = 'Mac Device';
  } else if (/linux/i.test(userAgent)) {
    deviceName = 'Linux Device';
  } else if (/android/i.test(userAgent)) {
    deviceName = 'Android Device';
  } else if (/iphone|ipad|ipod/i.test(userAgent)) {
    deviceName = 'iOS Device';
  }
  
  // Try to get more specific device name if available
  // For Tauri apps, we might be able to get system info
  if (window.__TAURI__) {
    // Tauri-specific device detection could go here
    deviceName = 'Tauri App';
  }
  
  // Detect system type (mac or windows)
  let systemType: 'mac' | 'windows' = 'mac';
  if (/windows/i.test(userAgent)) {
    systemType = 'windows';
  } else if (/macintosh|mac os x/i.test(userAgent)) {
    systemType = 'mac';
  } else {
    // Default to mac for other systems (Linux, etc.)
    systemType = 'mac';
  }
  
  return {
    device_name: deviceName,
    device_type: deviceType,
    system_type: systemType,
  };
}

