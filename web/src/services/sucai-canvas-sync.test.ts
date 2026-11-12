import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";

const disk = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/localforage-storage", () => ({ localForageStorage: {
    getItem: vi.fn(async (key: string) => disk.get(key) || null),
    setItem: vi.fn(async (key: string, value: string) => { disk.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { disk.delete(key); }),
} }));

const project = (): CanvasProject => ({
    id: "p", title: "画布", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
    serverVersion: 5, detailLoaded: true, localDirty: false,
    nodes: [{ id: "v", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { generationRequestId: "new", status: "loading" } }],
    connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
});
const response = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

describe("canvas cloud synchronization races", () => {
    let sync: typeof import("./sucai-canvas-sync");
    let store: typeof import("@/stores/canvas/use-canvas-store");
    let remote = project();
    let listing: ReturnType<typeof deferred<any>> | null;
    let saving: ReturnType<typeof deferred<any>> | null;
    let failSave = false;
    let writes: Array<{ project: CanvasProject; expectedVersion: number }>;
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(async () => {
        vi.resetModules(); vi.useFakeTimers(); disk.clear();
        vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
        remote = project(); listing = null; saving = null; failSave = false; writes = [];
        fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.includes("projects-directory")) {
                if (listing) return listing.promise;
                return response({ projects: [{ ...remote, nodes: undefined, detailLoaded: false }], deleted: [], nextCursor: null });
            }
            if (init?.method === "PUT") {
                const body = JSON.parse(String(init.body)); writes.push(body);
                if (saving) return saving.promise;
                if (failSave) throw new Error("offline");
                if (body.expectedVersion !== remote.serverVersion) return response({ conflict: true, metadata: { id: "p", serverVersion: remote.serverVersion, detailLoaded: false } });
                remote = { ...body.project, serverVersion: remote.serverVersion! + 1 };
                return response({ metadata: { id: body.project.id, serverVersion: remote.serverVersion } });
            }
            return response({ project: remote });
        });
        vi.stubGlobal("fetch", fetchMock);
        const scope = await import("@/lib/canvas-account-scope"); scope.setCanvasAccountScope("test-user");
        store = await import("@/stores/canvas/use-canvas-store");
        await store.useCanvasStore.persist.rehydrate();
        store.useCanvasStore.setState({ projects: [project()], hydrated: true });
        sync = await import("./sucai-canvas-sync");
        await sync.initializeSucaiCanvasSync({ baseUrl: "http://test/canvas", token: "test", userId: "test-user" });
        await settle();
    });
    afterEach(async () => {
        listing?.resolve(response({ projects: [], deleted: [], nextCursor: null }));
        saving?.resolve(response({ conflict: true }));
        await settle(); await sync.stopSucaiCanvasSync(); await store.flushCanvasPersistence();
        vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
    });
    const video = (content: string) => [{ ...project().nodes[0], metadata: { status: "success" as const, videoTaskId: "done", content } }];

    it("ignores an old directory response arriving after save acknowledgement", async () => {
        listing = deferred();
        await vi.advanceTimersByTimeAsync(15000);
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/new.mp4") });
        expect(await sync.flushSucaiCanvasSync()).toBe(true);
        expect(store.useCanvasStore.getState().openProject("p")?.serverVersion).toBe(6);
        listing.resolve(response({ projects: [{ ...project(), detailLoaded: false }], deleted: [], nextCursor: null }));
        await settle();
        expect(store.useCanvasStore.getState().openProject("p")?.nodes[0].metadata?.content).toBe("https://test/new.mp4");
        expect(store.useCanvasStore.getState().openProject("p")?.serverVersion).toBe(6);
    });

    it("keeps a loaded document and its CAS baseline when a newer directory arrives", async () => {
        remote.serverVersion = 6;
        await vi.advanceTimersByTimeAsync(15000);
        expect(store.useCanvasStore.getState().openProject("p")?.serverVersion).toBe(5);
        expect(store.useCanvasStore.getState().openProject("p")?.nodes).toHaveLength(1);
        const ui = await import("@/stores/canvas/use-canvas-ui-store");
        expect(ui.useCanvasUiStore.getState().externalUpdateProjectId).toBe("p");
        const notifiedAt = ui.useCanvasUiStore.getState().externalUpdateAt;
        await vi.advanceTimersByTimeAsync(15000);
        expect(ui.useCanvasUiStore.getState().externalUpdateAt).toBe(notifiedAt);
    });

    it("keeps one evolving conflict copy including video completion and survives restart", async () => {
        remote.serverVersion = 6;
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/a.mp4") });
        expect(await sync.flushSucaiCanvasSync()).toBe(false);
        const copyId = store.useCanvasStore.getState().openProject("p")?.localConflictCopyId;
        expect(copyId).toBeTruthy();
        expect(store.useCanvasStore.getState().openProject(copyId!)?.localConflictSourceProjectId).toBe("p");
        expect(store.useCanvasStore.getState().openProject("p")?.serverVersion).toBe(5);
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/completed.mp4") });
        expect(store.useCanvasStore.getState().projects).toHaveLength(2);
        expect(store.useCanvasStore.getState().openProject(copyId!)?.nodes[0].metadata?.content).toBe("https://test/completed.mp4");
        await store.flushCanvasPersistence();
        await sync.stopSucaiCanvasSync();
        await store.rehydrateCanvasStoreForAccount();
        await sync.initializeSucaiCanvasSync({ baseUrl: "http://test/canvas", token: "test", userId: "test-user" });
        await settle();
        expect((await sync.loadSucaiCanvasProject("p")).nodes[0].metadata?.content).toBe("https://test/completed.mp4");
        expect((await sync.loadSucaiCanvasProject(copyId!)).nodes[0].metadata?.content).toBe("https://test/completed.mp4");
        expect(writes).toHaveLength(1);
        expect(store.useCanvasStore.getState().openProject("p")?.localConflictCopyId).toBe(copyId);
        await expect(sync.syncSucaiCanvasProject("p")).rejects.toThrow("处理同步冲突");
        const ui = await import("@/stores/canvas/use-canvas-ui-store");
        expect(ui.useCanvasUiStore.getState().externalUpdateProjectId).toBe("p");
        expect(writes).toHaveLength(1);
    });

    it("retains pending edits when the network fails and retries them", async () => {
        // A successful retry must also clear the stale save warning.
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/retry.mp4") });
        failSave = true; expect(await sync.flushSucaiCanvasSync()).toBe(false);
        expect(store.useCanvasStore.getState().openProject("p")?.localDirty).toBe(true);
        failSave = false; expect(await sync.flushSucaiCanvasSync()).toBe(true);
        expect(remote.nodes[0].metadata?.content).toBe("https://test/retry.mp4");
        expect(store.useCanvasStore.getState().openProject("p")?.localDirty).toBe(false);
        expect(sync.useCanvasDirectoryStatus.getState().error).toBe("");
    });

    it("does not overwrite a conflict copy the user renamed into an independent canvas", async () => {
        remote.serverVersion = 6;
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/local.mp4") });
        await sync.flushSucaiCanvasSync();
        const originalCopyId = store.useCanvasStore.getState().openProject("p")!.localConflictCopyId!;
        store.useCanvasStore.getState().renameProject(originalCopyId, "独立画布");
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/later.mp4") });
        expect(store.useCanvasStore.getState().openProject(originalCopyId)?.title).toBe("独立画布");
        expect(store.useCanvasStore.getState().openProject(originalCopyId)?.nodes[0].metadata?.content).toBe("https://test/local.mp4");
        const newCopyId = store.useCanvasStore.getState().openProject("p")!.localConflictCopyId!;
        expect(newCopyId).not.toBe(originalCopyId);
        expect(store.useCanvasStore.getState().openProject(newCopyId)?.nodes[0].metadata?.content).toBe("https://test/later.mp4");
    });

    it("keeps subsequent results if another device deleted the original canvas", async () => {
        listing = deferred();
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/before.mp4") });
        await vi.advanceTimersByTimeAsync(15000);
        listing.resolve(response({ projects: [], deleted: [{ id: "p", deletedAt: "2026-11-10T00:00:00Z" }], nextCursor: null }));
        await settle();
        const copyId = store.useCanvasStore.getState().openProject("p")?.localConflictCopyId;
        expect(copyId).toBeTruthy();
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/after.mp4") });
        expect(store.useCanvasStore.getState().openProject(copyId!)?.nodes[0].metadata?.content).toBe("https://test/after.mp4");
    });

    it("does not lose edits made in the same millisecond while a save is in flight", async () => {
        saving = deferred();
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/first.mp4") });
        const work = sync.flushSucaiCanvasSync(); await settle();
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/latest.mp4") });
        saving.resolve(response({ metadata: { id: "p", serverVersion: 6 } }));
        expect(await work).toBe(false); saving = null; remote.serverVersion = 6;
        expect(store.useCanvasStore.getState().openProject("p")?.localDirty).toBe(true);
        expect(await sync.flushSucaiCanvasSync()).toBe(true);
        expect(writes[1].expectedVersion).toBe(6);
        expect(remote.nodes[0].metadata?.content).toBe("https://test/latest.mp4");
    });

    it("explicit reload retains the local result before installing the remote document", async () => {
        remote = { ...project(), serverVersion: 6, nodes: video("https://test/remote.mp4") };
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/local.mp4") });
        await sync.reloadSucaiCanvasProject("p");
        const entries = store.useCanvasStore.getState().projects;
        expect(store.useCanvasStore.getState().openProject("p")?.nodes[0].metadata?.content).toBe("https://test/remote.mp4");
        const copy = entries.find(p => p.id !== "p");
        expect(copy && "nodes" in copy ? copy.nodes[0].metadata?.content : undefined).toBe("https://test/local.mp4");
        expect(store.useCanvasStore.getState().openProject("p")?.localConflictCopyId).toBeUndefined();
    });

    it("uses an independent new canvas id and version zero for its first save", async () => {
        const id = store.useCanvasStore.getState().createProject("新建画布");
        // The fixture server acknowledges creates independently from the existing document.
        fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)); writes.push(body); return response({ metadata: { id, serverVersion: 1 } });
        });
        expect(await sync.flushSucaiCanvasSync()).toBe(true);
        expect(writes[0].expectedVersion).toBe(0); expect(writes[0].project.id).toBe(id); expect(id).not.toBe("p");
    });

    it("ignores a delayed directory response after an account switch", async () => {
        listing = deferred(); await vi.advanceTimersByTimeAsync(15000);
        const scope = await import("@/lib/canvas-account-scope"); scope.setCanvasAccountScope("other-user");
        store.useCanvasStore.setState({ projects: [], hydrated: true });
        listing.resolve(response({ projects: [{ ...project(), serverVersion: 99, detailLoaded: false }], deleted: [], nextCursor: null }));
        await settle(); expect(store.useCanvasStore.getState().projects).toEqual([]);
    });

    it("retries the original mutation after a lost acknowledgement before sending newer edits", async () => {
        let receipt: any; let loseAck = true;
        fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
            if (init?.method !== "PUT") return response({ project: remote });
            const body = JSON.parse(String(init.body)); writes.push(body);
            if (body.expectedVersion !== remote.serverVersion) {
                return body.mutationId === receipt?.mutationId && JSON.stringify(body) === JSON.stringify(receipt)
                    ? response({ metadata: { id: "p", serverVersion: remote.serverVersion }, duplicate: true })
                    : response({ conflict: true });
            }
            remote = { ...body.project, serverVersion: remote.serverVersion! + 1 }; receipt = body;
            if (loseAck) { loseAck = false; throw new Error("ack lost"); }
            return response({ metadata: { id: "p", serverVersion: remote.serverVersion } });
        });
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/first.mp4") });
        expect(await sync.flushSucaiCanvasSync()).toBe(false);
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/newer.mp4") });
        expect(await sync.drainSucaiCanvasSync("p")).toBe(true);
        expect(writes[0]).toEqual(writes[1]);
        expect(remote.nodes[0].metadata?.content).toBe("https://test/newer.mp4");
        expect(remote.serverVersion).toBe(7);
        expect(store.useCanvasStore.getState().projects).toHaveLength(1);
    });

    it("persists retry identity across stopping and reinitializing", async () => {
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/pending.mp4") });
        failSave = true; await sync.flushSucaiCanvasSync();
        const first = writes[0];
        await sync.stopSucaiCanvasSync();
        await store.rehydrateCanvasStoreForAccount();
        await sync.initializeSucaiCanvasSync({ baseUrl: "http://test/canvas", token: "test", userId: "test-user" });
        await settle(); failSave = false;
        expect(await sync.drainSucaiCanvasSync("p")).toBe(true);
        expect(writes.at(-1)).toEqual(first);
    });

    it("drains edits made while an earlier snapshot is being saved", async () => {
        saving = deferred();
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/one.mp4") });
        const first = sync.flushSucaiCanvasSync(); await settle();
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/two.mp4") });
        const drain = sync.drainSucaiCanvasSync("p");
        saving.resolve(response({ metadata: { id: "p", serverVersion: 6 } }));
        saving = null; remote.serverVersion = 6;
        await first; expect(await drain).toBe(true);
        expect(remote.nodes[0].metadata?.content).toBe("https://test/two.mp4");
    });

    it("skips semantic no-op saves including restore and unmount snapshots", async () => {
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/stable.mp4") });
        await sync.flushSucaiCanvasSync(); const count = writes.length;
        const p = store.useCanvasStore.getState().openProject("p")!;
        store.useCanvasStore.getState().updateProject("p", { nodes: structuredClone(p.nodes), viewport: { ...p.viewport } });
        await sync.flushSucaiCanvasSync();
        expect(writes).toHaveLength(count);
        expect(store.useCanvasStore.getState().openProject("p")?.localDirty).toBe(false);
    });

    it("reconciles a pre-upgrade lost receipt only when cloud content matches", async () => {
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/already-saved.mp4") });
        remote = { ...store.useCanvasStore.getState().openProject("p")!, serverVersion: 6, updatedAt: "2026-11-02T00:00:00Z" };
        expect(await sync.drainSucaiCanvasSync("p")).toBe(true);
        expect(store.useCanvasStore.getState().projects).toHaveLength(1);
        expect(store.useCanvasStore.getState().openProject("p")).toMatchObject({ serverVersion: 6, localDirty: false });
        expect(writes).toHaveLength(1);
    });

    it("does not schedule saves for an unchanged project name", async () => {
        const before = store.useCanvasStore.getState().openProject("p")!;
        store.useCanvasStore.getState().renameProject("p", before.title);
        expect(store.useCanvasStore.getState().openProject("p")).toBe(before);
        expect(await sync.drainSucaiCanvasSync("p")).toBe(true);
        expect(writes).toHaveLength(0);
    });

    it("reports the real save error and permits generation only after successful retry", async () => {
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/retry-generation.mp4") });
        failSave = true;
        await expect(sync.syncSucaiCanvasProject("p")).rejects.toThrow("offline");
        expect(store.useCanvasStore.getState().openProject("p")?.localDirty).toBe(true);
        failSave = false;
        await expect(sync.syncSucaiCanvasProject("p")).resolves.toBeUndefined();
        expect(remote.nodes[0].metadata?.content).toBe("https://test/retry-generation.mp4");
    });

    it("unblocks a persisted conflict only after explicit cloud loading while retaining local content", async () => {
        remote = { ...project(), serverVersion: 6, nodes: video("https://test/remote.mp4") };
        store.useCanvasStore.getState().updateProject("p", { nodes: video("https://test/local.mp4") });
        await sync.flushSucaiCanvasSync();
        const copyId = store.useCanvasStore.getState().openProject("p")!.localConflictCopyId!;
        await expect(sync.syncSucaiCanvasProject("p")).rejects.toThrow("处理同步冲突");
        await sync.reloadSucaiCanvasProject("p");
        await expect(sync.syncSucaiCanvasProject("p")).resolves.toBeUndefined();
        expect(store.useCanvasStore.getState().openProject(copyId)?.nodes[0].metadata?.content).toBe("https://test/local.mp4");
        expect(store.useCanvasStore.getState().openProject("p")?.nodes[0].metadata?.content).toBe("https://test/remote.mp4");
    });
});
