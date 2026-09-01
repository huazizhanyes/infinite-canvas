import { afterEach, describe, expect, it, vi } from "vitest";

import { captureVideoFrame, videoFrameCaptureTime } from "@/lib/canvas/canvas-video-frame";

afterEach(() => vi.unstubAllGlobals());

describe("videoFrameCaptureTime", () => {
    it("selects first, last and current frame timestamps without exceeding duration", () => {
        expect(videoFrameCaptureTime("first", 5, 2)).toBe(0);
        expect(videoFrameCaptureTime("last", 5, 2)).toBeCloseTo(4.95);
        expect(videoFrameCaptureTime("current", 5, 2.4)).toBe(2.4);
        expect(videoFrameCaptureTime("current", 5, 8)).toBe(5);
    });

    it("handles invalid and zero-duration metadata", () => {
        expect(videoFrameCaptureTime("last", Number.NaN, 2)).toBe(0);
        expect(videoFrameCaptureTime("current", 0, 2)).toBe(2);
    });
});

describe("captureVideoFrame", () => {
    it("reuses the decoder for repeated captures from the same video source", async () => {
        class FakeVideo {
            readyState = 2;
            videoWidth = 1280;
            videoHeight = 720;
            duration = 5;
            currentSrc = "blob:video-cache-test";
            src = this.currentSrc;
            crossOrigin = "";
            private time = 0;
            private listeners = new Map<string, Set<() => void>>();

            get currentTime() { return this.time; }
            set currentTime(value: number) {
                this.time = value;
                queueMicrotask(() => this.listeners.get("seeked")?.forEach((listener) => listener()));
            }
            addEventListener(name: string, listener: () => void) {
                const listeners = this.listeners.get(name) || new Set();
                listeners.add(listener);
                this.listeners.set(name, listeners);
            }
            removeEventListener(name: string, listener: () => void) { this.listeners.get(name)?.delete(listener); }
            removeAttribute() {}
            load() {}
        }

        const createdVideos: FakeVideo[] = [];
        vi.stubGlobal("HTMLMediaElement", { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 });
        vi.stubGlobal("window", { setTimeout, clearTimeout });
        vi.stubGlobal("document", {
            createElement: (tag: string) => {
                if (tag === "video") {
                    const video = new FakeVideo();
                    createdVideos.push(video);
                    return video;
                }
                return { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["frame"], { type: "image/png" })) };
            },
        });

        const source = new FakeVideo() as unknown as HTMLVideoElement;
        await captureVideoFrame(source, "first");
        await captureVideoFrame(source, "last");

        expect(createdVideos).toHaveLength(1);
        expect(createdVideos[0].crossOrigin).toBe("anonymous");
    });

    it("captures the current frame through the CORS-safe decoder instead of the visible player", async () => {
        const drawImage = vi.fn();
        class FakeVideo {
            readyState = 2;
            videoWidth = 1280;
            videoHeight = 720;
            duration = 5;
            currentSrc = "https://media.example.com/current.mp4";
            src = this.currentSrc;
            crossOrigin = "";
            currentTime = 2.4;
            addEventListener() {}
            removeEventListener() {}
            removeAttribute() {}
            load() {}
        }
        let captureVideo: FakeVideo | undefined;
        vi.stubGlobal("HTMLMediaElement", { HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2 });
        vi.stubGlobal("window", { setTimeout, clearTimeout });
        vi.stubGlobal("document", {
            createElement: (tag: string) => {
                if (tag === "video") return captureVideo = new FakeVideo();
                return { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["frame"], { type: "image/png" })) };
            },
        });

        const visibleVideo = new FakeVideo() as unknown as HTMLVideoElement;
        await captureVideoFrame(visibleVideo, "current");

        expect(captureVideo?.crossOrigin).toBe("anonymous");
        expect(drawImage).toHaveBeenCalledWith(captureVideo, 0, 0, 1280, 720);
        expect(drawImage).not.toHaveBeenCalledWith(visibleVideo, 0, 0, 1280, 720);
    });
});
