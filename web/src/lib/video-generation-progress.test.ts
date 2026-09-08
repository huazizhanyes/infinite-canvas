import { describe, expect, it } from "vitest";

import { calculateEstimatedVideoProgress, createVideoProgressBaseline, DEFAULT_VIDEO_ESTIMATE_MS } from "./video-generation-progress";

describe("video generation progress", () => {
    it("uses the selected model recent three average", () => {
        const config = {
            videoModel: "video-model",
            channels: [{ id: "sucai-canvas", models: [{ name: "video-model", capability: "video", videoCapabilities: { recent3: { avgDurationSeconds: 42, sampleCount: 3, targetCount: 3 } } }] }],
        } as any;
        expect(createVideoProgressBaseline(config, "video-model", 1000)).toEqual({ videoProgressStartedAt: 1000, videoProgressEstimateMs: 42000, videoProgressSampleCount: 3 });
    });

    it("falls back to the default when no successful sample exists", () => {
        const config = { videoModel: "video-model", channels: [] } as any;
        expect(createVideoProgressBaseline(config, "video-model", 1000)).toEqual({ videoProgressStartedAt: 1000, videoProgressEstimateMs: DEFAULT_VIDEO_ESTIMATE_MS, videoProgressSampleCount: 0 });
    });

    it("caps unfinished work at 99 percent", () => {
        expect(calculateEstimatedVideoProgress(1000, 10000, 12000)).toBe(99);
        expect(calculateEstimatedVideoProgress(1000, 10000, 1001)).toBe(1);
    });
});
