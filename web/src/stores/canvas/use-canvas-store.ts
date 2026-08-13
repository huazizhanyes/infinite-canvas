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
type CanvasProjectIndex = { state: { projectIds: string[] }; version?: number };
type PendingCanvasWrite = {
    name: string;
    scopeId: string;
    projectIds: string[];
    projects: Map<string, CanvasProject>;
    deletedIds: Set<string>;
};
export type CanvasPersistenceStatus = "idle" | "pending" | "saving" | "saved" | "error";

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCanvasWrite: PendingCanvasWrite | null = null;
let canvasWriteChain: Promise<void> = Promise.resolve();
let queuedProjects = new Map<string, CanvasProject>();

export const useCanvasPersistenceStatus = create<{ status: CanvasPersistenceStatus; error: string | null }>(() => ({
    status: "idle",
    error: null,
}));

function projectStorageKey(name: string, projectId: string) {
    return `${name}:project:${encodeURIComponent(projectId)}`;
}

function queueCanvasWrite(name: string, value: StorageValue<CanvasStore>) {
    const scopeId = getCanvasStorageScopeId();
    const nextProjects = (value.state as PersistedCanvasState).projects;
    const nextById = new Map(nextProjects.map((project) => [project.id, project]));
    const changedProjects = new Map<string, CanvasProject>();
    const deletedIds = new Set<string>();

    nextById.forEach((project, id) => {
        if (queuedProjects.get(id) !== project) changedProjects.set(id, project);
    });
    queuedProjects.forEach((_project, id) => {
        if (!nextById.has(id)) deletedIds.add(id);
    });
    queuedProjects = nextById;

    if (pendingCanvasWrite?.scopeId === scopeId && pendingCanvasWrite.name === name) {
        changedProjects.forEach((project, id) => pendingCanvasWrite!.projects.set(id, project));
        deletedIds.forEach((id) => {
            pendingCanvasWrite!.projects.delete(id);
            pendingCanvasWrite!.deletedIds.add(id);
        });
        nextById.forEach((_project, id) => pendingCanvasWrite!.deletedIds.delete(id));
        pendingCanvasWrite.projectIds = nextProjects.map((project) => project.id);
    } else {
        pendingCanvasWrite = { name, scopeId, projectIds: nextProjects.map((project) => project.id), projects: changedProjects, deletedIds };
    }
    useCanvasPersistenceStatus.setState({ status: "pending", error: null });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        void flushCanvasPersistence();
    }, 3000);
}

function restoreFailedWrite(write: PendingCanvasWrite) {
    const pending = pendingCanvasWrite as PendingCanvasWrite | null;
    if (!pending) {
        pendingCanvasWrite = write;
        return;
    }
    if (pending.scopeId !== write.scopeId || pending.name !== write.name) return;
    write.projects.forEach((project, id) => {
        if (!pending.projects.has(id) && queuedProjects.get(id) === project) pending.projects.set(id, project);
    });
    write.deletedIds.forEach((id) => {
        if (!queuedProjects.has(id)) pending.deletedIds.add(id);
    });
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
                await Promise.all(
                    [...write.projects].map(([id, project]) =>
                        localForageStorage.setItem(accountScopedKey(projectStorageKey(write.name, id), write.scopeId), JSON.stringify(project)),
                    ),
                );
                const index: CanvasProjectIndex = { state: { projectIds: write.projectIds } };
                await localForageStorage.setItem(accountScopedKey(write.name, write.scopeId), JSON.stringify(index));
                await Promise.all(
                    [...write.deletedIds].map((id) =>
                        localForageStorage.removeItem(accountScopedKey(projectStorageKey(write.name, id), write.scopeId)),
                    ),
                );
            });
        try {
            await canvasWriteChain;
            useCanvasPersistenceStatus.setState({ status: "saved", error: null });
        } catch (error) {
            restoreFailedWrite(write);
            const message = error instanceof Error ? error.message : "画布保存失败";
            useCanvasPersistenceStatus.setState({ status: "error", error: message });
            throw error;
        }
    }
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const scopeId = getCanvasStorageScopeId();
        const value = await localForageStorage.getItem(accountScopedKey(name, scopeId));
        if (!value) {
            queuedProjects = new Map();
            return null;
        }
        const parsed = JSON.parse(value) as CanvasProjectIndex | StorageValue<CanvasStore>;
        const legacyProjects = (parsed.state as Partial<PersistedCanvasState>).projects;
        if (Array.isArray(legacyProjects)) {
            queuedProjects = new Map(legacyProjects.map((project) => [project.id, project]));
            await Promise.all(
                legacyProjects.map((project) =>
                    localForageStorage.setItem(accountScopedKey(projectStorageKey(name, project.id), scopeId), JSON.stringify(project)),
                ),
            );
            const index: CanvasProjectIndex = { state: { projectIds: legacyProjects.map((project) => project.id) } };
            await localForageStorage.setItem(accountScopedKey(name, scopeId), JSON.stringify(index));
            return { state: { projects: legacyProjects } as CanvasStore };
        }

        const projectIds = (parsed as CanvasProjectIndex).state.projectIds || [];
        const projects = (
            await Promise.all(
                projectIds.map(async (id) => {
                    const project = await localForageStorage.getItem(accountScopedKey(projectStorageKey(name, id), scopeId));
                    return project ? (JSON.parse(project) as CanvasProject) : null;
                }),
            )
        ).filter((project): project is CanvasProject => Boolean(project));
        queuedProjects = new Map(projects.map((project) => [project.id, project]));
        return { state: { projects } as CanvasStore };
    },
    setItem: queueCanvasWrite,
    removeItem: async (name) => {
        const scopeId = getCanvasStorageScopeId();
        await Promise.all([
            localForageStorage.removeItem(accountScopedKey(name, scopeId)),
            ...[...queuedProjects.keys()].map((id) => localForageStorage.removeItem(accountScopedKey(projectStorageKey(name, id), scopeId))),
        ]);
        queuedProjects = new Map();
    },
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
    queuedProjects = new Map();
    pendingCanvasWrite = null;
    await useCanvasStore.persist.rehydrate();
}

export function clearCanvasStoreMemory() {
    useCanvasStore.setState({ hydrated: false, projects: [] });
    queuedProjects = new Map();
    pendingCanvasWrite = null;
}
