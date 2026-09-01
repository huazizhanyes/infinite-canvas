import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { storeImageLocally, syncStoredImage, uploadImage } from "@/services/image-storage";

describe("image OSS persistence", () => {
    beforeEach(() => {
        mocks.uploadCanvasMedia.mockReset();
        mocks.resolveCanvasMediaUrl.mockReset();
        mocks.files.clear();
    });

    it("returns the local preview without waiting for a remote upload", async () => {
        const image = await storeImageLocally(new Blob(["image"], { type: "image/png" }));

        expect(image.url).toBe("blob:local-preview");
        expect(image.storageKey).toBe("image:u1:test-image");
        expect(image.mediaStatus).toBe("uploading");
        expect(mocks.uploadCanvasMedia).not.toHaveBeenCalled();
    });

    it("returns the signed OSS URL after the remote upload succeeds", async () => {
        mocks.uploadCanvasMedia.mockResolvedValue({ mediaId: "media-1", mediaStatus: "synced" });
        mocks.resolveCanvasMediaUrl.mockResolvedValue("https://oss.example.com/canvas/media-1.png?signature=test");

        const image = await uploadImage(new Blob(["image"], { type: "image/png" }));

        expect(mocks.resolveCanvasMediaUrl).toHaveBeenCalledWith("media-1", "blob:local-preview");
        expect(image.url).toMatch(/^https:\/\/oss\.example\.com\//);
        expect(image.mediaId).toBe("media-1");
        expect(image.mediaStatus).toBe("synced");
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
