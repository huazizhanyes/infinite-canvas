import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, string>());

vi.mock("@/lib/localforage-storage", () => ({
    localForageStorage: {
        getItem: vi.fn(async (key: string) => storage.get(key) || null),
        setItem: vi.fn(async (key: string, value: string) => {
            storage.set(key, value);
        }),
        removeItem: vi.fn(async (key: string) => {
            storage.delete(key);
        }),
    },
}));

const storeKey = "infinite-canvas:canvas_store:u:guest";
const projectKey = (id: string) => `infinite-canvas:canvas_store:project:${id}:u:guest`;

describe("canvas project persistence", () => {
    beforeEach(() => {
        storage.clear();
        vi.resetModules();
    });

    it("migrates the legacy monolithic value into project records", async () => {
        const project = createProject("legacy");
        storage.set(storeKey, JSON.stringify({ state: { projects: [project] }, version: 0 }));

        const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
        await useCanvasStore.persist.rehydrate();

        expect(useCanvasStore.getState().projects).toEqual([project]);
        expect(JSON.parse(storage.get(projectKey(project.id)) || "null")).toEqual(project);
        expect(JSON.parse(storage.get(storeKey) || "null")).toEqual({ state: { projectIds: [project.id] } });
    });

    it("writes only changed projects and removes deleted project records", async () => {
        const first = createProject("first");
        const second = createProject("second");
        storage.set(storeKey, JSON.stringify({ state: { projectIds: [first.id, second.id] } }));
        storage.set(projectKey(first.id), JSON.stringify(first));
        storage.set(projectKey(second.id), JSON.stringify(second));

        const { flushCanvasPersistence, useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
        await useCanvasStore.persist.rehydrate();
        useCanvasStore.getState().renameProject(first.id, "updated");
        useCanvasStore.getState().deleteProjects([second.id]);
        await flushCanvasPersistence();

        expect(JSON.parse(storage.get(projectKey(first.id)) || "null").title).toBe("updated");
        expect(storage.has(projectKey(second.id))).toBe(false);
        expect(JSON.parse(storage.get(storeKey) || "null")).toEqual({ state: { projectIds: [first.id] } });
    });
});

function createProject(id: string) {
    return {
        id,
        title: id,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };
}
