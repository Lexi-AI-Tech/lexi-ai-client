/**
 * Network Utilities
 * 
 * Provides network connectivity checks and retry logic for API calls
 */

/**
 * Check if network is available by attempting a lightweight fetch
 */
export async function checkNetworkConnectivity(): Promise<boolean> {
  try {
    // Try to fetch a small resource to check connectivity
    // Using a small timeout to fail fast if offline
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetch("https://www.google.com/favicon.ico", {
      method: "HEAD",
      mode: "no-cors",
      signal: controller.signal,
      cache: "no-cache",
    });
    
    clearTimeout(timeoutId);
    return true;
  } catch (error) {
    // Network error - likely offline
    return false;
  }
}

/**
 * Wait for network to be available with retries
 * @param maxRetries Maximum number of retries
 * @param delayMs Delay between retries in milliseconds
 */
export async function waitForNetwork(
  maxRetries: number = 5,
  delayMs: number = 1000
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    const isOnline = await checkNetworkConnectivity();
    if (isOnline) {
      return true;
    }
    
    if (i < maxRetries - 1) {
      // Wait before retrying (exponential backoff)
      const delay = delayMs * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  
  return false;
}

/**
 * Add a startup delay to give network time to connect
 * This is useful on auto-startup when network might not be ready
 */
export async function waitForStartupDelay(delayMs: number = 2000): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

