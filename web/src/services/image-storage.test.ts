import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    uploadCanvasMedia: vi.fn(),
    resolveCanvasMediaUrl: vi.fn(),
    files: new Map<string, Blob>(),
}));

vi.mock("localforage", () => ({
    default: {
        createInstance: () => ({
            setItem: vi.fn(async (key: string, value: Blob) => { mocks.files.set(key, value); }),
            getItem: vi.fn(async (key: string) => mocks.files.get(key) || null),
            removeItem: vi.fn(async (key: string) => { mocks.files.delete(key); }),
            iterate: vi.fn(async () => undefined),
        }),
    },
}));
vi.mock("nanoid", () => ({ nanoid: () => "test-image" }));
vi.mock("@/lib/image-utils", () => ({ readImageMeta: vi.fn(async () => ({ width: 1280, height: 720, mimeType: "image/png" })) }));
vi.mock("@/services/object-url-cache", () => ({ cacheObjectUrl: vi.fn(() => "blob:local-preview"), revokeCachedObjectUrl: vi.fn() }));
vi.mock("@/lib/canvas-account-scope", () => ({ getCanvasStorageScopeId: () => "1", getCanvasSessionEpoch: () => 7 }));
vi.mock("@/services/canvas-media", () => mocks);

import { resolvePersistedImage, storeImageLocally, syncStoredImage, uploadImage } from "@/services/image-storage";

describe("image OSS persistence", () => {
    beforeEach(() => {
        mocks.uploadCanvasMedia.mockReset();
        mocks.resolveCanvasMediaUrl.mockReset();
        mocks.files.clear();
    });

    afterEach(() => vi.unstubAllGlobals());

    it("returns the local preview without waiting for a remote upload", async () => {
        const image = await storeImageLocally(new Blob(["image"], { type: "image/png" }));

        expect(image.url).toBe("blob:local-preview");
        expect(image.storageKey).toBe("image:u1:test-image");
        expect(image.mediaStatus).toBe("uploading");
        expect(mocks.uploadCanvasMedia).not.toHaveBeenCalled();
    });

    it("keeps the local preview after the remote upload succeeds", async () => {
        mocks.uploadCanvasMedia.mockResolvedValue({ mediaId: "media-1", mediaStatus: "synced" });

        const image = await uploadImage(new Blob(["image"], { type: "image/png" }));

        expect(mocks.resolveCanvasMediaUrl).not.toHaveBeenCalled();
        expect(image.url).toBe("blob:local-preview");
        expect(image.mediaId).toBe("media-1");
        expect(image.mediaStatus).toBe("synced");
    });

    it("downloads a cloud image into the current device cache", async () => {
        mocks.resolveCanvasMediaUrl.mockResolvedValue("https://oss.example.com/canvas/media-3.png?signature=fresh");
        vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["remote-image"], { type: "image/png" }), { status: 200 })));

        const image = await resolvePersistedImage("media-3");

        expect(image.url).toBe("blob:local-preview");
        expect(image.storageKey).toBe("image:u1:media-media-3");
        expect(mocks.files.get("image:u1:media-media-3")).toBeInstanceOf(Blob);
    });

    it("deduplicates concurrent downloads for the same cloud image", async () => {
        mocks.resolveCanvasMediaUrl.mockResolvedValue("https://oss.example.com/canvas/media-4.png?signature=fresh");
        const fetchMock = vi.fn(async () => new Response(new Blob(["remote-image"], { type: "image/png" }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        const [first, second] = await Promise.all([resolvePersistedImage("media-4"), resolvePersistedImage("media-4")]);

        expect(first.url).toBe("blob:local-preview");
        expect(second.url).toBe("blob:local-preview");
        expect(mocks.resolveCanvasMediaUrl).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not repeatedly request a media record that is already missing", async () => {
        mocks.resolveCanvasMediaUrl.mockResolvedValue("");

        await expect(resolvePersistedImage("missing-media")).resolves.toEqual({ url: "", storageKey: "image:u1:media-missing-media" });
        await expect(resolvePersistedImage("missing-media")).resolves.toEqual({ url: "", storageKey: "image:u1:media-missing-media" });

        expect(mocks.resolveCanvasMediaUrl).toHaveBeenCalledTimes(1);
    });

    it("allows an explicit reload to retry a previously missing media record", async () => {
        mocks.resolveCanvasMediaUrl.mockResolvedValueOnce("").mockResolvedValueOnce("https://oss.example.com/recovered.png");
        vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["remote-image"], { type: "image/png" }), { status: 200 })));

        await resolvePersistedImage("reload-media");
        const recovered = await resolvePersistedImage("reload-media", undefined, "", true);

        expect(recovered.url).toBe("blob:local-preview");
        expect(mocks.resolveCanvasMediaUrl).toHaveBeenCalledTimes(2);
    });

    it("keeps the persisted address when the media record is no longer resolvable", async () => {
        mocks.resolveCanvasMediaUrl.mockImplementation(async (_mediaId: string, fallback = "") => fallback);
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

        await expect(resolvePersistedImage("gone-media", undefined, "https://oss.example.com/legacy.png")).resolves.toEqual({
            url: "https://oss.example.com/legacy.png",
            storageKey: "image:u1:media-gone-media",
        });
        expect(mocks.resolveCanvasMediaUrl).toHaveBeenCalledWith("gone-media", "https://oss.example.com/legacy.png");
    });

    it("retries remote sync from the existing IndexedDB image", async () => {
        await storeImageLocally(new Blob(["image"], { type: "image/png" }));
        mocks.uploadCanvasMedia.mockResolvedValue({ mediaId: "media-2", mediaStatus: "synced" });
        mocks.resolveCanvasMediaUrl.mockResolvedValue("https://oss.example.com/canvas/media-2.png?signature=test");

        const image = await syncStoredImage("image:u1:test-image");

        expect(mocks.uploadCanvasMedia).toHaveBeenCalledWith(expect.any(Blob), "image");
        expect(image).toEqual(expect.objectContaining({ storageKey: "image:u1:test-image", mediaId: "media-2", mediaStatus: "synced" }));
    });

    it("reports a missing local image instead of creating a broken cloud record", async () => {
        await expect(syncStoredImage("image:u1:missing")).rejects.toThrow("本地图片已丢失");
        expect(mocks.uploadCanvasMedia).not.toHaveBeenCalled();
    });
});
