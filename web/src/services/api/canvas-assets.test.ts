import { afterEach, describe, expect, it, vi } from "vitest";

import { canvasAssetsApi } from "./canvas-assets";

const connection = { baseUrl: "https://canvas.example.test", token: "token-1" };
const asset = {
    id: "asset-1",
    kind: "image" as const,
    title: "小狗",
    coverUrl: "blob:image-1",
    tags: ["角色"],
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:01:00.000Z",
    data: { dataUrl: "blob:image-1", storageKey: "image:u1:one", mediaId: "media-1", mediaOwner: "asset" as const, width: 100, height: 100, bytes: 4, mimeType: "image/png" },
};

afterEach(() => vi.unstubAllGlobals());

describe("canvas assets API", () => {
    it("reads cloud asset lists from the data envelope", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { assets: [asset] } }), { status: 200 })));

        await expect(canvasAssetsApi.list(connection)).resolves.toEqual([asset]);
    });

    it("saves assets with an idempotent PUT and bearer token", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        await canvasAssetsApi.save(connection, asset);

        expect(fetchMock).toHaveBeenCalledWith("https://canvas.example.test/v1/assets/asset-1", expect.objectContaining({ method: "PUT" }));
        const request = fetchMock.mock.calls[0][1] as RequestInit;
        expect(new Headers(request.headers).get("Authorization")).toBe("Bearer token-1");
        expect(JSON.parse(String(request.body))).toEqual({ asset });
    });

    it("deletes an asset by id", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        await canvasAssetsApi.remove(connection, "asset-1");

        expect(fetchMock).toHaveBeenCalledWith("https://canvas.example.test/v1/assets/asset-1", expect.objectContaining({ method: "DELETE" }));
    });
});
