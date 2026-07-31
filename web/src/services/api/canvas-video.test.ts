import { describe, expect, it } from "vitest";

import { canvasVideoResult } from "./canvas-video";

describe("canvas video task results", () => {
    it("keeps the server URL and storage key without creating a browser media key", () => {
        const result = canvasVideoResult({
            id: "task-1",
            status: "completed",
            progress: 100,
            projectId: "project-1",
            nodeId: "node-1",
            modelId: "12::seedance-2.0",
            mode: "text2video",
            aspectRatio: "16:9",
            quality: "720p",
            duration: 5,
            resultUrl: "https://media.example.test/flash-api/canvas-video-files/generated/video.mp4",
            serverStorageKey: "generated/2026/07/u1/random-video.mp4",
            storageType: "local",
            mimeType: "video/mp4",
            width: 1280,
            height: 720,
        });

        expect(result.url).toMatch(/^https:\/\//);
        expect(result.storageKey).toBe("generated/2026/07/u1/random-video.mp4");
        expect(result.storageKey).not.toMatch(/^video:/);
        expect(result.durationMs).toBe(5000);
    });
});
