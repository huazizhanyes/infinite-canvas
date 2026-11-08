import { create } from "zustand";
import { useCanvasStore, isCanvasProjectLoaded, type CanvasProject, type CanvasProjectEntry, type CanvasProjectSummary } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { accountScopedKey, getCanvasAccountScope, getCanvasSessionEpoch } from "@/lib/canvas-account-scope";
import { localForageStorage } from "@/lib/localforage-storage";
import { serializeCanvasProjectForCloud } from "@/lib/canvas/canvas-cloud-serialization";

type SyncConfig = { baseUrl: string; token: string; userId?: string; sessionEpoch?: number };
type DirectoryPage = { projects: CanvasProjectSummary[]; deleted: Array<{ id: string; deletedAt: string }>; nextCursor: string | null };
type SaveResult = { metadata?: (Pick<CanvasProjectSummary, "id"> & Partial<CanvasProjectSummary>) | null; conflict?: boolean; deleted?: boolean };
const SIGNAL = "canvas:project-updated";
let config: SyncConfig | null = null;
let unsubscribe: (() => void) | null = null;
let applying = false, remoteReady = false, failures = 0;
let pending = new Map<string, CanvasProjectEntry>();
let deletes = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<boolean> | null = null;
let reloadPromise: Promise<void> | null = null;
const loads = new Map<string, Promise<CanvasProject>>();
export const useCanvasDirectoryStatus = create<{ loading: boolean; error: string; conflict: string }>(() => ({ loading: false, error: "", conflict: "" }));
function valid(session: SyncConfig) { return config === session && session.sessionEpoch === getCanvasSessionEpoch(); }
function isConflictCopy(project: Pick<CanvasProjectEntry, "title">) { return project.title.endsWith("（本地冲突副本）"); }
function replace(projects: CanvasProjectEntry[]) {
    applying = true;
    try { useCanvasStore.getState().replaceProjects(projects); } finally { applying = false; }
}
function put(project: CanvasProjectEntry) {
    replace([project, ...useCanvasStore.getState().projects.filter(item => item.id !== project.id)].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
}
async function request<T>(session: SyncConfig, path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.method === "PUT" ? 45000 : 15000);
    try {
        const response = await fetch(`${session.baseUrl.replace(/\/+$/, "")}${path}`, { ...init, signal: controller.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}`, ...init.headers } });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.message || `画布请求失败 (${response.status})`);
        if (!valid(session)) throw new Error("账号已切换，已忽略旧请求");
        return body.data as T;
    } finally { clearTimeout(timer); }
}
async function persistOutbox(session = config) {
    if (!session?.userId || !valid(session)) return;
    await localForageStorage.setItem(accountScopedKey("canvas_outbox", session.userId), JSON.stringify({ projects: [...pending.values()], deletes: [...deletes] }));
}
function scheduleSave(delay = 3000) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; void flushSucaiCanvasSync(); }, delay);
}
function scheduleReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { reloadTimer = null; void reloadRemoteProjects(); }, Math.min(60000, 15000 * 2 ** failures));
}
export async function initializeSucaiCanvasSync(next: SyncConfig) {
    if (config?.token === next.token && config?.userId === next.userId) return;
    if (config) await stopSucaiCanvasSync();
    const scope = getCanvasAccountScope();
    const session = config = { ...next, userId: next.userId || scope?.userId, sessionEpoch: next.sessionEpoch ?? getCanvasSessionEpoch() };
    pending = new Map(); deletes = new Set(); remoteReady = false;
    const raw = await localForageStorage.getItem(accountScopedKey("canvas_outbox", session.userId));
    if (!valid(session)) return;
    if (raw) {
        try {
            const data = JSON.parse(raw);
            for (const project of data.projects || []) if (!isConflictCopy(project)) pending.set(project.id, { ...project, localDirty: true });
            deletes = new Set(data.deletes || []);
            const entries = new Map(useCanvasStore.getState().projects.map(project => [project.id, project]));
            for (const [id, project] of pending) if (!entries.get(id)?.localDirty || Date.parse(project.updatedAt) >= Date.parse(entries.get(id)!.updatedAt)) entries.set(id, project);
            for (const id of deletes) entries.delete(id);
            replace([...entries.values()]);
        }
        catch { useCanvasDirectoryStatus.setState({ error: "本地待同步记录读取失败，已保留本地画布" }); }
    }
    unsubscribe = useCanvasStore.subscribe((state, previous) => {
        if (applying || !valid(session) || !state.hydrated) return;
        const before = new Map(previous.projects.map(p => [p.id, p]));
        const after = new Set(state.projects.map(p => p.id));
        for (const old of previous.projects) if (!after.has(old.id) && !old.debugReadOnly) { pending.delete(old.id); deletes.add(old.id); }
        for (const project of state.projects) {
            if (isConflictCopy(project)) continue;
            const old = before.get(project.id);
            if (!project.debugReadOnly && project.localDirty && (!old || old.updatedAt !== project.updatedAt)) { pending.set(project.id, project); deletes.delete(project.id); }
        }
        void persistOutbox(session).catch(console.warn); scheduleSave();
    });
    window.addEventListener("storage", externalUpdate);
    void reloadRemoteProjects();
}
function externalUpdate(event: StorageEvent) {
    if (event.key !== SIGNAL || !event.newValue) return;
    try { const id = JSON.parse(event.newValue)?.id; if (id) useCanvasUiStore.getState().setExternalUpdate(id); } catch { /* ignore malformed signal */ }
    void reloadRemoteProjects();
}
async function reloadRemoteProjects() {
    if (!config) return;
    if (reloadPromise) return reloadPromise;
    const session = config;
    const work = async () => {
        useCanvasDirectoryStatus.setState({ loading: true });
        try {
            let cursor: string | null = null;
            const remote = new Map<string, CanvasProjectSummary>();
            do {
                const page: DirectoryPage = await request(session, `/v1/projects-directory?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`);
                const entries = new Map(useCanvasStore.getState().projects.map(p => [p.id, p]));
                for (const metadata of page.projects) {
                    remote.set(metadata.id, metadata);
                    if (deletes.has(metadata.id)) continue;
                    const local = entries.get(metadata.id);
                    if (!local) entries.set(metadata.id, metadata);
                    else if (local.localDirty || pending.has(local.id)) {
                        // 保留原始版本，保存时由服务端比较版本；不能绑定到最新版本后强制写入。
                    } else if (local.serverVersion === metadata.serverVersion) entries.set(local.id, { ...local, title: metadata.title, serverUpdatedAt: metadata.serverUpdatedAt });
                    else { entries.set(metadata.id, metadata); if (isCanvasProjectLoaded(local)) useCanvasUiStore.getState().setExternalUpdate(local.id); }
                }
                for (const item of page.deleted) {
                    const local = entries.get(item.id) || pending.get(item.id);
                    if (local?.localDirty || pending.has(item.id)) { await preserveConflict(local!, session); pending.delete(item.id); }
                    entries.delete(item.id);
                }
                // preserveConflict may have added a new local copy during this pass.
                for (const item of useCanvasStore.getState().projects) if (!entries.has(item.id) && item.localDirty && !page.deleted.some(d => d.id === item.id)) entries.set(item.id, item);
                replace([...entries.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
                cursor = page.nextCursor;
            } while (cursor && valid(session));
            if (!valid(session)) return;
            remoteReady = true; failures = 0;
            for (const project of useCanvasStore.getState().projects) {
                if (!project.debugReadOnly && !isConflictCopy(project) && (project.localDirty || (!remote.has(project.id) && isCanvasProjectLoaded(project)))) pending.set(project.id, project);
                else if (!isConflictCopy(project) && !remote.has(project.id) && project.legacyCached) {
                    const cached = await cachedProject(project.id, session.userId!);
                    if (!valid(session)) return;
                    if (cached) pending.set(project.id, { ...cached, title: project.title, localDirty: true });
                }
            }
            useCanvasDirectoryStatus.setState({ error: "" });
            if (pending.size || deletes.size) scheduleSave();
        } catch (error) {
            if (valid(session)) { failures++; useCanvasDirectoryStatus.setState({ error: error instanceof Error ? error.message : "云目录暂时不可用，保留本地数据并自动重连" }); }
        } finally { if (valid(session)) { useCanvasDirectoryStatus.setState({ loading: false }); scheduleReload(); } }
    };
    const current = work(); reloadPromise = current;
    try { await current; } finally { if (reloadPromise === current) reloadPromise = null; }
}
async function cachedProject(id: string, scope: string) {
    const raw = await localForageStorage.getItem(accountScopedKey(`infinite-canvas:canvas_store:project:${encodeURIComponent(id)}`, scope));
    if (!raw) return null;
    const project = JSON.parse(raw) as CanvasProject;
    return Array.isArray(project.nodes) && Array.isArray(project.connections) ? project : null;
}
export function loadSucaiCanvasProject(id: string): Promise<CanvasProject> {
    const scope = getCanvasAccountScope()?.userId || "guest", epoch = getCanvasSessionEpoch(), key = `${epoch}:${id}`;
    const existing = loads.get(key); if (existing) return existing;
    const work = async () => {
        const session = config, entry = useCanvasStore.getState().projects.find(p => p.id === id);
        if (entry && isCanvasProjectLoaded(entry)) return entry;
        const cached = await cachedProject(id, scope);
        if (epoch !== getCanvasSessionEpoch()) throw new Error("账号已切换");
        let project: CanvasProject;
        const queued = pending.get(id);
        if (queued && isCanvasProjectLoaded(queued)) project = queued;
        else if (cached && (entry?.localDirty || (!entry && cached.localDirty) || !session || (entry?.serverVersion != null && entry.serverVersion === cached.serverVersion))) project = cached;
        else if (session) project = { ...(await request<{ project: CanvasProject }>(session, `/v1/projects/${encodeURIComponent(id)}`)).project, detailLoaded: true, localDirty: false };
        else if (cached) project = cached;
        else throw new Error("画布不存在或尚未同步，请返回首页重试");
        const latest = useCanvasStore.getState().projects.find(item => item.id === id);
        if (latest?.localDirty) project = { ...project, title: latest.title, updatedAt: latest.updatedAt, localDirty: true };
        project = { ...project, serverVersion: project.serverVersion ?? entry?.serverVersion, detailLoaded: true };
        if (epoch !== getCanvasSessionEpoch()) throw new Error("账号已切换");
        put(project);
        if (project.localDirty) { pending.set(id, project); scheduleSave(); }
        return project;
    };
    const promise = work().finally(() => loads.delete(key)); loads.set(key, promise); return promise;
}
async function preserveConflict(entry: CanvasProjectEntry, session: SyncConfig) {
    const project = isCanvasProjectLoaded(entry) ? entry : await cachedProject(entry.id, session.userId!);
    if (!project || !valid(session)) return;
    const id = useCanvasStore.getState().importProject({ ...project, title: `${entry.title}（本地冲突副本）` });
    pending.set(id, useCanvasStore.getState().projects.find(p => p.id === id)!);
    useCanvasDirectoryStatus.setState({ conflict: `“${entry.title}”已在其他设备更新，本地修改保存在冲突副本中，请检查后合并。` });
}
export async function flushSucaiCanvasSync(): Promise<boolean> {
    if (saveTimer) clearTimeout(saveTimer); saveTimer = null;
    if (flushPromise) return flushPromise;
    if (!config || !remoteReady) return !pending.size && !deletes.size;
    const session = config;
    const work = async () => {
        let saved = true;
        // 单并发保存，避免多个大画布同时占满连接。
        for (const id of [...deletes]) {
            if (!valid(session)) return false;
            try { await request(session, `/v1/projects/${encodeURIComponent(id)}`, { method: "DELETE" }); deletes.delete(id); } catch { saved = false; }
        }
        for (const [id, snapshot] of [...pending]) {
            if (!valid(session)) return false;
            if (deletes.has(id) || snapshot.debugReadOnly) continue;
            try {
                const current = useCanvasStore.getState().projects.find(p => p.id === id);
                if (!current) { pending.delete(id); continue; }
                const version = current.serverVersion || 0;
                const result = isCanvasProjectLoaded(snapshot)
                    ? await request<SaveResult>(session, `/v1/project-documents/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ project: serializeCanvasProjectForCloud(snapshot), expectedVersion: version }) })
                    : await request<SaveResult>(session, `/v1/projects/${encodeURIComponent(id)}/title`, { method: "POST", body: JSON.stringify({ title: snapshot.title, expectedVersion: version }) });
                if (result.conflict) {
                    await preserveConflict(pending.get(id) || current, session); pending.delete(id);
                    if (result.metadata) put(result.metadata); else replace(useCanvasStore.getState().projects.filter(p => p.id !== id));
                    continue;
                }
                const latest = useCanvasStore.getState().projects.find(p => p.id === id); if (!latest) continue;
                const unchanged = pending.get(id) === snapshot && latest.updatedAt === snapshot.updatedAt;
                const acknowledged = { ...latest, serverVersion: result.metadata?.serverVersion, serverUpdatedAt: result.metadata?.serverUpdatedAt || latest.serverUpdatedAt, localDirty: !unchanged };
                put(acknowledged);
                if (unchanged) pending.delete(id); else pending.set(id, acknowledged);
            } catch (error) { if (!valid(session)) return false; saved = false; useCanvasDirectoryStatus.setState({ error: error instanceof Error ? error.message : "画布保存失败，稍后自动重试" }); }
        }
        await persistOutbox(session);
        if (valid(session) && (pending.size || deletes.size)) scheduleSave(saved ? 3000 : 15000);
        return saved;
    };
    const promise = work(); flushPromise = promise;
    try { return await promise; } finally { if (flushPromise === promise) flushPromise = null; }
}
export async function syncSucaiCanvasProject(id: string) {
    const project = await loadSucaiCanvasProject(id); if (project.debugReadOnly) return;
    pending.set(id, project);
    if (!await flushSucaiCanvasSync()) throw new Error("画布暂未同步成功，本地修改已保留");
}
export async function stopSucaiCanvasSync() {
    const saved = await flushSucaiCanvasSync(); await persistOutbox(); unsubscribe?.(); unsubscribe = null;
    window.removeEventListener("storage", externalUpdate);
    if (saveTimer) clearTimeout(saveTimer); if (reloadTimer) clearTimeout(reloadTimer);
    saveTimer = null; reloadTimer = null; config = null; remoteReady = false; reloadPromise = null; pending = new Map(); deletes = new Set();
    return saved;
}
