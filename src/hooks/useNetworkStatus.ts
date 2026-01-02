/**
 * Network Status Hook
 *
 * Monitors network connectivity and provides status to components
 */

import { useState, useEffect, useCallback } from "react";
import { checkNetworkConnectivity } from "../lib/networkUtils";
import type { NetworkStatus } from "../types";

/**
 * Hook to monitor network connectivity status
 */
export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isChecking, setIsChecking] = useState<boolean>(false);

  const checkStatus = useCallback(async () => {
    setIsChecking(true);
    try {
      const online = await checkNetworkConnectivity();
      setIsOnline(online);
    } catch (error) {
      setIsOnline(false);
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Check on mount
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Verify with actual connectivity check
      checkStatus();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [checkStatus]);

  return {
    isOnline,
    isChecking,
    retry: checkStatus,
  };
}
