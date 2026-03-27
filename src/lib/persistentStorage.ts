/**
 * Persistent Storage Utility
 *
 * Provides a unified storage interface that uses Tauri Store in production
 * and falls back to localStorage for development/web environments.
 */

let storeInstance: any = null;
let isTauriAvailable = false;

// Initialize Tauri store if available
const initStore = async () => {
  if (typeof window !== "undefined" && (window as any).__TAURI__) {
    try {
      const { Store } = await import("@tauri-apps/plugin-store");
      storeInstance = await Store.load(".auth.dat");
      isTauriAvailable = true;
      console.log("✅ Using Tauri Store for persistent storage");
      return true;
    } catch (error) {
      console.warn(
        "Failed to initialize Tauri Store, falling back to localStorage:",
        error,
      );
      isTauriAvailable = false;
      return false;
    }
  }
  return false;
};

// Initialize on module load
let initPromise: Promise<boolean> | null = null;
const getStore = async (): Promise<boolean> => {
  if (initPromise === null) {
    initPromise = initStore();
  }
  return initPromise;
};

/**
 * Get a value from persistent storage
 */
export async function getStorageItem(key: string): Promise<string | null> {
  await getStore();

  if (isTauriAvailable && storeInstance) {
    try {
      const value = await storeInstance.get(key);
      return value as string | null;
    } catch (error) {
      console.error(`Failed to get ${key} from Tauri Store:`, error);
      // Fallback to localStorage
      try {
        return localStorage.getItem(key);
      } catch (e) {
        console.error(`Failed to get ${key} from localStorage:`, e);
        return null;
      }
    }
  } else {
    // Fallback to localStorage
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error(`Failed to get ${key} from localStorage:`, error);
      return null;
    }
  }
}

/**
 * Set a value in persistent storage
 */
export async function setStorageItem(
  key: string,
  value: string,
): Promise<void> {
  await getStore();

  if (isTauriAvailable && storeInstance) {
    try {
      await storeInstance.set(key, value);
      await storeInstance.save();
      return;
    } catch (error) {
      console.error(`Failed to set ${key} in Tauri Store:`, error);
      // Fallback to localStorage
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        console.error(`Failed to set ${key} in localStorage:`, e);
      }
      return;
    }
  } else {
    // Fallback to localStorage
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.error(`Failed to set ${key} in localStorage:`, error);
    }
  }
}

/**
 * Remove a value from persistent storage
 */
export async function removeStorageItem(key: string): Promise<void> {
  await getStore();

  if (isTauriAvailable && storeInstance) {
    try {
      await storeInstance.delete(key);
      await storeInstance.save();
      return;
    } catch (error) {
      console.error(`Failed to remove ${key} from Tauri Store:`, error);
      // Fallback to localStorage
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.error(`Failed to remove ${key} from localStorage:`, e);
      }
      return;
    }
  } else {
    // Fallback to localStorage
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Failed to remove ${key} from localStorage:`, error);
    }
  }
}

/**
 * Synchronous version for cases where async is not feasible
 */
export function getStorageItemSync(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.error(`Failed to get ${key} from localStorage (sync):`, error);
    return null;
  }
}

export function setStorageItemSync(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.error(`Failed to set ${key} in localStorage (sync):`, error);
  }
}

export function removeStorageItemSync(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error(`Failed to remove ${key} from localStorage (sync):`, error);
  }
}
