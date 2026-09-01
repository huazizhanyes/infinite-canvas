import { afterEach, describe, expect, it, vi } from "vitest";
import axios from "axios";

import { resolveCanvasProjectId, uploadCanvasMedia, type CanvasLocation } from "@/services/canvas-media";

function location(overrides: Partial<CanvasLocation>): CanvasLocation {
    return { pathname: "/", search: "", hash: "", ...overrides };
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("resolveCanvasProjectId", () => {
    it("reads the project id from the integrated production HashRouter URL", () => {
        expect(resolveCanvasProjectId(location({ pathname: "/canvas/", hash: "#/canvas/-AzvlckjzzL4DqxoXjYBy" }))).toBe("-AzvlckjzzL4DqxoXjYBy");
    });

    it("supports standalone BrowserRouter and legacy project URLs", () => {
        expect(resolveCanvasProjectId(location({ pathname: "/canvas/project-123" }))).toBe("project-123");
        expect(resolveCanvasProjectId(location({ pathname: "/canvas/project/project-456" }))).toBe("project-456");
        expect(resolveCanvasProjectId(location({ pathname: "/canvas/", hash: "#/project/project-789" }))).toBe("project-789");
    });

    it("uses an explicit projectId query parameter as a fallback integration contract", () => {
        expect(resolveCanvasProjectId(location({ pathname: "/canvas/", search: "?projectId=project-query" }))).toBe("project-query");
    });

    it("does not treat non-project canvas pages as project ids", () => {
        expect(resolveCanvasProjectId(location({ pathname: "/canvas/", hash: "#/assets" }))).toBe("");
        expect(resolveCanvasProjectId(location({ pathname: "/canvas/assets" }))).toBe("");
    });

    it("decodes a URL-encoded project id without failing on malformed encoding", () => {
        expect(resolveCanvasProjectId(location({ pathname: "/canvas/", hash: "#/canvas/project%20one" }))).toBe("project one");
        expect(resolveCanvasProjectId(location({ pathname: "/canvas/", hash: "#/canvas/project%ZZ" }))).toBe("project%ZZ");
    });

    it("sends media init with the project id resolved from the production hash URL", async () => {
        const postMock = vi.spyOn(axios, "post").mockResolvedValue({ data: { data: { media: { id: "media-1" }, deduplicated: true } } });
        vi.stubGlobal("window", { location: location({ pathname: "/canvas/", hash: "#/canvas/-AzvlckjzzL4DqxoXjYBy" }) });
        vi.stubGlobal("localStorage", { getItem: vi.fn(() => "token-1") });

        await expect(uploadCanvasMedia(new Blob(["image"], { type: "image/png" }), "image")).resolves.toEqual({ mediaId: "media-1", mediaStatus: "synced" });

        expect(postMock).toHaveBeenCalledTimes(1);
        const [url, body] = postMock.mock.calls[0];
        expect(String(url)).toMatch(/\/v1\/media\/init$/);
        expect(body).toEqual(expect.objectContaining({ projectId: "-AzvlckjzzL4DqxoXjYBy", kind: "image", mimeType: "image/png", bytes: 5 }));
    });

    it("uploads asset media without a project id from the assets route", async () => {
        const postMock = vi.spyOn(axios, "post").mockResolvedValue({ data: { data: { media: { id: "asset-media-1" }, deduplicated: true } } });
        vi.stubGlobal("window", { location: location({ pathname: "/canvas/assets" }) });
        vi.stubGlobal("localStorage", { getItem: vi.fn(() => "token-1") });

        await expect(uploadCanvasMedia(new Blob(["image"], { type: "image/png" }), "image", { ownerType: "asset", ownerId: "asset-1" })).resolves.toEqual({ mediaId: "asset-media-1", mediaStatus: "synced" });

        const [, body] = postMock.mock.calls[0];
        expect(body).toEqual(expect.objectContaining({ ownerType: "asset", ownerId: "asset-1", kind: "image", bytes: 5 }));
        expect(body).not.toHaveProperty("projectId");
    });

    it("reports real upload progress and confirming state", async () => {
        const statuses: string[] = [];
        const progress: number[] = [];
        vi.stubGlobal("window", { location: location({ pathname: "/canvas/", hash: "#/canvas/project-1" }), setTimeout, clearTimeout });
        vi.stubGlobal("localStorage", { getItem: vi.fn(() => "token-1") });
        vi.spyOn(axios, "post")
            .mockResolvedValueOnce({ data: { data: { media: { id: "media-1" }, deduplicated: false } } })
            .mockResolvedValueOnce({ data: { data: { media: { id: "media-1" } } } });
        vi.spyOn(axios, "put").mockImplementation(async (_url, _body, config) => {
            config?.onUploadProgress?.({ loaded: 34, total: 100 } as any);
            return { data: {} } as any;
        });

        await uploadCanvasMedia(new Blob([new Uint8Array(100)], { type: "video/mp4" }), "video", "project-1", { onStatus: (status) => statuses.push(status), onProgress: (value) => progress.push(value) });

        expect(progress).toContain(34);
        expect(progress).toContain(100);
        expect(statuses).toEqual(["uploading", "confirming", "synced"]);
    });

    it("rejects asset images larger than 20MB before starting a request", async () => {
        const postMock = vi.spyOn(axios, "post");
        vi.stubGlobal("window", { location: location({ pathname: "/canvas/assets" }) });
        vi.stubGlobal("localStorage", { getItem: vi.fn(() => "token-1") });

        await expect(uploadCanvasMedia(new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: "image/png" }), "image", { ownerType: "asset", ownerId: "asset-1" })).rejects.toThrow("20MB");
        expect(postMock).not.toHaveBeenCalled();
    });
});
