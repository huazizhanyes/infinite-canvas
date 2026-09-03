import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    resolveCanvasMediaUrl: vi.fn(),
    imageToDataUrl: vi.fn(),
    getMediaBlob: vi.fn(),
}));

vi.mock("@/services/canvas-media", () => ({ resolveCanvasMediaUrl: mocks.resolveCanvasMediaUrl }));
vi.mock("@/services/image-storage", () => ({ imageToDataUrl: mocks.imageToDataUrl }));
vi.mock("@/services/file-storage", () => ({ getMediaBlob: mocks.getMediaBlob, uploadMediaFile: vi.fn() }));

import { resolveSeedanceAudioUrl, resolveSeedanceImageUrl, resolveSeedanceVideoUrl } from "./video";

describe("Seedance media URL resolution", () => {
    beforeEach(() => {
        mocks.resolveCanvasMediaUrl.mockReset();
        mocks.imageToDataUrl.mockReset();
        mocks.getMediaBlob.mockReset();
        mocks.resolveCanvasMediaUrl.mockImplementation(async (mediaId: string) => `https://oss.example.test/${mediaId}`);
    });

    it("uses the stable public media URL for image references", async () => {
        const url = await resolveSeedanceImageUrl({ id: "image-1", name: "image.png", type: "image/png", dataUrl: "blob:local", storageKey: "image:u1:one", mediaId: "media-image" });

        expect(url).toBe("https://oss.example.test/media-image");
        expect(mocks.imageToDataUrl).not.toHaveBeenCalled();
    });

    it("uses stable public media URLs for video and audio references", async () => {
        const video = await resolveSeedanceVideoUrl({ id: "video-1", name: "video.mp4", type: "video/mp4", url: "blob:video", storageKey: "video:u1:one", mediaId: "media-video" });
        const audio = await resolveSeedanceAudioUrl({ id: "audio-1", name: "audio.mp3", type: "audio/mpeg", url: "blob:audio", storageKey: "audio:u1:one", mediaId: "media-audio" });

        expect(video).toBe("https://oss.example.test/media-video");
        expect(audio).toBe("https://oss.example.test/media-audio");
        expect(mocks.getMediaBlob).not.toHaveBeenCalled();
    });
});
