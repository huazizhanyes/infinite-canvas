import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import { accountScopedKey } from "@/lib/canvas-account-scope";

export type CanvasHostTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type CanvasHostTask = {
    id: string;
    projectId: string;
    projectTitle: string;
    nodeId: string;
    title: string;
    stage: string;
    status: CanvasHostTaskStatus;
    progress?: number;
    error?: string;
    createdAt: string;
    updatedAt: string;
};

type CanvasHostTaskStore = {
    tasks: CanvasHostTask[];
    startTask: (task: Omit<CanvasHostTask, "status" | "createdAt" | "updatedAt">) => void;
    updateTask: (id: string, patch: Partial<Pick<CanvasHostTask, "stage" | "progress" | "status" | "error">>) => void;
    finishTask: (id: string, status: Exclude<CanvasHostTaskStatus, "queued" | "running">, error?: string) => void;
};

export const useCanvasHostTaskStore = create<CanvasHostTaskStore>()(
    persist(
        (set) => ({
            tasks: [],
            startTask: (task) => {
                const now = new Date().toISOString();
                set((state) => ({
                    tasks: [
                        { ...task, status: "running" as const, createdAt: now, updatedAt: now },
                        ...state.tasks.filter((item) => item.id !== task.id),
                    ].slice(0, 30),
                }));
            },
            updateTask: (id, patch) => set((state) => ({
                tasks: state.tasks.map((task) => task.id === id ? { ...task, ...patch, updatedAt: new Date().toISOString() } : task),
            })),
            finishTask: (id, status, error) => set((state) => ({
                tasks: state.tasks.map((task) => task.id === id
                    ? { ...task, status, error, progress: status === "succeeded" ? 100 : task.progress, updatedAt: new Date().toISOString() }
                    : task),
            })),
        }),
        {
            name: "infinite-canvas:desktop-task-snapshots",
            storage: createJSONStorage(() => ({
                getItem: (name) => localForageStorage.getItem(accountScopedKey(name)),
                setItem: (name, value) => localForageStorage.setItem(accountScopedKey(name), value),
                removeItem: (name) => localForageStorage.removeItem(accountScopedKey(name)),
            })),
            partialize: (state) => ({ tasks: state.tasks }),
        },
    ),
);

export async function rehydrateCanvasHostTaskStoreForAccount() {
    useCanvasHostTaskStore.setState({ tasks: [] });
    await useCanvasHostTaskStore.persist.rehydrate();
}

export function clearCanvasHostTaskStoreMemory() {
    useCanvasHostTaskStore.setState({ tasks: [] });
}
