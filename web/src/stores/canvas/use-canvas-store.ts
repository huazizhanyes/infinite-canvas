import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { accountScopedKey, getCanvasStorageScopeId } from "@/lib/canvas-account-scope";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    detailLoaded?: true;
    localDirty?: boolean;
    legacyCached?: boolean;
    /** 原项目冲突时保留完整正文，并持续更新这个本地副本。 */
    localConflictCopyId?: string;
    localConflictSourceProjectId?: string;
    serverVersion?: number;
    serverUpdatedAt?: string;
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
    debugReadOnly?: boolean;
    debugSessionId?: string;
    debugSourceUserId?: string;
    debugSourceProjectId?: string;
};
export type CanvasProjectSummary = Pick<CanvasProject, "id" | "title" | "createdAt" | "updatedAt" | "serverVersion" | "serverUpdatedAt" | "localDirty" | "legacyCached" | "debugReadOnly"> & { detailLoaded: false };
export type CanvasProjectEntry = CanvasProject | CanvasProjectSummary;
export function isCanvasProjectLoaded(project: CanvasProjectEntry): project is CanvasProject { return project.detailLoaded !== false; }
export function canvasProjectSummary(project: CanvasProjectEntry): CanvasProjectSummary {
    const { id, title, createdAt, updatedAt, serverVersion, serverUpdatedAt, localDirty, legacyCached, debugReadOnly } = project;
    return { id, title, createdAt, updatedAt, serverVersion, serverUpdatedAt, localDirty, legacyCached, debugReadOnly, detailLoaded: false };
}

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProjectEntry[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProjectEntry[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
type CanvasProjectIndex = { state: { projectIds: string[]; directory?: CanvasProjectSummary[] }; version?: number };
type PendingCanvasWrite = {
    name: string;
    scopeId: string;
    projectIds: string[];
    directory: CanvasProjectSummary[];
    projects: Map<string, CanvasProject>;
    deletedIds: Set<string>;
};
export type CanvasPersistenceStatus = "idle" | "pending" | "saving" | "saved" | "error";

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCanvasWrite: PendingCanvasWrite | null = null;
let canvasWriteChain: Promise<void> = Promise.resolve();
let queuedProjects = new Map<string, CanvasProjectEntry>();

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
        if (isCanvasProjectLoaded(project) && queuedProjects.get(id) !== project) changedProjects.set(id, project);
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
        pendingCanvasWrite.directory = nextProjects.map(canvasProjectSummary);
    } else {
        pendingCanvasWrite = { name, scopeId, projectIds: nextProjects.map((project) => project.id), directory: nextProjects.map(canvasProjectSummary), projects: changedProjects, deletedIds };
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
                const index: CanvasProjectIndex = { state: { projectIds: write.projectIds, directory: write.directory } };
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
    // 另一个调用可能已取走 pending，但其持久化仍在执行，提交任务前也必须等待。
    await canvasWriteChain;
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
        const legacyProjects = (parsed.state as { projects?: CanvasProject[] }).projects;
        if (Array.isArray(legacyProjects)) {
            queuedProjects = new Map(legacyProjects.map((project) => [project.id, project]));
            await Promise.all(
                legacyProjects.map((project) =>
                    localForageStorage.setItem(accountScopedKey(projectStorageKey(name, project.id), scopeId), JSON.stringify(project)),
                ),
            );
            const index: CanvasProjectIndex = { state: { projectIds: legacyProjects.map((project) => project.id), directory: legacyProjects.map(project => ({ ...canvasProjectSummary(project), legacyCached: project.serverVersion == null })) } };
            await localForageStorage.setItem(accountScopedKey(name, scopeId), JSON.stringify(index));
            return { state: { projects: index.state.directory } as CanvasStore };
        }
        const directory = (parsed as CanvasProjectIndex).state.directory;
        if (directory) {
            queuedProjects = new Map(directory.map(project => [project.id, project]));
            return { state: { projects: directory } as CanvasStore };
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
        const summaries = projects.map(project => ({ ...canvasProjectSummary(project), legacyCached: project.serverVersion == null }));
        await localForageStorage.setItem(accountScopedKey(name, scopeId), JSON.stringify({ state: { projectIds, directory: summaries } }));
        return { state: { projects: summaries } as CanvasStore };
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
                    localDirty: true,
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
                    nodes: (source.nodes || []).map((node) => {
                        if (!["asset-extraction", "script-asset"].includes(node.type)) return node;
                        const metadata = { ...(node.metadata || {}) };
                        if (node.type === "asset-extraction") {
                            delete metadata.scriptSetId;
                            delete metadata.scriptSetNodeId;
                            delete metadata.assetExtractionEpisodeId;
                            metadata.scriptSetRecoveryPending = true;
                        } else {
                            delete metadata.scriptSetId;
                            delete metadata.scriptSetNodeId;
                            delete metadata.scriptAssetId;
                            delete metadata.scriptVariantId;
                            delete metadata.assetExtractionNodeId;
                        }
                        return { ...node, metadata };
                    }),
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                    debugReadOnly: source.debugReadOnly,
                    debugSessionId: source.debugSessionId,
                    debugSourceUserId: source.debugSourceUserId,
                    debugSourceProjectId: source.debugSourceProjectId,
                    localDirty: true,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                const project = get().projects.find((item) => item.id === id);
                return project && isCanvasProjectLoaded(project) ? project : null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, localDirty: true, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    return { projects };
                }),
            replaceProjects: (projects) => set({ projects }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id && isCanvasProjectLoaded(project) ? { ...project, ...patch, localDirty: true, updatedAt: new Date().toISOString() } : project)),
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
    await flushCanvasPersistence();
    queuedProjects = new Map();
    pendingCanvasWrite = null;
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
