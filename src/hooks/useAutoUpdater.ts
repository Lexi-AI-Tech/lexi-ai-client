import { useEffect, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { useUpdaterStore, type UpdateDetails } from "../store/updaterStore";

// Check for updates every 4 hours
const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Fetches extended update metadata (size, notes) from our own backend API.
 * This is a lightweight DB query - no signed URL generation.
 */
export async function checkUpdateDetails(): Promise<UpdateDetails | null> {
    try {
        const version = await getVersion();
        const baseUrl = import.meta.env.VITE_API_BASE_URL;
        const url = `${baseUrl}/api/v1/updates/check?version=${version}&target=darwin`;

        const response = await fetch(url);

        if (response.status === 204 || !response.ok) {
            return null;
        }

        return (await response.json()) as UpdateDetails;
    } catch (e) {
        console.error("Failed to fetch update details:", e);
        return null;
    }
}

/**
 * Returns true if the version bump is only a patch (e.g. 0.1.4 → 0.1.5).
 */
function isPatchUpdate(currentVersion: string, newVersion: string): boolean {
    const cur = currentVersion.split(".").map(Number);
    const next = newVersion.split(".").map(Number);
    return cur[0] === next[0] && cur[1] === next[1] && next[2] > cur[2];
}

/**
 * Background hook that periodically checks for updates.
 * - Patch updates (0.1.4 → 0.1.5): auto-download & install silently
 * - Minor/Major updates (0.1.x → 0.2.0): show sidebar banner, user decides
 */
export function useAutoUpdater() {
    const setUpdate = useUpdaterStore((state) => state.setUpdate);
    const setIsChecking = useUpdaterStore((state) => state.setIsChecking);
    const updateChecked = useRef(false);

    useEffect(() => {
        // Skip auto-updates in dev mode — no installed bundle to update
        if (import.meta.env.DEV) {
            console.log("⏭️ Auto-updater skipped (dev mode)");
            return;
        }

        let intervalId: ReturnType<typeof setInterval>;

        const checkForUpdates = async () => {
            try {
                setIsChecking(true);
                const update = await check();

                if (update) {
                    const currentVersion = await getVersion();
                    const details = await checkUpdateDetails();

                    if (isPatchUpdate(currentVersion, update.version)) {
                        // Patch: auto-download silently in the background
                        console.log(`🔄 Auto-downloading patch v${update.version}...`);
                        await update.downloadAndInstall();
                        console.log(`✅ Patch v${update.version} installed — restarting...`);
                        await relaunch();
                    } else {
                        // Minor/Major: store for sidebar banner, user decides
                        setUpdate(update, details);
                    }
                }
            } catch (error) {
                console.error("Background auto-updater failed:", error);
            } finally {
                setIsChecking(false);
            }
        };

        if (!updateChecked.current) {
            updateChecked.current = true;
            setTimeout(() => {
                checkForUpdates();
                intervalId = setInterval(checkForUpdates, UPDATE_INTERVAL_MS);
            }, 5000);
        }

        return () => clearInterval(intervalId);
    }, [setUpdate, setIsChecking]);
}
