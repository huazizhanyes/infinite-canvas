import { describe, expect, it } from "vitest";
import { chooseRecoverableCanvasVideoTask, mergeHydratedCanvasNode } from "./canvas-recovery";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const node = (metadata: CanvasNodeData["metadata"]): CanvasNodeData => ({ id: "image-1", type: CanvasNodeType.Image, title: "参考图", position: { x: 0, y: 0 }, width: 100, height: 100, metadata });

describe("canvas recovery invariants", () => {
    it("merges mediaId-only hydration while retaining task state", () => {
        const base = node({ mediaId: "media-1", content: "", status: "error", errorDetails: "old", videoTaskId: "task-1" });
        const current = node({ ...base.metadata, status: "loading", generationRequestId: "request-1" });
        const hydrated = node({ mediaId: "media-1", content: "blob:image", storageKey: "image:u1:media-1", mediaStatus: "synced" });
        const merged = mergeHydratedCanvasNode(current, base, hydrated);
        expect(merged.metadata).toMatchObject({ content: "blob:image", mediaId: "media-1", storageKey: "image:u1:media-1", status: "loading", videoTaskId: "task-1", generationRequestId: "request-1" });
    });

    it("does not overwrite a user edit that happened during hydration", () => {
        const base = node({ mediaId: "media-1" });
        const current = node({ mediaId: "media-1", content: "blob:user-edit" });
        const hydrated = node({ mediaId: "media-1", content: "blob:remote" });
        expect(mergeHydratedCanvasNode(current, base, hydrated).metadata?.content).toBe("blob:user-edit");
    });

    it("does not restore media that the user cleared during hydration", () => {
        const base = node({ mediaId: "media-1", content: "blob:old" });
        const current = node({ content: undefined });
        const hydrated = node({ mediaId: "media-1", content: "blob:remote" });
        expect(mergeHydratedCanvasNode(current, base, hydrated)).toBe(current);
    });

    it("prefers a completed task with a result URL over active and failed tasks", () => {
        const task = (id: string, status: any, resultUrl: string | null, createdAt: string) => ({ id, status, resultUrl, createdAt, progress: 0, projectId: "p", nodeId: "n", modelId: "m", mode: "image2video", aspectRatio: "16:9", quality: "720p", duration: 5 });
        expect(chooseRecoverableCanvasVideoTask([
            task("failed", "failed", null, "2026-09-08T03:00:00Z"),
            task("active", "in_progress", null, "2026-09-08T02:00:00Z"),
            task("done", "completed", "https://cdn/video.mp4", "2026-09-08T01:00:00Z"),
        ])?.id).toBe("done");
    });
});
