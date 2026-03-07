import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";

export interface UpdateDetails {
    version: string;
    notes: string;
    size_mb: number | null;
    pub_date: string | null;
}

interface UpdaterState {
    update: Update | null;
    updateDetails: UpdateDetails | null;
    isChecking: boolean;
    showModal: boolean;
    patchReady: boolean;
    setUpdate: (update: Update | null, details?: UpdateDetails | null) => void;
    setIsChecking: (isChecking: boolean) => void;
    setPatchReady: (patchReady: boolean) => void;
    openModal: () => void;
    closeModal: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set) => ({
    update: null,
    updateDetails: null,
    isChecking: false,
    showModal: false,
    patchReady: false,
    setUpdate: (update, details = null) => set({ update, updateDetails: details }),
    setIsChecking: (isChecking) => set({ isChecking }),
    setPatchReady: (patchReady) => set({ patchReady }),
    openModal: () => set({ showModal: true }),
    closeModal: () => set({ showModal: false }),
}));
