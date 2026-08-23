import { describe, expect, it } from "vitest";

import { buildNodeGenerationContext } from "./canvas-node-generation";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { buildNodeMentionReferences, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { ImageAsset } from "@/stores/use-asset-store";

const target: CanvasNodeData = {
    id: "target",
    type: CanvasNodeType.Image,
    title: "目标",
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    metadata: {},
};

describe("buildNodeGenerationContext asset mentions", () => {
    it("passes connected script asset images as generation references", () => {
        const assetNode: CanvasNodeData = {
            id: "script-asset-1",
            type: CanvasNodeType.ScriptAsset,
            title: "林夏",
            position: { x: 0, y: 0 },
            width: 560,
            height: 320,
            metadata: { content: "blob:asset-image", mimeType: "image/png", scriptAssetId: "asset-1" },
        };
        const context = buildNodeGenerationContext(target.id, [target, assetNode], [{ id: "line", fromNodeId: assetNode.id, toNodeId: target.id }], "让人物走进车站");
        expect(context.referenceImages).toEqual([{ id: assetNode.id, name: "林夏.png", type: "image/png", dataUrl: "blob:asset-image", storageKey: undefined }]);
    });

    it("only includes user assets mentioned in the prompt", () => {
        const references: CanvasResourceReference[] = [
            { id: "asset:image-1", nodeId: "asset:image-1", source: "user-asset", assetId: "image-1", kind: "image", label: "资产·秦墨", title: "秦墨", previewUrl: "blob:image", storageKey: "image-key", mimeType: "image/png", active: true },
            { id: "asset:video-1", nodeId: "asset:video-1", source: "user-asset", assetId: "video-1", kind: "video", label: "资产·庭院视频", title: "庭院视频", previewUrl: "blob:video", storageKey: "video-key", mimeType: "video/mp4", active: true },
        ];

        const context = buildNodeGenerationContext(target.id, [target], [], "让资产·秦墨站在庭院中", references);

        expect(context.referenceImages).toEqual([{ id: "image-1", name: "秦墨.png", type: "image/png", dataUrl: "blob:image", storageKey: "image-key" }]);
        expect(context.referenceVideos).toEqual([]);
    });

    it("gives same-title assets distinct mention labels", () => {
        const image = (id: string): ImageAsset => ({
            id,
            kind: "image",
            title: "秦墨",
            coverUrl: `blob:${id}`,
            tags: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            data: { dataUrl: `blob:${id}`, width: 100, height: 100, bytes: 1, mimeType: "image/png" },
        });

        const references = buildNodeMentionReferences(target, [target], [], undefined, [image("one"), image("two")]);

        expect(references.filter((reference) => reference.source === "user-asset").map((reference) => reference.label)).toEqual(["资产·秦墨·1", "资产·秦墨·2"]);
    });
});
