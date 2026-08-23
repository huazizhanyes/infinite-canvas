import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    uploadCanvasMedia: vi.fn(),
    resolveCanvasMediaUrl: vi.fn(),
}));

vi.mock("localforage", () => ({
    default: {
        createInstance: () => ({
            setItem: vi.fn(async () => undefined),
            getItem: vi.fn(async () => null),
            removeItem: vi.fn(async () => undefined),
            iterate: vi.fn(async () => undefined),
        }),
    },
}));
vi.mock("nanoid", () => ({ nanoid: () => "test-image" }));
vi.mock("@/lib/image-utils", () => ({ readImageMeta: vi.fn(async () => ({ width: 1280, height: 720, mimeType: "image/png" })) }));
vi.mock("@/services/object-url-cache", () => ({ cacheObjectUrl: vi.fn(() => "blob:local-preview"), revokeCachedObjectUrl: vi.fn() }));
vi.mock("@/lib/canvas-account-scope", () => ({ getCanvasStorageScopeId: () => "1", getCanvasSessionEpoch: () => 7 }));
vi.mock("@/services/canvas-media", () => mocks);

import { uploadImage } from "@/services/image-storage";

describe("image OSS persistence", () => {
    beforeEach(() => {
        mocks.uploadCanvasMedia.mockReset();
        mocks.resolveCanvasMediaUrl.mockReset();
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
});
