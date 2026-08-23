import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveCanvasProjectId, uploadCanvasMedia, type CanvasLocation } from "@/services/canvas-media";

function location(overrides: Partial<CanvasLocation>): CanvasLocation {
    return { pathname: "/", search: "", hash: "", ...overrides };
}

afterEach(() => vi.unstubAllGlobals());

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
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: { media: { id: "media-1" }, deduplicated: true } }), { status: 200 }));
        vi.stubGlobal("window", { location: location({ pathname: "/canvas/", hash: "#/canvas/-AzvlckjzzL4DqxoXjYBy" }) });
        vi.stubGlobal("localStorage", { getItem: vi.fn(() => "token-1") });
        vi.stubGlobal("fetch", fetchMock);

        await expect(uploadCanvasMedia(new Blob(["image"], { type: "image/png" }), "image")).resolves.toEqual({ mediaId: "media-1", mediaStatus: "synced" });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, request] = fetchMock.mock.calls[0];
        expect(String(url)).toMatch(/\/v1\/media\/init$/);
        expect(JSON.parse(String(request?.body))).toEqual(expect.objectContaining({ projectId: "-AzvlckjzzL4DqxoXjYBy", kind: "image", mimeType: "image/png", bytes: 5 }));
    });
});
