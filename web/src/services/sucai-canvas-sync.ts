import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

type CloudProjectList = {
    projects?: CanvasProject[];
    deleted?: Array<{ id: string; deletedAt: string }>;
};

type ApiResponse<T> = {
    code?: number;
    data?: T;
    message?: string;
};

type SyncConfig = {
    baseUrl: string;
    token: string;
};

const SAVE_DEBOUNCE = 1500;
const RETRY_DELAY = 10000;

let initialized = false;
let config: SyncConfig | null = null;
let unsubscribe: (() => void) | null = null;
let previousProjects = new Map<string, CanvasProject>();
let pendingProjects = new Map<string, CanvasProject>();
let pendingDeletes = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<boolean> | null = null;
let applyingRemoteState = false;

export async function initializeSucaiCanvasSync(nextConfig: SyncConfig) {
    if (initialized) return;
    initialized = true;
    config = nextConfig;
    await waitForCanvasHydration();

    const localProjects = useCanvasStore.getState().projects;
    const remoteData = await readRemoteProjects().catch((error) => {
        console.warn("[SucaiCanvasSync] load failed; keeping local data", error);
        return null;
    });
    const mergedProjects = remoteData ? mergeProjects(localProjects, remoteData) : localProjects;

    applyingRemoteState = true;
    useCanvasStore.getState().replaceProjects(mergedProjects);
    applyingRemoteState = false;
    previousProjects = new Map(mergedProjects.map((project) => [project.id, project]));

    const remoteProjects = new Map((remoteData?.projects || []).map((project) => [project.id, project]));
    mergedProjects.forEach((project) => {
        const remote = remoteProjects.get(project.id);
        if (!remote || projectTime(project) > projectTime(remote)) pendingProjects.set(project.id, project);
    });

    unsubscribe = useCanvasStore.subscribe((state) => {
        if (applyingRemoteState) return;
        const nextProjects = new Map(state.projects.map((project) => [project.id, project]));
        previousProjects.forEach((_project, id) => {
            if (!nextProjects.has(id)) {
                pendingProjects.delete(id);
                pendingDeletes.add(id);
            }
        });
        nextProjects.forEach((project, id) => {
            const previous = previousProjects.get(id);
            if (!previous || previous.updatedAt !== project.updatedAt) {
                pendingDeletes.delete(id);
                pendingProjects.set(id, project);
            }
        });
        previousProjects = nextProjects;
        scheduleFlush(SAVE_DEBOUNCE);
    });

    if (pendingProjects.size) scheduleFlush(SAVE_DEBOUNCE);
    if (!remoteData) scheduleRemoteReload();
}

export async function stopSucaiCanvasSync() {
    const saved = await flushSucaiCanvasSync();
    unsubscribe?.();
    unsubscribe = null;
    initialized = false;
    config = null;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = null;
    return saved;
}

export async function syncSucaiCanvasProject(projectId: string) {
    if (!config) throw new Error("素材网画布同步尚未初始化");
    await waitForCanvasHydration();
    const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
    if (!project) throw new Error("当前画布不存在");
    await apiRequest(`/v1/projects/${encodeURIComponent(project.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project }),
    });
    pendingProjects.delete(project.id);
}

function mergeProjects(localProjects: CanvasProject[], remoteData: CloudProjectList) {
    const deletedAt = new Map((remoteData.deleted || []).map((item) => [item.id, Date.parse(item.deletedAt) || 0]));
    const merged = new Map<string, CanvasProject>();
    (remoteData.projects || []).forEach((project) => merged.set(project.id, project));
    localProjects.forEach((project) => {
        const deletedTime = deletedAt.get(project.id) || 0;
        if (deletedTime >= projectTime(project)) {
            merged.delete(project.id);
            return;
        }
        const remote = merged.get(project.id);
        if (!remote || projectTime(project) >= projectTime(remote)) merged.set(project.id, project);
    });
    return [...merged.values()].sort((a, b) => projectTime(b) - projectTime(a));
}

async function readRemoteProjects() {
    const response = await apiRequest<ApiResponse<CloudProjectList>>("/v1/projects");
    return response.data || { projects: [], deleted: [] };
}

function scheduleFlush(delay: number) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushSucaiCanvasSync();
    }, delay);
}

export async function flushSucaiCanvasSync(): Promise<boolean> {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (!config || (!pendingDeletes.size && !pendingProjects.size)) return true;
    if (flushPromise) {
        const saved = await flushPromise;
        if (!saved) return false;
        return flushSucaiCanvasSync();
    }

    const currentFlush = flushPendingChanges();
    flushPromise = currentFlush;
    try {
        const saved = await currentFlush;
        if (!saved) return false;
    } finally {
        if (flushPromise === currentFlush) flushPromise = null;
    }
    return pendingDeletes.size || pendingProjects.size ? flushSucaiCanvasSync() : true;
}

async function flushPendingChanges(): Promise<boolean> {
    if (!config) return false;
    const deletes = [...pendingDeletes];
    const projects = [...pendingProjects.values()];
    let saved = true;
    deletes.forEach((id) => pendingDeletes.delete(id));
    projects.forEach((project) => pendingProjects.delete(project.id));

    await Promise.all([
        ...deletes.map(async (id) => {
            try {
                await apiRequest(`/v1/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
            } catch (error) {
                saved = false;
                if (!useCanvasStore.getState().projects.some((project) => project.id === id)) pendingDeletes.add(id);
                console.warn("[SucaiCanvasSync] delete failed", { id, error });
            }
        }),
        ...projects.map(async (project) => {
            try {
                const response = await apiRequest<ApiResponse<{ project?: CanvasProject; conflict?: boolean; deleted?: boolean }>>(`/v1/projects/${encodeURIComponent(project.id)}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ project }),
                });
                if (response.data?.conflict && response.data.deleted) applyRemoteDeletion(project.id);
                else if (response.data?.conflict && response.data.project) applyRemoteProject(response.data.project);
            } catch (error) {
                saved = false;
                const current = useCanvasStore.getState().projects.find((item) => item.id === project.id);
                if (current) queueProject(current);
                console.warn("[SucaiCanvasSync] save failed", { id: project.id, error });
            }
        }),
    ]);

    if (pendingDeletes.size || pendingProjects.size) scheduleFlush(RETRY_DELAY);
    return saved;
}

function queueProject(project: CanvasProject) {
    const queued = pendingProjects.get(project.id);
    if (!queued || projectTime(project) >= projectTime(queued)) pendingProjects.set(project.id, project);
}

function scheduleRemoteReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
        reloadTimer = null;
        void reloadRemoteProjects();
    }, RETRY_DELAY);
}

async function reloadRemoteProjects() {
    if (!initialized) return;
    try {
        const remoteData = await readRemoteProjects();
        const currentProjects = useCanvasStore.getState().projects;
        const mergedProjects = mergeProjects(currentProjects, remoteData);
        applyingRemoteState = true;
        useCanvasStore.getState().replaceProjects(mergedProjects);
        applyingRemoteState = false;
        previousProjects = new Map(mergedProjects.map((project) => [project.id, project]));
        const remoteProjects = new Map((remoteData.projects || []).map((project) => [project.id, project]));
        mergedProjects.forEach((project) => {
            const remote = remoteProjects.get(project.id);
            if (!remote || projectTime(project) > projectTime(remote)) queueProject(project);
        });
        if (pendingProjects.size) scheduleFlush(SAVE_DEBOUNCE);
    } catch (error) {
        console.warn("[SucaiCanvasSync] reload failed", error);
        scheduleRemoteReload();
    }
}

function applyRemoteProject(project: CanvasProject) {
    const projects = useCanvasStore.getState().projects;
    const current = projects.find((item) => item.id === project.id);
    if (current && projectTime(current) >= projectTime(project)) return;
    const next = [project, ...projects.filter((item) => item.id !== project.id)].sort((a, b) => projectTime(b) - projectTime(a));
    applyingRemoteState = true;
    useCanvasStore.getState().replaceProjects(next);
    applyingRemoteState = false;
    previousProjects = new Map(next.map((item) => [item.id, item]));
}

function applyRemoteDeletion(id: string) {
    const next = useCanvasStore.getState().projects.filter((item) => item.id !== id);
    applyingRemoteState = true;
    useCanvasStore.getState().replaceProjects(next);
    applyingRemoteState = false;
    previousProjects = new Map(next.map((item) => [item.id, item]));
}

async function apiRequest<T = unknown>(path: string, init: RequestInit = {}) {
    if (!config) throw new Error("素材网画布同步尚未初始化");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${config.token}`);
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}${path}`, {
        ...init,
        headers,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || payload?.error?.message || `画布同步失败 (${response.status})`);
    return payload as T;
}

function waitForCanvasHydration() {
    if (useCanvasStore.getState().hydrated) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const stop = useCanvasStore.subscribe((state) => {
            if (!state.hydrated) return;
            stop();
            resolve();
        });
    });
}

function projectTime(project: CanvasProject) {
    return Date.parse(project.updatedAt) || 0;
}
