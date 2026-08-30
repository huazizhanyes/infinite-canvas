import { describe, expect, it } from "vitest";

import { appendCanvasConnectionMention, buildCanvasConnectionPreviews, removeCanvasConnectionMention } from "./canvas-connection-previews";
import type { CanvasResourceReference } from "./canvas-resource-references";

describe("buildCanvasConnectionPreviews", () => {
    it("maps connected media references to their exact connection in reference order", () => {
        const references: CanvasResourceReference[] = [
            { id: "image-b", nodeId: "image-b", source: "canvas", kind: "image", label: "图片2", title: "B", previewUrl: "blob:b", active: true },
            { id: "image-a", nodeId: "image-a", source: "canvas", kind: "image", label: "图片1", title: "A", previewUrl: "blob:a", active: true },
        ];
        const previews = buildCanvasConnectionPreviews("video", [
            { id: "conn-a", fromNodeId: "image-a", toNodeId: "video" },
            { id: "conn-b", fromNodeId: "image-b", toNodeId: "video" },
        ], references);

        expect(previews.map((item) => [item.connectionId, item.nodeId])).toEqual([
            ["conn-b", "image-b"],
            ["conn-a", "image-a"],
        ]);
    });

    it("excludes disconnected, text, and user asset references", () => {
        const references: CanvasResourceReference[] = [
            { id: "inactive", nodeId: "inactive", source: "canvas", kind: "image", label: "图片1", title: "断开", previewUrl: "blob:inactive", active: false },
            { id: "text", nodeId: "text", source: "canvas", kind: "text", label: "文本1", title: "文本", text: "内容", active: true },
            { id: "asset:a", nodeId: "asset:a", source: "user-asset", kind: "image", label: "资产·A", title: "A", previewUrl: "blob:asset", active: true },
        ];

        expect(buildCanvasConnectionPreviews("video", [
            { id: "conn-inactive", fromNodeId: "inactive", toNodeId: "video" },
            { id: "conn-text", fromNodeId: "text", toNodeId: "video" },
        ], references)).toEqual([]);
    });

    it("does not preview resources connected from the target's output", () => {
        const references: CanvasResourceReference[] = [
            { id: "image", nodeId: "image", source: "canvas", kind: "image", label: "图片1", title: "图片", previewUrl: "blob:image", active: true },
        ];

        expect(buildCanvasConnectionPreviews("video", [{ id: "outgoing", fromNodeId: "video", toNodeId: "image" }], references)).toEqual([]);
    });

    it("includes connected audio as a placeholder preview without requiring artwork", () => {
        const references: CanvasResourceReference[] = [
            { id: "audio", nodeId: "audio", source: "canvas", kind: "audio", label: "音频1", title: "男主参考音", active: true },
        ];

        expect(buildCanvasConnectionPreviews("video", [{ id: "audio-video", fromNodeId: "audio", toNodeId: "video" }], references)).toEqual([
            { connectionId: "audio-video", nodeId: "audio", kind: "audio", label: "音频1", title: "男主参考音", previewUrl: undefined },
        ]);
    });
});

describe("canvas connection mentions", () => {
    it("appends a direct mention once", () => {
        expect(appendCanvasConnectionMention("镜头缓慢推进", "图片2")).toBe("镜头缓慢推进 @图片2 ");
        expect(appendCanvasConnectionMention("镜头缓慢推进 @图片2 ", "图片2")).toBe("镜头缓慢推进 @图片2 ");
    });

    it("removes only the disconnected reference label", () => {
        expect(removeCanvasConnectionMention("参考 @图片1 和 @图片10 生成", "图片1")).toBe("参考 和 @图片10 生成");
        expect(removeCanvasConnectionMention("@图片2 镜头缓慢推进", "图片2")).toBe("镜头缓慢推进");
    });
});
