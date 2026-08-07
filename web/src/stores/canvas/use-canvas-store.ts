import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { accountScopedKey, getCanvasStorageScopeId } from "@/lib/canvas-account-scope";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
type PendingCanvasWrite = { name: string; value: StorageValue<CanvasStore>; scopeId: string };
export type CanvasPersistenceStatus = "idle" | "pending" | "saving" | "saved" | "error";

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let pendingCanvasWrite: PendingCanvasWrite | null = null;
let canvasWriteChain: Promise<void> = Promise.resolve();

export const useCanvasPersistenceStatus = create<{ status: CanvasPersistenceStatus; error: string | null }>(() => ({
    status: "idle",
    error: null,
}));

function queueCanvasWrite(name: string, value: StorageValue<CanvasStore>) {
    pendingCanvasWrite = { name, value, scopeId: getCanvasStorageScopeId() };
    useCanvasPersistenceStatus.setState({ status: "pending", error: null });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        void flushCanvasPersistence();
    }, 3000);
}

export async function flushCanvasPersistence() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;

    while (pendingCanvasWrite) {
        const write = pendingCanvasWrite;
        pendingCanvasWrite = null;
        if (write.scopeId !== getCanvasStorageScopeId()) continue;
        useCanvasPersistenceStatus.setState({ status: "saving", error: null });
        canvasWriteChain = canvasWriteChain
            .catch(() => undefined)
            .then(async () => {
                await localForageStorage.setItem(accountScopedKey(write.name, write.scopeId), JSON.stringify(write.value));
            });
        try {
            await canvasWriteChain;
            useCanvasPersistenceStatus.setState({ status: "saved", error: null });
        } catch (error) {
            pendingCanvasWrite ||= write;
            const message = error instanceof Error ? error.message : "画布保存失败";
            useCanvasPersistenceStatus.setState({ status: "error", error: message });
            throw error;
        }
    }
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(accountScopedKey(name));
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        queueCanvasWrite(name, value);
    },
    removeItem: (name) => localForageStorage.removeItem(accountScopedKey(name)),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            createProject: (title = "未命名画布") => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    return { projects };
                }),
            replaceProjects: (projects) => set({ projects }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);

export async function rehydrateCanvasStoreForAccount() {
    useCanvasStore.setState({ hydrated: false, projects: [] });
    queuedPersistState = null;
    pendingCanvasWrite = null;
    await useCanvasStore.persist.rehydrate();
}

export function clearCanvasStoreMemory() {
    useCanvasStore.setState({ hydrated: false, projects: [] });
    queuedPersistState = null;
    pendingCanvasWrite = null;
}
