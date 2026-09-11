import { create } from "zustand";

import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type CanvasClipboardPayload = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    sourceProjectId: string;
    createdAt: number;
};

type CanvasClipboardStore = {
    clipboard: CanvasClipboardPayload | null;
    setClipboard: (payload: Omit<CanvasClipboardPayload, "createdAt">) => void;
    clearClipboard: () => void;
};

export const useCanvasClipboardStore = create<CanvasClipboardStore>((set) => ({
    clipboard: null,
    setClipboard: (payload) => set({ clipboard: { ...payload, createdAt: Date.now() } }),
    clearClipboard: () => set({ clipboard: null }),
}));

export function getCanvasClipboard() {
    return useCanvasClipboardStore.getState().clipboard;
}

export function clearCanvasClipboardMemory() {
    useCanvasClipboardStore.setState({ clipboard: null });
}